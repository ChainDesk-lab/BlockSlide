// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Game2048 } from "./Game2048.sol";
import { MockERC20 } from "./test/MockERC20.sol";
import { MockIdentity } from "./test/MockIdentity.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract Game2048Test is Test {
    Game2048 game;
    MockERC20 token;
    MockIdentity id;

    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");

    bytes32 constant SEED      = bytes32(uint256(0xdeadbeef));
    bytes32 immutable SEED_HASH = keccak256(abi.encodePacked(SEED));

    function setUp() public {
        token = new MockERC20();
        id    = new MockIdentity();

        Game2048 impl = new Game2048();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Game2048.initialize, (address(token), address(id)))
        );
        game = Game2048(address(proxy));

        token.mint(address(this), 10_000e18);
        token.approve(address(game), type(uint256).max);
        game.fundTreasury(10_000e18);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _startSession(address player) internal {
        id.whitelist(player);
        vm.prank(player);
        game.startSession(SEED_HASH);
    }

    function _submit(address player, uint256 score, uint32 tile, uint256 combo) internal {
        vm.prank(player);
        game.submitScore(score, tile, 100, SEED, combo);
    }

    function _playAndSubmit(address player, uint32 tile) internal {
        _startSession(player);
        _submit(player, tile * 4, tile, 0);
    }

    // ─── startSession ─────────────────────────────────────────────────────────

    function test_StartSession_RevertsIfNotWhitelisted() public {
        vm.prank(alice);
        vm.expectRevert(Game2048.NotVerifiedHuman.selector);
        game.startSession(SEED_HASH);
    }

    function test_StartSession_CreatesSession() public {
        _startSession(alice);
        Game2048.Session memory s = game.getSession(alice);
        assertTrue(s.active);
        assertEq(s.seedHash, SEED_HASH);
    }

    function test_StartSession_RevertsIfAlreadyActive() public {
        _startSession(alice);
        id.whitelist(alice);
        vm.prank(alice);
        vm.expectRevert(Game2048.SessionAlreadyActive.selector);
        game.startSession(SEED_HASH);
    }

    function test_StartSession_AutoExpiresTimedOutSession() public {
        _startSession(alice);
        vm.warp(block.timestamp + game.SESSION_TIMEOUT() + 1);
        _startSession(alice);
        assertTrue(game.getSession(alice).active);
    }

    // ─── submitScore ──────────────────────────────────────────────────────────

    function test_SubmitScore_RevertsWithNoActiveSession() public {
        vm.prank(alice);
        vm.expectRevert(Game2048.NoActiveSession.selector);
        game.submitScore(1000, 256, 100, SEED, 0);
    }

    function test_SubmitScore_RevertsOnExpiredSession() public {
        _startSession(alice);
        vm.warp(block.timestamp + game.SESSION_TIMEOUT() + 1);
        vm.prank(alice);
        vm.expectRevert(Game2048.SessionExpired.selector);
        game.submitScore(1000, 256, 100, SEED, 0);
    }

    function test_SubmitScore_RevertsOnWrongSeed() public {
        _startSession(alice);
        vm.prank(alice);
        vm.expectRevert(Game2048.InvalidSeed.selector);
        game.submitScore(1000, 256, 100, bytes32(uint256(0xbadbeef)), 0);
    }

    function test_SubmitScore_RevertsOnInvalidMoveCount() public {
        _startSession(alice);
        vm.prank(alice);
        vm.expectRevert(Game2048.InvalidMoveCount.selector);
        game.submitScore(1000, 256, 0, SEED, 0);
    }

    function test_SubmitScore_RevertsOnComboExceedingMoves() public {
        _startSession(alice);
        vm.prank(alice);
        vm.expectRevert(Game2048.InvalidComboCount.selector);
        game.submitScore(1000, 256, 10, SEED, 11); // combo > moveCount
    }

    function test_SubmitScore_RevertsOnNonPowerOfTwoTile() public {
        _startSession(alice);
        vm.prank(alice);
        vm.expectRevert(Game2048.InvalidTileValue.selector);
        game.submitScore(1000, 300, 100, SEED, 0);
    }

    function test_SubmitScore_RevertsOnTileTooHigh() public {
        _startSession(alice);
        vm.prank(alice);
        vm.expectRevert(Game2048.InvalidTileValue.selector);
        game.submitScore(1000, 262144, 100, SEED, 0);
    }

    function test_SubmitScore_HappyPath() public {
        _startSession(alice);
        _submit(alice, 5000, 512, 0);
        assertEq(game.bestScore(alice), 5000);
        assertEq(game.bestTile(alice), 512);
        assertFalse(game.getSession(alice).active);
    }

    // ─── XP ───────────────────────────────────────────────────────────────────

    function test_Xp_BaseEarned() public {
        _playAndSubmit(alice, 256);
        // score = 256 * 4 = 1024, base XP = 1024 / 10 = 102
        assertEq(game.xp(alice), uint256(1024) / 10);
    }

    function test_Xp_ComboMultiplier() public {
        _startSession(alice);
        uint256 score = 1000;
        _submit(alice, score, 256, 5); // combo = 5 → 5× XP
        assertEq(game.xp(alice), (score / 10) * 5);
    }

    function test_Xp_NoComboUnderThreshold() public {
        _startSession(alice);
        uint256 score = 1000;
        _submit(alice, score, 256, 4); // combo = 4 → no multiplier
        assertEq(game.xp(alice), score / 10);
    }

    function test_Xp_BoostMultiplier2x() public {
        token.mint(alice, 1000e18);
        vm.prank(alice);
        token.approve(address(game), type(uint256).max);
        vm.prank(alice);
        game.buyXpBoost(2);

        _startSession(alice);
        uint256 score = 1000;
        _submit(alice, score, 256, 0);
        assertEq(game.xp(alice), (score / 10) * 2);
    }

    function test_Xp_BoostMultiplier5x() public {
        token.mint(alice, 1000e18);
        vm.prank(alice);
        token.approve(address(game), type(uint256).max);
        vm.prank(alice);
        game.buyXpBoost(5);

        _startSession(alice);
        uint256 score = 1000;
        _submit(alice, score, 256, 0);
        assertEq(game.xp(alice), (score / 10) * 5);
    }

    function test_Xp_ComboAndBoostStack() public {
        token.mint(alice, 1000e18);
        vm.prank(alice);
        token.approve(address(game), type(uint256).max);
        vm.prank(alice);
        game.buyXpBoost(2);

        _startSession(alice);
        uint256 score = 1000;
        _submit(alice, score, 256, 5); // combo 5× + boost 2× = 10×
        assertEq(game.xp(alice), (score / 10) * 5 * 2);
    }

    function test_Xp_BoostExpired() public {
        token.mint(alice, 1000e18);
        vm.prank(alice);
        token.approve(address(game), type(uint256).max);
        vm.prank(alice);
        game.buyXpBoost(2);

        vm.warp(block.timestamp + game.BOOST_DURATION() + 1);

        _startSession(alice);
        uint256 score = 1000;
        _submit(alice, score, 256, 0);
        assertEq(game.xp(alice), score / 10); // no boost
    }

    // ─── Streaks ──────────────────────────────────────────────────────────────

    function test_Streak_StartsAt1() public {
        _playAndSubmit(alice, 256);
        assertEq(game.streakCount(alice), 1);
    }

    function test_Streak_IncreasesNextDay() public {
        _playAndSubmit(alice, 256);
        vm.warp(block.timestamp + 25 hours);
        _playAndSubmit(alice, 256);
        assertEq(game.streakCount(alice), 2);
    }

    function test_Streak_NoChangePlayingSameDay() public {
        _playAndSubmit(alice, 256);
        vm.warp(block.timestamp + 1 hours);
        _playAndSubmit(alice, 256);
        assertEq(game.streakCount(alice), 1);
    }

    function test_Streak_ResetsAfterMissedDay() public {
        _playAndSubmit(alice, 256);
        vm.warp(block.timestamp + 49 hours); // > 48 h gap
        _playAndSubmit(alice, 256);
        assertEq(game.streakCount(alice), 1); // reset
    }

    function test_Streak_ShieldProtectsAgainstBreak() public {
        token.mint(alice, 1000e18);
        vm.prank(alice);
        token.approve(address(game), type(uint256).max);

        _playAndSubmit(alice, 256); // streak = 1
        vm.prank(alice);
        game.buyStreakShield(); // shieldCount = 1

        vm.warp(block.timestamp + 49 hours); // miss a day
        _playAndSubmit(alice, 256);
        assertEq(game.streakCount(alice), 2);  // streak continues
        assertEq(game.shieldCount(alice), 0);  // shield consumed
    }

    function test_Streak_ShieldConsumedOnUse() public {
        token.mint(alice, 1000e18);
        vm.prank(alice);
        token.approve(address(game), type(uint256).max);

        _playAndSubmit(alice, 256);
        vm.prank(alice);
        game.buyStreakShield(); // shieldCount = 1

        vm.warp(block.timestamp + 49 hours);
        _playAndSubmit(alice, 256); // burns shield, streak = 2, shieldCount = 0

        // Miss again — no shield left, streak resets
        vm.warp(block.timestamp + 49 hours);
        _playAndSubmit(alice, 256);
        assertEq(game.streakCount(alice), 1);
    }

    function test_Streak_StackedShields() public {
        token.mint(alice, 1000e18);
        vm.prank(alice);
        token.approve(address(game), type(uint256).max);

        _playAndSubmit(alice, 256);
        vm.prank(alice); game.buyStreakShield();
        vm.prank(alice); game.buyStreakShield();
        assertEq(game.shieldCount(alice), 2);

        vm.warp(block.timestamp + 49 hours);
        _playAndSubmit(alice, 256); // burns one shield
        assertEq(game.shieldCount(alice), 1);
        assertEq(game.streakCount(alice), 2);

        vm.warp(block.timestamp + 49 hours);
        _playAndSubmit(alice, 256); // burns second shield
        assertEq(game.shieldCount(alice), 0);
        assertEq(game.streakCount(alice), 3);
    }

    // ─── Shop ─────────────────────────────────────────────────────────────────

    function test_Shop_BuyShield() public {
        token.mint(alice, 1000e18);
        vm.prank(alice);
        token.approve(address(game), type(uint256).max);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        game.buyStreakShield();

        assertEq(token.balanceOf(alice), before - game.shieldPrice());
        assertEq(game.shieldCount(alice), 1);
    }

    function test_Shop_BuyBoostInvalidMultiplier() public {
        vm.expectRevert(Game2048.InvalidBoostMultiplier.selector);
        game.buyXpBoost(3);
    }

    function test_Shop_SetPricesOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        game.setShopPrices(1e18, 2e18, 5e18);
    }

    function test_Shop_SetPrices() public {
        game.setShopPrices(1e18, 2e18, 5e18);
        assertEq(game.shieldPrice(), 1e18);
        assertEq(game.boost2xPrice(), 2e18);
        assertEq(game.boost5xPrice(), 5e18);
    }

    // ─── Milestone rewards ────────────────────────────────────────────────────

    function test_Reward_256() public {
        uint256 before = token.balanceOf(alice);
        _playAndSubmit(alice, 256);
        assertEq(token.balanceOf(alice) - before, game.REWARD_256());
    }

    function test_Reward_512_IncludesLowerTiers() public {
        uint256 before = token.balanceOf(alice);
        _playAndSubmit(alice, 512);
        assertEq(token.balanceOf(alice) - before, game.REWARD_512() + game.REWARD_256());
    }

    function test_Reward_2048_AllTiers() public {
        uint256 before = token.balanceOf(alice);
        _playAndSubmit(alice, 2048);
        uint256 expected = game.REWARD_2048() + game.REWARD_1024() + game.REWARD_512() + game.REWARD_256();
        assertEq(token.balanceOf(alice) - before, expected);
    }

    function test_Reward_NotClaimedTwice() public {
        _playAndSubmit(alice, 256);
        uint256 afterFirst = token.balanceOf(alice);
        _playAndSubmit(alice, 256);
        assertEq(token.balanceOf(alice), afterFirst);
    }

    function test_Reward_SkipsIfTreasuryDry() public {
        game.withdrawTreasury(token.balanceOf(address(game)));
        uint256 before = token.balanceOf(alice);
        _playAndSubmit(alice, 2048);
        assertEq(token.balanceOf(alice), before);
    }

    // ─── Leaderboard ──────────────────────────────────────────────────────────

    function test_Leaderboard_PopulatesOnSubmit() public {
        _playAndSubmit(alice, 512);
        Game2048.LeaderboardEntry[10] memory board = game.getLeaderboard();
        assertEq(board[0].player, alice);
        assertEq(board[0].highestTile, 512);
    }

    function test_Leaderboard_KeepsTopScores() public {
        for (uint256 i = 0; i < 10; i++) {
            address player = makeAddr(string(abi.encodePacked("p", i)));
            id.whitelist(player);
            vm.prank(player);
            game.startSession(SEED_HASH);
            vm.prank(player);
            game.submitScore((i + 1) * 100, 256, 10, SEED, 0);
        }

        _playAndSubmit(bob, 256);
        vm.prank(bob);
        game.startSession(SEED_HASH);
        vm.prank(bob);
        game.submitScore(50, 256, 10, SEED, 0);

        Game2048.LeaderboardEntry[10] memory board = game.getLeaderboard();
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(board[i].score >= 100, "Low score should not displace existing entries");
        }
    }

    // ─── expireSession ────────────────────────────────────────────────────────

    function test_ExpireSession_ByThirdParty() public {
        _startSession(alice);
        vm.warp(block.timestamp + game.SESSION_TIMEOUT() + 1);
        game.expireSession(alice);
        assertFalse(game.getSession(alice).active);
    }

    function test_ExpireSession_RevertsIfNotExpiredYet() public {
        _startSession(alice);
        vm.expectRevert("Not expired yet");
        game.expireSession(alice);
    }

    // ─── Owner ────────────────────────────────────────────────────────────────

    function test_TransferOwnership() public {
        game.transferOwnership(alice);
        assertEq(game.owner(), alice);
    }

    function test_TransferOwnership_RejectsZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        game.transferOwnership(address(0));
    }

    function test_WithdrawTreasury_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        game.withdrawTreasury(1e18);
    }
}
