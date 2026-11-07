// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test, Vm } from "forge-std/Test.sol";
import { Game2048 } from "./Game2048.sol";
import { MockERC20 } from "./test/MockERC20.sol";
import { MockIdentity } from "./test/MockIdentity.sol";
import { MockMisbehavingERC20 } from "./test/MockMisbehavingERC20.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Regression matrix for the 5% GoodDollar UBI contribution: every paid Shop
/// purchase, checked through its event, the token's own Transfer logs, and
/// balances. Prices, rate and recipient are read from the contract.
///
/// `_purchase` is the coverage list: test/ubiPurchaseGuard.ts reads this
/// contract's AST and fails if Game2048 has a paid function `_purchase`
/// doesn't call. Add new Shop products to `Kind`, `_purchase` and `_expected`.
contract Game2048UbiRegressionTest is Test {
    Game2048 game;
    MockERC20 token;
    MockIdentity id;

    address buyer  = makeAddr("buyer");
    address buyer2 = makeAddr("buyer2");
    address ubi    = makeAddr("ubi");

    /// The test's own catalog entry: the catalog starts empty, so a cosmetic must be listed to be bought.
    uint256 constant COSMETIC_ID = 7;

    bytes32 constant UBI_SIG = keccak256("UbiContribution(address,uint8,uint256,uint256,uint256,uint256,address)");
    bytes32 constant TRANSFER_SIG = keccak256("Transfer(address,address,uint256)");

    enum Kind { Shield, Boost2x, Boost5x, Undo1, Undo3, Cosmetic }
    uint256 constant KINDS = 6;

    struct Expect {
        Game2048.ShopItem item;
        uint256 itemId;
        uint256 quantity;
        uint256 price; // what the buyer must pay, read from the contract's current prices
    }

    struct Seen {
        uint256 count;          // UbiContribution events from the game
        address buyer;
        uint8 item;
        uint256 itemId;
        uint256 quantity;
        uint256 amountPaid;
        uint256 contribution;
        address recipient;
        uint256 toUbi;          // G$ Transfer(game → ubi) logs …
        uint256 toUbiAmount;    // … and their total
        uint256 fromBuyer;      // G$ Transfer(buyer → game) logs …
        uint256 fromBuyerAmount;
        uint256 otherTransfers; // any other G$ Transfer
    }

    function _deploy(address tok, address recipient) internal returns (Game2048 g) {
        Game2048 impl = new Game2048(recipient);
        g = Game2048(address(new ERC1967Proxy(address(impl), abi.encodeCall(Game2048.initialize, (tok, address(id))))));
    }

    function setUp() public {
        token = new MockERC20();
        id    = new MockIdentity();
        game  = _deploy(address(token), ubi);
        game.setCosmeticPrice(COSMETIC_ID, 150e18);
        for (uint256 i = 0; i < 2; i++) {
            address b = i == 0 ? buyer : buyer2;
            token.mint(b, 1_000_000e18);
            vm.prank(b);
            token.approve(address(game), type(uint256).max);
        }
    }

    // ─── The matrix ───────────────────────────────────────────────────────────

    /// Every paid Shop purchase. The coverage guard reads the calls in this function.
    function _purchase(Game2048 g, Kind k) internal {
        if (k == Kind.Shield) g.buyStreakShield();
        else if (k == Kind.Boost2x) g.buyXpBoost(2);
        else if (k == Kind.Boost5x) g.buyXpBoost(5);
        else if (k == Kind.Undo1) g.buyUndoMove(1);
        else if (k == Kind.Undo3) g.buyUndoMove(3);
        else if (k == Kind.Cosmetic) g.buyCosmetic(COSMETIC_ID);
        else revert("unknown kind");
    }

    /// What each purchase must report, from the implementation: _collectPayment(item, itemId, quantity, amount).
    function _expected(Game2048 g, Kind k) internal view returns (Expect memory) {
        if (k == Kind.Shield)  return Expect(Game2048.ShopItem.StreakShield, 0, 1, g.shieldPrice());
        if (k == Kind.Boost2x) return Expect(Game2048.ShopItem.XpBoost, 2, 1, g.boost2xPrice());
        if (k == Kind.Boost5x) return Expect(Game2048.ShopItem.XpBoost, 5, 1, g.boost5xPrice());
        if (k == Kind.Undo1)   return Expect(Game2048.ShopItem.UndoMove, 0, 1, g.undoPrice());
        if (k == Kind.Undo3)   return Expect(Game2048.ShopItem.UndoMove, 0, 3, g.undoPrice() * 3);
        (uint256 price, bool exists) = g.cosmeticCatalog(COSMETIC_ID);
        require(exists, "cosmetic not listed");
        return Expect(Game2048.ShopItem.Cosmetic, COSMETIC_ID, 1, price);
    }

    /// The contribution the product requires: floor(amount × 5%), computed here, not by the contract.
    function _fivePercent(uint256 amount) internal pure returns (uint256) {
        return (amount * 500) / 10_000;
    }

    function _scan(Vm.Log[] memory logs, address g, address from) internal view returns (Seen memory s) {
        for (uint256 i = 0; i < logs.length; i++) {
            Vm.Log memory l = logs[i];
            if (l.emitter == g && l.topics.length > 0 && l.topics[0] == UBI_SIG) {
                s.count++;
                s.buyer = address(uint160(uint256(l.topics[1])));
                s.item = uint8(uint256(l.topics[2]));
                s.recipient = address(uint160(uint256(l.topics[3])));
                (s.itemId, s.quantity, s.amountPaid, s.contribution) = abi.decode(l.data, (uint256, uint256, uint256, uint256));
            } else if (l.emitter == address(token) && l.topics.length == 3 && l.topics[0] == TRANSFER_SIG) {
                address tf = address(uint160(uint256(l.topics[1])));
                address tt = address(uint160(uint256(l.topics[2])));
                uint256 v = abi.decode(l.data, (uint256));
                if (tf == g && tt == ubi) { s.toUbi++; s.toUbiAmount += v; }
                else if (tf == from && tt == g) { s.fromBuyer++; s.fromBuyerAmount += v; }
                else s.otherTransfers++;
            }
        }
    }

    /// Buys `k` as `who` and checks the event, the token transfers, the balances and the item granted.
    function _buyAndCheck(Kind k, address who) internal {
        Expect memory e = _expected(game, k);
        uint256 want = _fivePercent(e.price);
        assertGt(want, 0, "matrix prices must give a non-zero contribution");
        uint256 b0 = token.balanceOf(who);
        uint256 u0 = token.balanceOf(ubi);
        uint256 t0 = token.balanceOf(address(game));
        uint256 owned0 = _owned(k, who);

        vm.recordLogs();
        vm.prank(who);
        _purchase(game, k);
        Seen memory s = _scan(vm.getRecordedLogs(), address(game), who);

        // 1. exactly one event; 2. the real buyer; 3. item and id; 4. quantity; 5. amount; 6. 5%, floored; 9. recipient
        assertEq(s.count, 1, "exactly one UbiContribution");
        assertEq(s.buyer, who, "buyer is the purchasing address");
        assertEq(s.item, uint8(e.item), "item");
        assertEq(s.itemId, e.itemId, "itemId");
        assertEq(s.quantity, e.quantity, "quantity");
        assertEq(s.amountPaid, e.price, "amountPaid is the price charged");
        assertEq(s.contribution, want, "contribution is floor(5%)");
        assertEq(s.contribution, game.ubiContributionFor(e.price), "matches the contract's own formula");
        assertEq(s.recipient, ubi, "event recipient");
        assertEq(game.ubiRecipient(), ubi, "configured recipient");

        // 7. the recipient got exactly the contribution, in one transfer from the game; 8. the rest stays in the treasury
        assertEq(s.toUbi, 1, "one G$ transfer to UBI");
        assertEq(s.toUbiAmount, want, "transfer amount = contribution");
        assertEq(s.fromBuyer, 1, "one G$ transfer from the buyer");
        assertEq(s.fromBuyerAmount, e.price, "buyer transfer = price");
        assertEq(s.otherTransfers, 0, "no other G$ movement");
        assertEq(b0 - token.balanceOf(who), e.price, "buyer pays exactly the price");
        assertEq(token.balanceOf(ubi) - u0, want, "UBI balance up by the contribution");
        assertEq(token.balanceOf(address(game)) - t0, e.price - want, "treasury keeps the rest");

        // and the purchase actually delivered its item
        assertEq(_owned(k, who), owned0 + _granted(k), "item granted");
    }

    /// A per-kind measure of what the buyer owns, to confirm the purchase delivered.
    function _owned(Kind k, address who) internal view returns (uint256) {
        if (k == Kind.Shield) return game.shieldCount(who);
        if (k == Kind.Boost2x || k == Kind.Boost5x) {
            Game2048.XpBoost memory xb = game.getXpBoost(who);
            return xb.expiry > block.timestamp && xb.multiplier == (k == Kind.Boost2x ? 2 : 5) ? 1 : 0;
        }
        if (k == Kind.Undo1 || k == Kind.Undo3) return game.undoCredits(who);
        return game.cosmeticsOwned(who, COSMETIC_ID) ? 1 : 0;
    }

    function _granted(Kind k) internal pure returns (uint256) {
        if (k == Kind.Undo3) return 3;
        return 1;
    }

    function _fresh(Kind k, address who) internal view returns (bool) {
        // A boost or a cosmetic already owned can't "increase" ownership; reset-free kinds always can.
        return !((k == Kind.Boost2x || k == Kind.Boost5x || k == Kind.Cosmetic) && _owned(k, who) == 1);
    }

    // ─── Every paid purchase, one test each ──────────────────────────────────

    function test_Shield()   public { _buyAndCheck(Kind.Shield, buyer); }
    function test_Boost2x()  public { _buyAndCheck(Kind.Boost2x, buyer); }
    function test_Boost5x()  public { _buyAndCheck(Kind.Boost5x, buyer); }
    function test_Undo1()    public { _buyAndCheck(Kind.Undo1, buyer); }
    function test_Undo3()    public { _buyAndCheck(Kind.Undo3, buyer); }
    function test_Cosmetic() public { _buyAndCheck(Kind.Cosmetic, buyer); }

    function test_MatrixUsesTheProductRateAndRecipient() public view {
        assertEq(game.UBI_CONTRIBUTION_BPS(), 500, "5%");
        assertEq(game.ubiRecipient(), ubi);
    }

    /// The same matrix at prices that don't divide evenly, so floor rounding is exercised on every path.
    function test_AllPurchases_RoundDownAtOddPrices() public {
        game.setShopPrices(25e18 + 19, 50e18 + 39, 125e18 + 1, 40e18 + 7);
        game.setCosmeticPrice(COSMETIC_ID, 150e18 + 13);
        for (uint256 i = 0; i < KINDS; i++) _buyAndCheck(Kind(i), buyer);
    }

    /// Many purchases, two buyers, interleaved: each event and transfer belongs to its own purchase.
    function test_MultiplePurchases_AreEachCorrect() public {
        uint256 total;
        uint256 u0 = token.balanceOf(ubi);
        for (uint256 round = 0; round < 2; round++) {
            for (uint256 i = 0; i < KINDS; i++) {
                for (uint256 w = 0; w < 2; w++) {
                    address who = w == 0 ? buyer : buyer2;
                    Kind k = Kind(i);
                    if (!_fresh(k, who)) {
                        // a second boost replaces the first and a cosmetic is owned once; both still pay and contribute
                        Expect memory e = _expected(game, k);
                        vm.recordLogs();
                        vm.prank(who);
                        _purchase(game, k);
                        Seen memory s = _scan(vm.getRecordedLogs(), address(game), who);
                        assertEq(s.count, 1);
                        assertEq(s.buyer, who);
                        assertEq(s.contribution, _fivePercent(e.price));
                        assertEq(s.toUbiAmount, _fivePercent(e.price));
                        total += _fivePercent(e.price);
                        continue;
                    }
                    total += _fivePercent(_expected(game, k).price);
                    _buyAndCheck(k, who);
                }
            }
        }
        assertEq(token.balanceOf(ubi) - u0, total, "UBI received the sum of every contribution");
    }

    // ─── Failed purchases: no event, no transfer, nothing granted ────────────

    function _assertNothingHappened(Vm.Log[] memory logs, address who, uint256 b0, uint256 u0, uint256 t0) internal view {
        Seen memory s = _scan(logs, address(game), who);
        assertEq(s.count, 0, "no UbiContribution");
        assertEq(s.toUbi + s.fromBuyer + s.otherTransfers, 0, "no G$ transfer");
        assertEq(token.balanceOf(who), b0, "buyer not charged");
        assertEq(token.balanceOf(ubi), u0, "UBI unchanged");
        assertEq(token.balanceOf(address(game)), t0, "treasury unchanged");
    }

    /// A buyer who hasn't approved the game: every paid purchase fails cleanly.
    function test_FailedPayment_NoEventNoTransferNothingGranted() public {
        address poor = makeAddr("unapproved");
        token.mint(poor, 1_000e18);
        for (uint256 i = 0; i < KINDS; i++) {
            Kind k = Kind(i);
            uint256 owned0 = _owned(k, poor);
            (uint256 b0, uint256 u0, uint256 t0) = (token.balanceOf(poor), token.balanceOf(ubi), token.balanceOf(address(game)));
            vm.recordLogs();
            vm.prank(poor);
            try this.purchaseExternal(k) { assertTrue(false, "unapproved purchase must revert"); } catch (bytes memory err) {
                assertEq(err, abi.encodeWithSignature("Error(string)", "insufficient allowance"), "reverted in the payment");
            }
            _assertNothingHappened(vm.getRecordedLogs(), poor, b0, u0, t0);
            assertEq(_owned(k, poor), owned0, "nothing granted");
        }
    }

    /// External entry so try/catch can observe a revert from `_purchase`. Called under a prank,
    /// so msg.sender here is the buyer; the inner prank forwards that sender to the game.
    function purchaseExternal(Kind k) external {
        vm.prank(msg.sender);
        _purchase(game, k);
    }

    /// Insufficient balance (approved, but can't pay) fails the same way.
    function test_InsufficientBalance_NoEventNoTransfer() public {
        address broke = makeAddr("broke");
        vm.prank(broke);
        token.approve(address(game), type(uint256).max);
        for (uint256 i = 0; i < KINDS; i++) {
            (uint256 b0, uint256 u0, uint256 t0) = (token.balanceOf(broke), token.balanceOf(ubi), token.balanceOf(address(game)));
            vm.recordLogs();
            vm.prank(broke);
            try this.purchaseExternal(Kind(i)) { assertTrue(false, "unfunded purchase must revert"); } catch (bytes memory err) {
                assertEq(err, abi.encodeWithSignature("Error(string)", "insufficient balance"), "reverted in the payment");
            }
            _assertNothingHappened(vm.getRecordedLogs(), broke, b0, u0, t0);
        }
    }

    /// Unsupported or zero-value purchases revert before any payment: no misleading event.
    function test_UnsupportedPurchases_NoEvent() public {
        (uint256 b0, uint256 u0, uint256 t0) = (token.balanceOf(buyer), token.balanceOf(ubi), token.balanceOf(address(game)));
        vm.startPrank(buyer);
        vm.recordLogs();
        vm.expectRevert(Game2048.InvalidBoostMultiplier.selector);
        game.buyXpBoost(3);
        vm.expectRevert(bytes("Quantity must be > 0"));
        game.buyUndoMove(0);
        vm.expectRevert(Game2048.CosmeticDoesNotExist.selector);
        game.buyCosmetic(COSMETIC_ID + 1);
        vm.stopPrank();
        _assertNothingHappened(vm.getRecordedLogs(), buyer, b0, u0, t0);

        game.removeCosmeticItem(COSMETIC_ID);
        vm.recordLogs();
        vm.prank(buyer);
        vm.expectRevert(Game2048.CosmeticDoesNotExist.selector);
        game.buyCosmetic(COSMETIC_ID);
        _assertNothingHappened(vm.getRecordedLogs(), buyer, b0, u0, t0);
    }

    function test_ZeroPrices_RevertWithoutEvent() public {
        game.setShopPrices(0, 0, 0, 0);
        (uint256 b0, uint256 u0, uint256 t0) = (token.balanceOf(buyer), token.balanceOf(ubi), token.balanceOf(address(game)));
        for (uint256 i = 0; i < 5; i++) { // all but Cosmetic, whose catalog rejects a zero price at listing
            vm.recordLogs();
            vm.prank(buyer);
            try this.purchaseExternal(Kind(i)) { assertTrue(false, "zero-price purchase must revert"); } catch (bytes memory err) {
                assertEq(bytes4(err), Game2048.ZeroPriceNotAllowed.selector);
            }
            _assertNothingHappened(vm.getRecordedLogs(), buyer, b0, u0, t0);
        }
        vm.expectRevert(Game2048.ZeroPriceNotAllowed.selector);
        game.setCosmeticPrice(COSMETIC_ID, 0);
    }

    /// Prices whose 5% floors to zero: the purchase goes through, and there is no event and no UBI transfer
    /// (the contract's documented behaviour), so no zero-amount contribution can be shown as one.
    function test_DustPrices_NoContributionEventOnAnyPath() public {
        game.setShopPrices(19, 19, 19, 6); // Undo3 pays 18
        game.setCosmeticPrice(COSMETIC_ID, 19);
        for (uint256 i = 0; i < KINDS; i++) {
            Kind k = Kind(i);
            Expect memory e = _expected(game, k);
            assertEq(_fivePercent(e.price), 0);
            (uint256 b0, uint256 u0, uint256 t0) = (token.balanceOf(buyer), token.balanceOf(ubi), token.balanceOf(address(game)));
            vm.recordLogs();
            vm.prank(buyer);
            _purchase(game, k);
            Seen memory s = _scan(vm.getRecordedLogs(), address(game), buyer);
            assertEq(s.count, 0, "no event for a zero contribution");
            assertEq(s.toUbi, 0, "no transfer to UBI");
            assertEq(b0 - token.balanceOf(buyer), e.price);
            assertEq(token.balanceOf(ubi), u0);
            assertEq(token.balanceOf(address(game)) - t0, e.price, "treasury keeps all of it");
        }
    }

    // ─── A failing UBI transfer reverts the whole purchase, on every path ────

    function _misbehavingGame(MockMisbehavingERC20.Mode mode, address target)
        internal returns (Game2048 g, MockMisbehavingERC20 bad)
    {
        bad = new MockMisbehavingERC20();
        g = _deploy(address(bad), ubi);
        g.setCosmeticPrice(COSMETIC_ID, 150e18);
        bad.mint(buyer, 1_000_000e18);
        vm.prank(buyer);
        bad.approve(address(g), type(uint256).max);
        bad.setMisbehaviour(target, mode);
    }

    function _assertAtomicFailure(Game2048 g, MockMisbehavingERC20 bad, bytes memory why) internal {
        for (uint256 i = 0; i < KINDS; i++) {
            Kind k = Kind(i);
            vm.recordLogs();
            vm.prank(buyer);
            try this.purchaseOn(g, k) { assertTrue(false, "purchase must revert when its UBI transfer fails"); } catch (bytes memory err) {
                assertEq(err, why, "reverted for the expected reason");
            }
            Seen memory s = _scan(vm.getRecordedLogs(), address(g), buyer);
            assertEq(s.count, 0, "no UbiContribution");
            assertEq(bad.balanceOf(buyer), 1_000_000e18, "buyer not charged");
            assertEq(bad.balanceOf(ubi), 0, "UBI got nothing");
            assertEq(bad.balanceOf(address(g)), 0, "treasury got nothing");
            assertEq(g.shieldCount(buyer) + g.undoCredits(buyer) + g.getXpBoost(buyer).expiry, 0, "nothing granted");
            assertFalse(g.cosmeticsOwned(buyer, COSMETIC_ID), "no cosmetic");
        }
    }

    function purchaseOn(Game2048 g, Kind k) external {
        vm.prank(msg.sender);
        _purchase(g, k);
    }

    function test_RecipientReverts_EveryPurchaseRevertsAtomically() public {
        (Game2048 g, MockMisbehavingERC20 bad) = _misbehavingGame(MockMisbehavingERC20.Mode.Revert, ubi);
        _assertAtomicFailure(g, bad, abi.encodeWithSignature("Error(string)", "recipient rejected"));
    }

    function test_RecipientReturnsFalse_EveryPurchaseRevertsAtomically() public {
        (Game2048 g, MockMisbehavingERC20 bad) = _misbehavingGame(MockMisbehavingERC20.Mode.ReturnFalse, ubi);
        _assertAtomicFailure(g, bad, abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
    }

    function test_PaymentReturnsFalse_EveryPurchaseRevertsAtomically() public {
        (Game2048 g, MockMisbehavingERC20 bad) = _misbehavingGame(MockMisbehavingERC20.Mode.ReturnFalse, address(0));
        // target = the game: the buyer's payment itself "succeeds" with false
        bad.setMisbehaviour(address(g), MockMisbehavingERC20.Mode.ReturnFalse);
        _assertAtomicFailure(g, bad, abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
    }
}
