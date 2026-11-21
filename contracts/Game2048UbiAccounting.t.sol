// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test, Vm } from "forge-std/Test.sol";
import { Game2048 } from "./Game2048.sol";
import { MockERC20 } from "./test/MockERC20.sol";
import { MockIdentity } from "./test/MockIdentity.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// Buys several items in ONE transaction, to show each purchase is its own contribution.
contract MultiBuyer {
    function buyThree(Game2048 game, MockERC20 token) external {
        token.approve(address(game), type(uint256).max);
        game.buyStreakShield();
        game.buyStreakShield();
        game.buyXpBoost(2);
    }
}

/// Accounting of the 5% UBI contribution across many purchases: every G$ that
/// leaves a buyer is accounted for (treasury + UBI recipient), the UBI total
/// equals the sum of the events, the sum of the token's Transfer logs and the
/// recomputed floor(5%) of each purchase, and nothing else moves the UBI total.
contract Game2048UbiAccountingTest is Test {
    Game2048 game;
    MockERC20 token;
    MockIdentity id;

    address[2] buyers = [makeAddr("buyerA"), makeAddr("buyerB")];
    address ubi = makeAddr("ubi");
    uint256 constant COSMETIC_ID = 7;

    bytes32 constant UBI_SIG = keccak256("UbiContribution(address,uint8,uint256,uint256,uint256,uint256,address)");
    bytes32 constant TRANSFER_SIG = keccak256("Transfer(address,address,uint256)");

    struct Totals {
        uint256 purchases;
        uint256 paid;           // recomputed: price × quantity before each purchase
        uint256 expected;       // recomputed: floor(paid × 500 / 10,000) per purchase
        uint256 events;         // UbiContribution events
        uint256 eventPaid;      // their amountPaid
        uint256 eventContrib;   // their contribution
        uint256 toUbiLogs;      // Transfer(game → ubi) logs
        uint256 toUbiAmount;
        uint256 intoGameAmount; // Transfer(buyer → game)
    }

    function setUp() public {
        token = new MockERC20();
        id = new MockIdentity();
        Game2048 impl = new Game2048(ubi);
        game = Game2048(address(new ERC1967Proxy(address(impl), abi.encodeCall(Game2048.initialize, (address(token), address(id))))));
        game.setCosmeticPrice(COSMETIC_ID, 150e18);
        for (uint256 i = 0; i < buyers.length; i++) {
            token.mint(buyers[i], 1e30);
            vm.prank(buyers[i]);
            token.approve(address(game), type(uint256).max);
        }
    }

    function _five(uint256 amount) internal pure returns (uint256) {
        return (amount * 500) / 10_000;
    }

    /// One purchase of kind `k` (0..5) by `who`; returns what it must cost.
    function _buy(uint256 k, address who) internal returns (uint256 amount) {
        // Read the price first: vm.prank applies to the very next call.
        if (k == 0) amount = game.shieldPrice();
        else if (k == 1) amount = game.boost2xPrice();
        else if (k == 2) amount = game.boost5xPrice();
        else if (k == 3) amount = game.undoPrice();
        else if (k == 4) amount = game.undoPrice() * 4;
        else (amount, ) = game.cosmeticCatalog(COSMETIC_ID);
        vm.prank(who);
        if (k == 0) game.buyStreakShield();
        else if (k == 1) game.buyXpBoost(2);
        else if (k == 2) game.buyXpBoost(5);
        else if (k == 3) game.buyUndoMove(1);
        else if (k == 4) game.buyUndoMove(4);
        else game.buyCosmetic(COSMETIC_ID);
    }

    function _tally(Totals memory t, Vm.Log[] memory logs, uint256 paid) internal view {
        uint256 want = _five(paid);
        uint256 events; uint256 toUbi; uint256 toUbiAmount;
        for (uint256 i = 0; i < logs.length; i++) {
            Vm.Log memory l = logs[i];
            if (l.emitter == address(game) && l.topics[0] == UBI_SIG) {
                (, , uint256 amountPaid, uint256 contribution) = abi.decode(l.data, (uint256, uint256, uint256, uint256));
                assertEq(amountPaid, paid, "event amountPaid = what the buyer paid");
                assertEq(contribution, want, "event contribution = floor(5%)");
                assertEq(address(uint160(uint256(l.topics[3]))), ubi, "event names the recipient");
                events++;
                t.eventPaid += amountPaid;
                t.eventContrib += contribution;
            } else if (l.emitter == address(token) && l.topics[0] == TRANSFER_SIG) {
                address from = address(uint160(uint256(l.topics[1])));
                address to = address(uint160(uint256(l.topics[2])));
                uint256 v = abi.decode(l.data, (uint256));
                if (from == address(game) && to == ubi) { toUbi++; toUbiAmount += v; }
                else if (to == address(game)) t.intoGameAmount += v;
                else revert("unexpected G$ Transfer in a purchase");
            }
        }
        // Exactly one event and one transfer when 5% rounds above zero, none otherwise.
        assertEq(events, want > 0 ? 1 : 0, "one UbiContribution per eligible purchase");
        assertEq(toUbi, want > 0 ? 1 : 0, "one G$ Transfer to UBI per eligible purchase");
        assertEq(toUbiAmount, want, "the transfer moves exactly floor(5%)");
        t.events += events;
        t.toUbiLogs += toUbi;
        t.toUbiAmount += toUbiAmount;
        t.purchases++;
        t.paid += paid;
        t.expected += want;
    }

    /// Random purchase sequences at random (often odd, sometimes dust) prices, then every total
    /// is reconciled four ways: recomputed, events, Transfer logs and balances.
    function testFuzz_TotalsReconcileAcrossPurchases(uint256 seed) public {
        Totals memory t;
        uint256 ubi0 = token.balanceOf(ubi);
        uint256 treasury0 = token.balanceOf(address(game));
        uint256 supply0 = token.totalSupply();
        uint256 buyers0 = token.balanceOf(buyers[0]) + token.balanceOf(buyers[1]);

        for (uint256 i = 0; i < 12; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            if (r % 3 == 0) {
                // Reprice: dust (below 20 wei), odd, or large; never 0 (0 disables an item).
                uint256 p = r % 5 == 0 ? 1 + (r >> 8) % 19 : 1 + (r >> 8) % 1e24;
                game.setShopPrices(p, p + 1, p + 2, p + 3);
                game.setCosmeticPrice(COSMETIC_ID, p + 4);
            }
            address who = buyers[(r >> 16) % 2];
            uint256 kind = (r >> 24) % 6;
            vm.recordLogs();
            uint256 paid = _buy(kind, who);
            _tally(t, vm.getRecordedLogs(), paid);
        }

        uint256 ubiDelta = token.balanceOf(ubi) - ubi0;
        uint256 treasuryDelta = token.balanceOf(address(game)) - treasury0;
        uint256 buyersDebit = buyers0 - (token.balanceOf(buyers[0]) + token.balanceOf(buyers[1]));

        assertEq(t.eventContrib, t.expected, "events = recomputed floor(5%) total");
        assertEq(t.toUbiAmount, t.expected, "Transfer logs = recomputed total");
        assertEq(ubiDelta, t.expected, "recipient balance grew by exactly the total");
        assertEq(t.intoGameAmount, t.paid, "the game received exactly what buyers paid");
        assertEq(buyersDebit, t.paid, "buyers paid exactly the listed prices, nothing more");
        assertEq(treasuryDelta, t.paid - t.expected, "treasury kept the rest");
        assertEq(token.totalSupply(), supply0, "no G$ created or destroyed");
        assertEq(t.events, t.toUbiLogs, "one transfer per event");
    }

    /// Duplicate processing: three purchases in one transaction are three contributions, each
    /// with its own event and transfer, told apart by log position.
    function test_SeveralPurchasesInOneTransaction_AreEachCounted() public {
        MultiBuyer mb = new MultiBuyer();
        token.mint(address(mb), 1e24);
        uint256 shield = game.shieldPrice();
        uint256 boost = game.boost2xPrice();
        uint256 want = _five(shield) * 2 + _five(boost);
        uint256 ubi0 = token.balanceOf(ubi);

        vm.recordLogs();
        mb.buyThree(game, token);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 events; uint256 transfers; uint256 total;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(game) && logs[i].topics[0] == UBI_SIG) {
                (, , , uint256 c) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                events++;
                total += c;
            }
            if (logs[i].emitter == address(token) && logs[i].topics[0] == TRANSFER_SIG && address(uint160(uint256(logs[i].topics[2]))) == ubi) transfers++;
        }
        assertEq(events, 3);
        assertEq(transfers, 3);
        assertEq(total, want);
        assertEq(token.balanceOf(ubi) - ubi0, want);
    }

    /// Owner treasury moves are not purchases: they neither create nor reduce contributions,
    /// and later purchases keep contributing.
    function test_TreasuryWithdrawal_LeavesContributionsAlone() public {
        uint256 c1 = _five(_buy(0, buyers[0]));
        uint256 ubiAfterBuy = token.balanceOf(ubi);
        game.withdrawTreasury(token.balanceOf(address(game)));
        assertEq(token.balanceOf(address(game)), 0);
        assertEq(token.balanceOf(ubi), ubiAfterBuy, "withdrawing the treasury can't touch UBI's G$");
        uint256 c2 = _five(_buy(5, buyers[1]));
        assertEq(token.balanceOf(ubi) - ubiAfterBuy, c2);
        assertGt(c1, 0);
    }

    /// The recipient and the rate are fixed per implementation: the owner has no setter.
    function test_OwnerCannotRedirectOrChangeTheRate() public {
        (bool ok1, ) = address(game).call(abi.encodeWithSignature("setUbiRecipient(address)", address(this)));
        (bool ok2, ) = address(game).call(abi.encodeWithSignature("setUbiContributionBps(uint256)", uint256(0)));
        assertFalse(ok1);
        assertFalse(ok2);
        assertEq(game.ubiRecipient(), ubi);
        assertEq(game.UBI_CONTRIBUTION_BPS(), 500);
    }
}
