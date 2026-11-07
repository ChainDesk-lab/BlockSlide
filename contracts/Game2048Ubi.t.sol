// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Game2048 } from "./Game2048.sol";
import { MockERC20 } from "./test/MockERC20.sol";
import { MockIdentity } from "./test/MockIdentity.sol";
import { MockMisbehavingERC20, MockReentrantERC20, IShop } from "./test/MockMisbehavingERC20.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// 5% GoodDollar UBI contribution on every paid shop purchase.
contract Game2048UbiTest is Test {
    Game2048 game;
    MockERC20 token;
    MockIdentity id;

    address alice = makeAddr("alice");
    address ubi   = makeAddr("ubi");

    event UbiContribution(
        address indexed buyer,
        Game2048.ShopItem indexed item,
        uint256 itemId,
        uint256 quantity,
        uint256 amountPaid,
        uint256 contribution,
        address indexed recipient
    );

    function _deploy(address tok, address recipient) internal returns (Game2048) {
        Game2048 impl = new Game2048(recipient);
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Game2048.initialize, (tok, address(id)))
        );
        return Game2048(address(proxy));
    }

    function setUp() public {
        token = new MockERC20();
        id    = new MockIdentity();
        game  = _deploy(address(token), ubi);
        token.mint(alice, 1_000_000e18);
        vm.prank(alice);
        token.approve(address(game), type(uint256).max);
    }

    /// Buyer pays exactly `price`; UBI gets floor(5%); treasury keeps the rest.
    function _assertSplit(uint256 aliceBefore, uint256 ubiBefore, uint256 treasuryBefore, uint256 price) internal view {
        uint256 contribution = (price * 500) / 10_000;
        assertEq(token.balanceOf(alice), aliceBefore - price, "buyer pays exactly the price");
        assertEq(token.balanceOf(ubi), ubiBefore + contribution, "UBI receives 5%");
        assertEq(token.balanceOf(address(game)), treasuryBefore + price - contribution, "treasury keeps the rest");
    }

    function _balances() internal view returns (uint256, uint256, uint256) {
        return (token.balanceOf(alice), token.balanceOf(ubi), token.balanceOf(address(game)));
    }

    // ─── Configuration ────────────────────────────────────────────────────────

    function test_RateIsFivePercentAndWithinCap() public view {
        assertEq(game.UBI_CONTRIBUTION_BPS(), 500);
        assertLe(game.UBI_CONTRIBUTION_BPS(), game.MAX_UBI_CONTRIBUTION_BPS());
        assertEq(game.MAX_UBI_CONTRIBUTION_BPS(), 1_000);
    }

    function test_RecipientIsReadThroughTheProxy() public view {
        assertEq(game.ubiRecipient(), ubi);
    }

    function test_ZeroRecipientIsRejected() public {
        vm.expectRevert(Game2048.InvalidUbiRecipient.selector);
        new Game2048(address(0));
    }

    // ─── Every paid item contributes 5% ───────────────────────────────────────

    function test_Shield_Contributes5Percent() public {
        (uint256 a, uint256 u, uint256 t) = _balances();
        vm.prank(alice);
        game.buyStreakShield();
        _assertSplit(a, u, t, 25e18);
        assertEq(token.balanceOf(ubi), 1.25e18);
        assertEq(game.shieldCount(alice), 1);
    }

    function test_Boost2x_Contributes5Percent() public {
        (uint256 a, uint256 u, uint256 t) = _balances();
        vm.prank(alice);
        game.buyXpBoost(2);
        _assertSplit(a, u, t, 50e18);
    }

    function test_Boost5x_Contributes5Percent() public {
        (uint256 a, uint256 u, uint256 t) = _balances();
        vm.prank(alice);
        game.buyXpBoost(5);
        _assertSplit(a, u, t, 125e18);
    }

    function test_UndoMove_ContributesOnTheTotal() public {
        (uint256 a, uint256 u, uint256 t) = _balances();
        vm.prank(alice);
        game.buyUndoMove(3); // 3 × 40 G$
        _assertSplit(a, u, t, 120e18);
        assertEq(token.balanceOf(ubi), 6e18);
        assertEq(game.undoCredits(alice), 3);
    }

    function test_Cosmetic_Contributes5Percent() public {
        game.setCosmeticPrice(1, 150e18);
        (uint256 a, uint256 u, uint256 t) = _balances();
        vm.prank(alice);
        game.buyCosmetic(1);
        _assertSplit(a, u, t, 150e18);
        assertTrue(game.cosmeticsOwned(alice, 1));
    }

    function test_NewlyPricedItems_UseTheSamePolicy() public {
        // An item priced later (a new cosmetic id) contributes with no other change.
        game.setCosmeticPrice(42, 77e18);
        (uint256 a, uint256 u, uint256 t) = _balances();
        vm.prank(alice);
        game.buyCosmetic(42);
        _assertSplit(a, u, t, 77e18);
    }

    function test_EmitsContributionEvent() public {
        vm.expectEmit(true, true, true, true, address(game));
        emit UbiContribution(alice, Game2048.ShopItem.XpBoost, 5, 1, 125e18, 6.25e18, ubi);
        vm.prank(alice);
        game.buyXpBoost(5);
    }

    // ─── Rounding ─────────────────────────────────────────────────────────────

    function test_Rounding_FloorsAndNeverOvercharges() public {
        uint256[6] memory prices = [uint256(1), 19, 20, 39, 40, 1e18 + 19];
        uint256[6] memory want   = [uint256(0), 0, 1, 1, 2, 5e16];
        for (uint256 i = 0; i < prices.length; i++) {
            game.setShopPrices(prices[i], 50e18, 125e18, 40e18);
            (uint256 a, uint256 u, uint256 t) = _balances();
            vm.prank(alice);
            game.buyStreakShield();
            assertEq(token.balanceOf(ubi) - u, want[i], "contribution");
            assertEq(a - token.balanceOf(alice), prices[i], "buyer charged exactly the price");
            assertEq(token.balanceOf(address(game)) - t, prices[i] - want[i], "treasury share");
        }
    }

    function test_Rounding_NoEventWhenContributionRoundsToZero() public {
        game.setShopPrices(19, 50e18, 125e18, 40e18);
        vm.recordLogs();
        vm.prank(alice);
        game.buyStreakShield();
        bytes32 sig = keccak256("UbiContribution(address,uint8,uint256,uint256,uint256,uint256,address)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) assertTrue(logs[i].topics[0] != sig, "no contribution event for 0");
    }

    function testFuzz_ContributionIsFloorOfFivePercent(uint256 amount) public view {
        amount = bound(amount, 0, type(uint256).max / 500);
        uint256 c = game.ubiContributionFor(amount);
        assertEq(c, (amount * 500) / 10_000);
        assertLe(c * 20, amount); // never more than 5%
        assertLt(amount - c * 20, 20); // and loses less than 20 base units to rounding
    }

    function test_LargeAmounts() public {
        uint256 big = 1e30;
        token.mint(alice, big);
        game.setShopPrices(big, 50e18, 125e18, 40e18);
        (uint256 a, uint256 u, uint256 t) = _balances();
        vm.prank(alice);
        game.buyStreakShield();
        _assertSplit(a, u, t, big);
    }

    function test_ContributionMathRevertsRatherThanOverflowing() public {
        vm.expectRevert(); // checked arithmetic: amounts no wallet can hold
        game.ubiContributionFor(type(uint256).max);
    }

    // ─── Free items and failed purchases ──────────────────────────────────────

    function test_FreeItems_RevertAndContributeNothing() public {
        game.setShopPrices(0, 0, 0, 0);
        uint256 u = token.balanceOf(ubi);
        vm.startPrank(alice);
        vm.expectRevert(Game2048.ZeroPriceNotAllowed.selector);
        game.buyStreakShield();
        vm.expectRevert(Game2048.ZeroPriceNotAllowed.selector);
        game.buyXpBoost(2);
        vm.expectRevert(Game2048.ZeroPriceNotAllowed.selector);
        game.buyUndoMove(1);
        vm.stopPrank();
        assertEq(token.balanceOf(ubi), u);
    }

    function test_FailedPurchase_LeavesNoContribution() public {
        vm.prank(alice);
        vm.expectRevert(Game2048.CosmeticDoesNotExist.selector);
        game.buyCosmetic(999);
        assertEq(token.balanceOf(ubi), 0);
    }

    function test_FundTreasury_IsNotAPurchase() public {
        token.mint(address(this), 100e18);
        token.approve(address(game), 100e18);
        game.fundTreasury(100e18);
        assertEq(token.balanceOf(ubi), 0);
    }

    function test_EachPurchaseChargesOnce() public {
        (uint256 a, uint256 u,) = _balances();
        vm.startPrank(alice);
        game.buyStreakShield();
        game.buyStreakShield();
        vm.stopPrank();
        assertEq(a - token.balanceOf(alice), 50e18); // two purchases, two prices — nothing extra
        assertEq(token.balanceOf(ubi) - u, 2.5e18);
        assertEq(game.shieldCount(alice), 2);
    }

    // ─── Atomicity: a failing contribution reverts the purchase ───────────────

    function _misbehavingGame() internal returns (Game2048 g, MockMisbehavingERC20 bad) {
        bad = new MockMisbehavingERC20();
        g = _deploy(address(bad), ubi);
        bad.mint(alice, 1_000e18);
        vm.prank(alice);
        bad.approve(address(g), type(uint256).max);
    }

    function test_RecipientRevert_RevertsThePurchase() public {
        (Game2048 g, MockMisbehavingERC20 bad) = _misbehavingGame();
        bad.setMisbehaviour(ubi, MockMisbehavingERC20.Mode.Revert);
        vm.prank(alice);
        vm.expectRevert(bytes("recipient rejected"));
        g.buyStreakShield();
        assertEq(bad.balanceOf(alice), 1_000e18, "buyer not charged");
        assertEq(g.shieldCount(alice), 0, "no item granted");
    }

    function test_RecipientReturnsFalse_RevertsThePurchase() public {
        (Game2048 g, MockMisbehavingERC20 bad) = _misbehavingGame();
        bad.setMisbehaviour(ubi, MockMisbehavingERC20.Mode.ReturnFalse);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        g.buyStreakShield();
        assertEq(bad.balanceOf(alice), 1_000e18);
        assertEq(bad.balanceOf(ubi), 0);
        assertEq(g.shieldCount(alice), 0);
    }

    function test_PaymentReturnsFalse_RevertsInsteadOfGivingAFreeItem() public {
        (Game2048 g, MockMisbehavingERC20 bad) = _misbehavingGame();
        bad.setMisbehaviour(address(g), MockMisbehavingERC20.Mode.ReturnFalse);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        g.buyStreakShield();
        assertEq(g.shieldCount(alice), 0);
    }

    function test_Reentrancy_IsRejected() public {
        MockReentrantERC20 evil = new MockReentrantERC20();
        Game2048 g = _deploy(address(evil), ubi);
        evil.mint(alice, 1_000e18);
        vm.prank(alice);
        evil.approve(address(g), type(uint256).max);
        evil.arm(IShop(address(g)));
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        g.buyStreakShield();
        assertEq(g.shieldCount(alice), 0);
        assertEq(evil.balanceOf(ubi), 0);
    }

    // ─── Upgrades and existing behaviour ──────────────────────────────────────

    function test_OnlyOwnerCanUpgrade() public {
        Game2048 next = new Game2048(makeAddr("other"));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        game.upgradeToAndCall(address(next), "");
    }

    function test_Upgrade_KeepsStateAndUsesTheNewImplementationsRecipient() public {
        vm.prank(alice);
        game.buyStreakShield();
        address other = makeAddr("other");
        game.upgradeToAndCall(address(new Game2048(other)), "");
        assertEq(game.shieldCount(alice), 1, "state kept");
        assertEq(game.ubiRecipient(), other);
        vm.prank(alice);
        game.buyStreakShield();
        assertEq(token.balanceOf(other), 1.25e18);
    }

    function test_InitializerCannotBeCalledAgain() public {
        vm.expectRevert();
        game.initialize(address(token), address(id));
    }
}

import { Vm } from "forge-std/Vm.sol";
