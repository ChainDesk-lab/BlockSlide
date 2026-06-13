// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// GoodDollar IdentityV2 — isWhitelisted returns true for verified humans
interface IIdentity {
    function isWhitelisted(address user) external view returns (bool);
}

/// @title BlockSlide — onchain 2048 with G$ milestone rewards, XP, streaks, and a shop
///
/// Anti-cheat: player commits keccak256(seed) before playing. On submit, the seed
/// is revealed and verified, preventing cherry-picking a lucky seed post-game.
///
/// Shop (G$ payments go to treasury):
///   - Streak Shield: protects against one streak break, lasts 24 h from purchase.
///   - 2x / 5x XP Boost: multiplies XP earned from games for 24 h.
///
/// XP:
///   - Base XP per game = score / 10.
///   - Achieving a 5-move combo (5 consecutive merging moves) multiplies that
///     game's XP by 5 before any boost is applied.
///   - An active XP boost then multiplies the result by 2 or 5.
///
/// Upgradeable via UUPS proxy — only the owner can authorize upgrades.
contract Game2048 is Initializable, UUPSUpgradeable, OwnableUpgradeable {

    // ─── Interfaces ───────────────────────────────────────────────────────────

    IERC20    public gDollar;
    IIdentity public identity;

    // ─── Milestone reward constants ───────────────────────────────────────────

    uint256 public constant REWARD_256  = 5e18;
    uint256 public constant REWARD_512  = 15e18;
    uint256 public constant REWARD_1024 = 40e18;
    uint256 public constant REWARD_2048 = 100e18;

    uint256 public constant SESSION_TIMEOUT = 2 hours;
    uint256 public constant BOOST_DURATION  = 24 hours;

    uint8 private constant MILESTONE_256  = 1 << 0;
    uint8 private constant MILESTONE_512  = 1 << 1;
    uint8 private constant MILESTONE_1024 = 1 << 2;
    uint8 private constant MILESTONE_2048 = 1 << 3;

    uint256 public constant COMBO_THRESHOLD    = 5;  // moves needed to trigger 5x XP
    uint256 public constant COMBO_XP_MULTIPLIER = 5;

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Session {
        bool   active;
        uint64 startTime;
        bytes32 seedHash;
    }

    struct LeaderboardEntry {
        address player;
        uint256 score;
        uint32  highestTile;
    }

    struct XpBoost {
        uint8  multiplier; // 2 or 5
        uint64 expiry;     // unix timestamp
    }

    // ─── Core game state ──────────────────────────────────────────────────────

    mapping(address => Session)          public sessions;
    mapping(address => uint256)          public bestScore;
    mapping(address => uint32)           public bestTile;
    mapping(address => uint8)            public claimedMilestones;

    LeaderboardEntry[10] private _leaderboard;

    // ─── XP & shop state ──────────────────────────────────────────────────────

    mapping(address => uint256)  public xp;
    mapping(address => uint256)  public streakCount;
    mapping(address => uint256)  public lastPlayTimestamp;
    mapping(address => uint256)  public shieldCount;    // shields in inventory
    mapping(address => XpBoost)  public xpBoost;

    // Shop prices (G$, owner-adjustable)
    uint256 public shieldPrice;
    uint256 public boost2xPrice;
    uint256 public boost5xPrice;

    // ─── Events ───────────────────────────────────────────────────────────────

    event SessionStarted(address indexed player);
    event ScoreSubmitted(address indexed player, uint256 score, uint32 highestTile);
    event RewardPaid(address indexed player, uint32 milestone, uint256 amount);
    event XpEarned(address indexed player, uint256 amount, uint256 total);
    event StreakUpdated(address indexed player, uint256 streak);
    event ShieldPurchased(address indexed player, uint256 count);
    event XpBoostPurchased(address indexed player, uint8 multiplier, uint64 expiry);
    event ShopPricesUpdated(uint256 shield, uint256 boost2x, uint256 boost5x);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotVerifiedHuman();
    error SessionAlreadyActive();
    error NoActiveSession();
    error SessionExpired();
    error InvalidSeed();
    error InvalidMoveCount();
    error InvalidTileValue();
    error InvalidComboCount();
    error InvalidBoostMultiplier();

    // ─── Init ─────────────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _gDollar, address _identity) external initializer {
        __Ownable_init(msg.sender);
        gDollar  = IERC20(_gDollar);
        identity = IIdentity(_identity);
        // Default shop prices
        shieldPrice  = 25e18;  // 25 G$
        boost2xPrice = 50e18;  // 50 G$
        boost5xPrice = 125e18; // 125 G$
    }

    // ─── Game ─────────────────────────────────────────────────────────────────

    /// Start a new game session. Caller must be a GoodDollar-verified human.
    /// @param seedHash keccak256(seed) — seed drives tile spawning client-side
    function startSession(bytes32 seedHash) external {
        if (!identity.isWhitelisted(msg.sender)) revert NotVerifiedHuman();

        Session storage session = sessions[msg.sender];

        if (session.active && block.timestamp > session.startTime + SESSION_TIMEOUT) {
            session.active = false;
        }
        if (session.active) revert SessionAlreadyActive();

        sessions[msg.sender] = Session({
            active:    true,
            startTime: uint64(block.timestamp),
            seedHash:  seedHash
        });

        emit SessionStarted(msg.sender);
    }

    /// Submit result of a completed game.
    /// @param score        Final score
    /// @param highestTile  Highest tile reached (power of 2, 2–131072)
    /// @param moveCount    Total moves made (1–10 000)
    /// @param seed         Seed revealed to match the committed hash
    /// @param comboMoves   Longest run of consecutive merging moves achieved
    function submitScore(
        uint256 score,
        uint32  highestTile,
        uint256 moveCount,
        bytes32 seed,
        uint256 comboMoves
    ) external {
        Session storage session = sessions[msg.sender];
        if (!session.active)                                              revert NoActiveSession();
        if (block.timestamp > session.startTime + SESSION_TIMEOUT)       revert SessionExpired();
        if (keccak256(abi.encodePacked(seed)) != session.seedHash)       revert InvalidSeed();
        if (moveCount < 1 || moveCount > 10_000)                         revert InvalidMoveCount();
        if (comboMoves > moveCount)                                       revert InvalidComboCount();
        if (highestTile < 2 || highestTile > 131_072)                    revert InvalidTileValue();
        if ((highestTile & (highestTile - 1)) != 0)                      revert InvalidTileValue();

        session.active = false;

        if (score > bestScore[msg.sender]) bestScore[msg.sender] = score;
        if (highestTile > bestTile[msg.sender]) bestTile[msg.sender] = highestTile;

        emit ScoreSubmitted(msg.sender, score, highestTile);

        _awardXp(msg.sender, score, comboMoves);
        _updateStreak(msg.sender);
        _payMilestoneRewards(highestTile);
        _updateLeaderboard(msg.sender, score, highestTile);
    }

    /// Anyone can expire a timed-out session.
    function expireSession(address player) external {
        Session storage session = sessions[player];
        if (!session.active) revert NoActiveSession();
        require(block.timestamp > session.startTime + SESSION_TIMEOUT, "Not expired yet");
        session.active = false;
    }

    // ─── Shop ─────────────────────────────────────────────────────────────────

    /// Buy one streak shield. Shields sit in inventory until a missed day consumes one.
    function buyStreakShield() external {
        gDollar.transferFrom(msg.sender, address(this), shieldPrice);
        uint256 count = ++shieldCount[msg.sender];
        emit ShieldPurchased(msg.sender, count);
    }

    /// Buy an XP boost that multiplies game XP earned for 24 h.
    /// @param multiplier 2 for 2× boost, 5 for 5× boost
    function buyXpBoost(uint8 multiplier) external {
        if (multiplier != 2 && multiplier != 5) revert InvalidBoostMultiplier();
        uint256 price = multiplier == 2 ? boost2xPrice : boost5xPrice;
        gDollar.transferFrom(msg.sender, address(this), price);
        uint64 expiry = uint64(block.timestamp + BOOST_DURATION);
        xpBoost[msg.sender] = XpBoost({ multiplier: multiplier, expiry: expiry });
        emit XpBoostPurchased(msg.sender, multiplier, expiry);
    }

    // ─── Owner ────────────────────────────────────────────────────────────────

    function fundTreasury(uint256 amount) external onlyOwner {
        gDollar.transferFrom(msg.sender, address(this), amount);
    }

    function withdrawTreasury(uint256 amount) external onlyOwner {
        gDollar.transfer(owner(), amount);
    }

    function setShopPrices(
        uint256 _shieldPrice,
        uint256 _boost2xPrice,
        uint256 _boost5xPrice
    ) external onlyOwner {
        shieldPrice  = _shieldPrice;
        boost2xPrice = _boost2xPrice;
        boost5xPrice = _boost5xPrice;
        emit ShopPricesUpdated(_shieldPrice, _boost2xPrice, _boost5xPrice);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getLeaderboard() external view returns (LeaderboardEntry[10] memory) {
        return _leaderboard;
    }

    function getSession(address player) external view returns (Session memory) {
        return sessions[player];
    }

    function getXpBoost(address player) external view returns (XpBoost memory) {
        return xpBoost[player];
    }

    // ─── UUPS ─────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _awardXp(address player, uint256 score, uint256 comboMoves) internal {
        uint256 earned = score / 10;

        // 5-move combo: 5× this game's XP
        if (comboMoves >= COMBO_THRESHOLD) {
            earned *= COMBO_XP_MULTIPLIER;
        }

        // Active XP boost: applies on top of combo
        XpBoost storage boost = xpBoost[player];
        if (boost.expiry > block.timestamp) {
            earned *= boost.multiplier;
        }

        xp[player] += earned;
        emit XpEarned(player, earned, xp[player]);
    }

    function _updateStreak(address player) internal {
        uint256 last = lastPlayTimestamp[player];

        if (last == 0) {
            // First ever game
            streakCount[player] = 1;
        } else {
            uint256 elapsed = block.timestamp - last;

            if (elapsed < 24 hours) {
                // Multiple sessions same day — streak unchanged
            } else if (elapsed <= 48 hours) {
                // Played the next day — extend streak
                streakCount[player]++;
            } else {
                // Missed at least one day
                if (shieldCount[player] > 0) {
                    // Burn one shield from inventory — streak continues
                    shieldCount[player]--;
                    streakCount[player]++;
                } else {
                    // No shield — streak resets
                    streakCount[player] = 1;
                }
            }
        }

        lastPlayTimestamp[player] = block.timestamp;
        emit StreakUpdated(player, streakCount[player]);
    }

    function _payMilestoneRewards(uint32 highestTile) internal {
        uint8 claimed = claimedMilestones[msg.sender];

        if (highestTile >= 2048 && (claimed & MILESTONE_2048) == 0) {
            claimedMilestones[msg.sender] |= MILESTONE_2048;
            _sendReward(2048, REWARD_2048);
        }
        if (highestTile >= 1024 && (claimed & MILESTONE_1024) == 0) {
            claimedMilestones[msg.sender] |= MILESTONE_1024;
            _sendReward(1024, REWARD_1024);
        }
        if (highestTile >= 512 && (claimed & MILESTONE_512) == 0) {
            claimedMilestones[msg.sender] |= MILESTONE_512;
            _sendReward(512, REWARD_512);
        }
        if (highestTile >= 256 && (claimed & MILESTONE_256) == 0) {
            claimedMilestones[msg.sender] |= MILESTONE_256;
            _sendReward(256, REWARD_256);
        }
    }

    function _sendReward(uint32 milestone, uint256 amount) internal {
        if (gDollar.balanceOf(address(this)) >= amount) {
            gDollar.transfer(msg.sender, amount);
            emit RewardPaid(msg.sender, milestone, amount);
        }
        // Silently skip if treasury is dry — score still records
    }

    function _updateLeaderboard(address player, uint256 score, uint32 highestTile) internal {
        uint8 lowestIdx  = 0;
        bool  foundEmpty = false;

        for (uint8 i = 0; i < 10; i++) {
            if (_leaderboard[i].player == address(0)) {
                lowestIdx  = i;
                foundEmpty = true;
                break;
            }
            if (_leaderboard[i].score < _leaderboard[lowestIdx].score) {
                lowestIdx = i;
            }
        }

        if (foundEmpty || score > _leaderboard[lowestIdx].score) {
            _leaderboard[lowestIdx] = LeaderboardEntry({
                player:      player,
                score:       score,
                highestTile: highestTile
            });
        }
    }
}
