# BlockSlide

> Onchain 2048 on Celo — slide tiles, earn G$, climb the leaderboard.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Celo Mainnet](https://img.shields.io/badge/Celo-Mainnet-35D07F?logo=celo)](https://celoscan.io/address/0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6)

**Play now**: [https://blockslide.app](https://blockslide.app)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Game Logic](#game-logic)
- [Smart Contract](#smart-contract)
- [Frontend](#frontend)
- [Shop & XP System](#shop--xp-system)
- [GoodDollar Integration](#gooddollar-integration)
- [Leaderboard & Subgraph](#leaderboard--subgraph)
- [Development](#development)
- [Deployment](#deployment)
- [Audit History](#audit-history)
- [Project Structure](#project-structure)

---

## Overview

BlockSlide is the classic 2048 tile-sliding puzzle rebuilt as a **hybrid onchain game** on Celo. The game engine runs client-side for instant responsiveness, while scores, XP, streaks, milestone rewards, and the leaderboard are settled onchain via a UUPS-upgradeable Solidity contract.

Key differentiators:

- **Proof-of-humanity gating** — only GoodDollar-verified humans can submit scores onchain, preventing bots from farming G$ rewards.
- **Hybrid architecture** — offchain game play with onchain settlement, giving native-app feel with trustless finality.
- **Anti-cheat via seed commitment** — players commit `keccak256(seed)` before playing; the seed is revealed on submission, preventing cherry-picking of lucky boards.
- **G$ (GoodDollar) rewards** — milestone-based G$ payouts for reaching tile thresholds (256, 512, 1024, 2048).
- **In-game shop** — spend G$ on streak shields and XP boosts, paid to the contract treasury.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Frontend)                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ 2048     │  │ Sound    │  │ Wallet   │          │
│  │ Engine   │  │ (Web     │  │ (wagmi + │          │
│  │ (seeded  │  │ Audio)   │  │ Web3Auth)│          │
│  │ PRNG)    │  │          │  │          │          │
│  └──────────┘  └──────────┘  └─────┬────┘          │
│                                     │               │
│                              ┌──────┴──────┐        │
│                              │ useGame     │        │
│                              │ useGameSession       │
│                              │ useIdentity  │        │
│                              │ useShop      │        │
│                              │ useUsername  │        │
│                              └──────┬──────┘        │
└─────────────────────────────────────┼────────────────┘
                                      │ RPC (ankr)
                                      ▼
┌─────────────────────────────────────────────────────┐
│                   Celo Mainnet                       │
│  ┌──────────────────────────────────────────────┐   │
│  │  Game2048 Proxy (ERC1967)                    │   │
│  │  ┌────────────────────────────────────────┐  │   │
│  │  │  Game2048 Implementation (UUPS)        │  │   │
│  │  │  - Session lifecycle                   │  │   │
│  │  │  - Score / tile records                │  │   │
│  │  │  - Milestone rewards (G$)              │  │   │
│  │  │  - XP, streaks, shields, boosts       │  │   │
│  │  │  - Leaderboard (top 10)               │  │   │
│  │  │  - Username registry                  │  │   │
│  │  │  - Shop pricing (owner-adjustable)    │  │   │
│  │  └────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────┐    ┌──────────────────────┐   │
│  │ GoodDollar       │    │ G$ Token (ERC-20)    │   │
│  │ Identity (IIdentity)  │ (reward disbursement)│   │
│  └──────────────────┘    └──────────────────────┘   │
└─────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────┐
│  Goldsky Subgraph                                    │
│  - Indexes XpEarned, UsernameSet, ScoreSubmitted    │
│  - Serves XP-ranked leaderboard via GraphQL         │
└─────────────────────────────────────────────────────┘
```

### Hybrid Execution Model

| Concern | Location | Rationale |
|---|---|---|
| Tile physics (slide, merge, spawn) | Browser | Instant, no block latency |
| Seed generation | Browser | Cryptographically random |
| Combo tracking | Browser | Real-time feedback |
| Sound effects | Browser | Web Audio synthesis |
| Session lifecycle | Contract | Trustless — commit-reveal seed scheme |
| Score/tile records | Contract | Immutable, queryable |
| Milestone rewards | Contract | G$ transfer with try/catch safety |
| XP calculation | Contract | Combo multiplier + boost stacking |
| Streak tracking | Contract | 24h window with shield protection |
| Leaderboard | Contract + Subgraph | Onchain top-10 + GraphQL for richer queries |
| Username registry | Contract | On-chain, case-insensitive, unique |
| Shop purchases | Contract | G$ transfer to treasury |

---

## Game Logic

### Seeded PRNG Engine

All game state lives in `frontend/src/lib/gameLogic.ts`. The engine uses a **mulberry32** seeded PRNG, initialized from a 256-bit seed. Tile spawning, sliding, and merging are deterministic given the seed, player moves, and spawn RNG.

```
GameState {
  board:        number[16]   // 4×4 grid, 0 = empty
  score:        number
  highestTile:  number       // max tile value achieved
  moveCount:    number
  over:         boolean
  won:          boolean
  newTiles:     number[]     // indices of spawned tiles this move
  mergedTiles:  number[]     // indices of tiles that merged
  currentCombo: number       // consecutive merge streak
  maxCombo:     number       // highest combo in this game
}
```

### Anti-Cheat: Commit-Reveal

1. Player clicks "New Game".
2. Frontend generates a crypto-random 256-bit seed (`generateSeed()`).
3. Frontend calls `startSession(keccak256(seed))` on the contract.
4. Game plays out in the browser using the seed's lower 32 bits as the mulberry32 PRNG seed.
5. On submission, `submitScore(score, highestTile, moveCount, seed, comboMoves)` reveals the seed.
6. Contract verifies `keccak256(seed) === storedSeedHash`.

This prevents a player from generating many seeds offchain, playing each one mentally, and submitting only the best result — the seed is locked in before the game starts.

### Input Methods

- **Keyboard**: Arrow keys, WASD, Vim keys (hjkl)
- **Touch**: Swipe gestures (any direction with ≥ 20px threshold)
- Game state persists to `localStorage` keyed by wallet address, so the game survives page refreshes.

---

## Smart Contract

### `Game2048.sol` (497 lines)

**Upgradeability**: UUPS (Universal Upgradeable Proxy Standard) via OpenZeppelin's `UUPSUpgradeable` + `OwnableUpgradeable` + `Initializable`. The proxy is an ERC1967Proxy deployed at a fixed address; only the implementation can be upgraded by the owner.

**Storage Layout** (order matters for UUPS safety):

```
Initialized (V1-V2):
  gDollar (IERC20)
  identity (IIdentity)
  sessions (mapping)
  bestScore (mapping)
  bestTile (mapping)
  claimedMilestones (mapping)
  _leaderboard (fixed array[10])
  leaderboardSeeded (bool)

V2 addition (shop/XP):
  xp (mapping)
  streakCount (mapping)
  lastPlayTimestamp (mapping)
  shieldCount (mapping)
  xpBoost (mapping)
  shieldPrice (uint256)
  boost2xPrice (uint256)
  boost5xPrice (uint256)

V4 addition (usernames):
  usernames (mapping)
  nameOwner (mapping)
  _nameKey (mapping)
```


### Functions

#### Session Lifecycle

- **`startSession(bytes32 seedHash)`** — Requires GoodDollar verification. Creates or reuses a session (auto-expires stale ones). Commits the seed hash.
- **`submitScore(score, highestTile, moveCount, seed, comboMoves)`** — Validates seed, session freshness, and parameter bounds. Awards XP, updates streak, pays milestone rewards, updates leaderboard.
- **`expireSession(address player)`** — Anyone can expire a timed-out session (gas refund for stuck sessions).

#### Shop

- **`buyStreakShield()`** — Transfers `shieldPrice` G$ from player to contract treasury. Increments shield inventory.
- **`buyXpBoost(uint8 multiplier)`** — Multiplier must be 2 or 5. Transfers G$ at corresponding price. Sets 24h boost expiry.
- **`setShopPrices(shield, boost2x, boost5x)`** — Owner-only. Updates item prices.
- **`fundTreasury(amount)`** / **`withdrawTreasury(amount)`** — Owner treasury management.

#### Usernames

- **`setUsername(string name)`** — Validates: 3-20 chars, `[a-zA-Z0-9_]`, case-insensitive uniqueness. Free (only gas cost). Released old name if changing.
- **`getUsernames(address[])`** — Batch read for leaderboard display.

#### Owner

- **`setTokens(gDollar, identity)`** — Emergency fix for wrong token address (used in V3 upgrade to correct the G$ address on Celo).
- **`seedLeaderboard(players[], scores[])`** — One-time migration function to populate the top-10 leaderboard with historical data.
- `transferOwnership` (from OwnableUpgradeable)
- `_authorizeUpgrade` (from UUPSUpgradeable)

### Anti-Fragile Reward System

```solidity
function _sendReward(uint32 milestone, uint256 amount) internal returns (bool) {
    try gDollar.balanceOf(address(this)) returns (uint256 bal) {
        if (bal >= amount) {
            try gDollar.transfer(msg.sender, amount) returns (bool ok) {
                if (ok) {
                    emit RewardPaid(msg.sender, milestone, amount);
                    return true;
                }
            } catch { }
        }
    } catch { }
    return false;
}
```

All external token interactions use try/catch. If the treasury is dry or the token is paused, the reward is silently skipped — the score, XP, and leaderboard still record. Milestones remain unclaimed (`claimedMilestones` is only set when the reward actually pays), so they retry on the next submission.

### Error Handling

Custom errors defined in the contract:

| Error | Revert Condition |
|---|---|
| `NotVerifiedHuman()` | Caller not whitelisted by GoodDollar identity |
| `SessionAlreadyActive()` | Existing unexpired session for this player |
| `NoActiveSession()` | No session found for submission |
| `SessionExpired()` | Session started more than 2 hours ago |
| `InvalidSeed()` | Revealed seed doesn't match committed hash |
| `InvalidMoveCount()` | moveCount not in [1, 10000] |
| `InvalidTileValue()` | highestTile not a power of 2 or outside [2, 131072] |
| `InvalidComboCount()` | comboMoves > moveCount |
| `InvalidBoostMultiplier()` | multiplier not 2 or 5 |
| `UsernameTaken()` | Name owned by a different address |
| `InvalidUsername()` | Name doesn't match [a-zA-Z0-9_]{3,20} |
| `LeaderboardAlreadySeeded()` | seedLeaderboard already called |

### Deployment History (Celo Mainnet)

| Module | Tx / Step | Implementation | Purpose |
|---|---|---|---|
| `Game2048Module` | Initial deploy | `0xF391701C7c87BCa04CC3fEE345a8101B68F2c871` | V1 — basic session + rewards |
| `Game2048UpgradeModule` | V1 upgrade | `0x5cF517877Bf5C2e4FD95fE7C2B46065830D6F7c0` | First contract iteration |
| `Game2048UpgradeV2Module` | V2 upgrade | `0xD28D879e36757dE28132e7D3B099e334E8406d8D` | Added shop, XP, streaks, combos |
| `Game2048UpgradeV3Module` | V3 upgrade | `0xbc0b92c9eA514A3630eD34a091da0e6490f693af` | Fixed G$ address, try/catch rewards |
| Rollback script | RollbackV5 | `0x6b730fbfe0c7bbc8b308c9963d2ecec4064910dd` | Rolled back misaligned V5 impl |

Proxy (`0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6`) is constant across all upgrades.

---

## XP & Streak System

### XP Calculation

```
Base XP = score / 10

If maxCombo >= 5:
    Base XP *= 5    (5x combo multiplier)

If XP boost is active (24h window):
    Base XP *= multiplier (2 or 5)

Total XP = Base XP
```

XP is cumulative across all games. The `XpEarned` event carries the running total, which the subgraph uses directly.

### Streak Tracking

Streaks track consecutive daily play:

| Gap | Action |
|---|---|
| < 24 hours since last play | Streak unchanged (same day) |
| 24-48 hours | Streak incremented |
| > 48 hours | Shield consumed if available, otherwise streak resets to 1 |

Shields stack in inventory (unlimited). A shield is consumed automatically on the first missed day where the gap exceeds 48 hours.

### Shop Items

| Item | Price | Effect |
|---|---|---|
| Streak Shield | 25 G$ | Prevents one streak break. Stacks in inventory. |
| 2x XP Boost | 50 G$ | Doubles XP from all games for 24 hours. |
| 5x XP Boost | 125 G$ | 5x XP from all games for 24 hours. Overwrites existing boost. |

All shop G$ payments go to the contract treasury (not burned). The owner can adjust prices at any time via `setShopPrices()`.

---

## GoodDollar Integration

### Verification Flow

BlockSlide uses two complementary identity checks:

1. **On-chain identity contract** (`IIdentity.isWhitelisted`) — the source of truth on Celo. The contract reads this to gate `startSession()`.
2. **GoodDollar SDK** (`@goodsdks/citizen-sdk`) — used in the frontend for:
   - Checking verification status
   - Generating face verification links
   - Claiming daily UBI (Universal Basic Income)

Flow:
```
1. Connect wallet (Web3Auth or external)
2. "Start face verification" → opens popup
3. GoodDollar face scan (liveness check)
4. Wallet signs message to prove ownership
5. GoodDollar registers address on-chain
6. Player returns to BlockSlide → on-chain status confirmed
7. startSession() checks isWhitelisted → passes
```

### UBI Claiming

The `ClaimUBI` component on the home screen allows verified players to claim their daily GoodDollar UBI directly through the GoodDollar SDK (`ClaimSDK`). This avoids having to visit a separate wallet site.

---

## Frontend

### Tech Stack

| Library | Purpose |
|---|---|
| **Next.js 14** | React framework (SSR disabled, client SPA) |
| **wagmi 3** | React hooks for Ethereum (wallet, contracts, reads) |
| **viem 2** | TypeScript Ethereum library |
| **Web3Auth** | Social login / email passwordless + external wallet support |
| **TanStack React Query 5** | Server state (leaderboard data, contract reads) |
| **Tailwind CSS 4** | Utility CSS (layered under custom styles) |
| **Web Audio API** | Synthesized sound effects |

### Component Tree

```
App
├── LoginScreen            (shown until Web3Auth authenticates)
├── HowToPlay              (5-slide tutorial modal, shown once)
├── UsernameModal          (prompts username on first connect)
├── Header
│   ├── Logo + nav icons (Home, Play, Leaderboard, Shop, Help, Sound)
│   ├── Username pill + verified badge
│   └── WalletButton
├── Main
│   ├── IdentityGate       (verification prompt/banner)
│   ├── ChainBanner        (wrong network warning)
│   ├── Home               (hero, feature cards, daily G$ claim)
│   ├── GameView
│   │   ├── ScorePanel    (SCORE, BEST, XP)
│   │   ├── Board         (4×4 grid of Tile components)
│   │   ├── ComboBadge    (combo streak indicator)
│   │   ├── GameOverlay   (win/loss screen)
│   │   └── GameControls  (New Game, Submit Score)
│   ├── Leaderboard       (XP-ranked top 10 via subgraph)
│   │   └── UsernameEditor
│   └── Shop              (streak shield + XP boosts)
```

### Custom Hooks

| Hook | Responsibility |
|---|---|
| `useGame` | Offchain game engine state, keyboard/touch input, localStorage persistence |
| `useGameSession` | Session lifecycle: startSession → submitScore — handles signTransaction + eth_sendTransaction fallback, contract error decoding, gas checks, session expiry |
| `useIdentity` | GoodDollar verification status with localStorage fallback and TTL |
| `useGoodDollarIdentity` | SDK-based verification: popup management, polling for completion, status rechecking |
| `useShop` | Shop reads/writes with approval management and auto-refetch |
| `useUsername` | On-chain username read/save with simulate + signTransaction fallback |

### Transaction Strategy

The frontend implements a **dual-path transaction strategy** for Celo compatibility:

1. **Primary path**: `eth_signTransaction` — signs locally (pure crypto, no RPC calls from the wallet), then broadcasts via ankr public RPC. This bypasses Celo's `forno` RPC entirely.
2. **Fallback path**: `eth_sendTransaction` — for wallets like Coinbase Wallet that don't expose `eth_signTransaction`. The wallet handles signing and broadcast through its own RPC.

Transaction parameters:
- `maxFeePerGas`: 500 gwei
- `maxPriorityFeePerGas`: 2.5 gwei
- Gas limit: 200,000 for startSession, 500,000 for submitScore, 120,000 for setUsername

### Sound System

All sounds are synthesized via Web Audio API oscillators (no audio files):

| Event | Sound |
|---|---|
| Tile slide | Short square wave (160 Hz, 70ms) |
| Tile merge | Rising sine tone (pitch ~ log2(tile) * 55 + 280 Hz) |
| Tile spawn | High sine chirp (520 Hz, 70ms) |
| Game won | Ascending 5-note fanfare (C5-E5-G5-C6-E6) |
| Game over | Descending sawtooth sequence (A4-F#4-D#4-C4) |
| New game | Two-note upbeat chirp |

---

## Leaderboard & Subgraph

### Onchain Leaderboard

The contract maintains a fixed-size top-10 leaderboard (`LeaderboardEntry[10]`). The `_updateLeaderboard` function:

1. Checks if the player already has an entry → updates score only if higher.
2. If not found, finds the lowest-score slot and replaces it if `score > lowest score`.

Entries preserve the player address, highest score, and highest tile.

### Subgraph (Goldsky)

The subgraph in `/subgraph` indexes three events for richer querying:

```graphql
type Player @entity {
  id: Bytes!              # wallet address
  xp: BigInt!             # cumulative XP (from XpEarned.total)
  username: String        # display name (from UsernameSet)
  bestScore: BigInt!      # best single-game score
  gamesPlayed: Int!       # number of scores submitted
  firstSeen: BigInt!      # timestamp of first indexed event
  lastUpdated: BigInt!    # timestamp of most recent update
}
```

The frontend queries the subgraph for the XP-ranked leaderboard:
```graphql
players(first: 10, orderBy: xp, orderDirection: desc) {
  id
  xp
  username
}
```

Deployed on Goldsky at `blockslide-leaderboard/1.0.0`.

---

## Development

### Prerequisites

- Node.js ≥ 18
- npm
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for forge-std tests)

### Setup

```bash
git clone <repo>
cd blockslide
npm install                                    # contract deps
cd frontend && npm install && cd ..            # frontend deps
```

### Environment Variables

Create a `.env` file in the project root:

```env
CELO_PRIVATE_KEY=0x...
SEPOLIA_PRIVATE_KEY=0x...
```

For the frontend, create `frontend/.env.local`:

```env
NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=your_web3auth_client_id
NEXT_PUBLIC_SUBGRAPH_URL=https://api.goldsky.com/api/public/<project>/subgraphs/...
```

### Running Tests

```bash
# All tests (Solidity + TypeScript)
npx hardhat test

# Solidity unit tests only (forge-std)
npx hardhat test solidity

# TypeScript integration tests only
npx hardhat test nodejs
```

**Solidity tests** (`contracts/Game2048.t.sol`): 34 tests covering:
- Session lifecycle (start, submit, expire, validation)
- XP calculation (base, combo multiplier, boost stacking, expiry)
- Streak tracking (start, daily, gap reset, shield protection, stacked shields)
- Shop purchases (shield, boost, pricing, ownership)
- Milestone rewards (single tier, cumulative tiers, no double-claim, dry treasury)
- Leaderboard population and ranking
- Ownership and treasury access control

**TypeScript tests** (`test/Game2048.ts`): 8 integration tests using `network.create()` and `networkHelpers.loadFixture()`, covering:
- Full happy-path session → submit → reward
- Unwhitelisted player rejection
- Wrong seed rejection  
- Session expiry
- One-time milestone rewards
- Best score/tile tracking
- Third-party session expiry
- Leaderboard storage

### Running Locally (Frontend)

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment

### Contract Deployment

```bash
# Dev deployment (Celo Sepolia testnet with MockERC20 + MockIdentity)
npx hardhat ignition deploy ignition/modules/Game2048Dev.ts --network celoSepolia

# Production deployment (Celo mainnet with real G$ + identity)
npx hardhat ignition deploy ignition/modules/Game2048.ts --network celo

# Upgrade existing proxy
npx hardhat ignition deploy ignition/modules/Game2048UpgradeV4.ts --network celo
```

### Post-Deploy Setup (Development)

```bash
npx hardhat run scripts/setup-dev.ts --network celoSepolia
```

This whitelists the deployer, funds the treasury, and updates `frontend/src/lib/constants.ts`.

### Subgraph Deployment

```bash
cd subgraph
npm install
npm run codegen
npm run build
goldsky subgraph deploy blockslide-leaderboard/1.0.0 --path .
```

### Frontend Deployment (Vercel)

The frontend is configured for Vercel via `vercel.json` with Next.js framework preset.

### Scripts

| Script | Purpose |
|---|---|
| `scripts/setup-dev.ts` | Post-deploy dev setup: whitelist, fund treasury, patch constants |
| `scripts/deployDevSepolia.ts` | Deploy with mocks to Celo Sepolia (viem-based) |
| `scripts/exportLeaderboard.ts` | Export onchain leaderboard to JSON |
| `scripts/seedLeaderboard.ts` | Seed leaderboard from exported JSON |
| `scripts/testSeedLocal.ts` | Test `seedLeaderboard()` on local hardhat network |
| `scripts/rollbackV5.ts` | Roll proxy back to pre-V5 implementation |

---

## Audit History

### Known Incidents

**V3: Corrected G$ token address** — The initial `initialize()` committed a typo'd G$ address (`…462A4e`) on Celo that had no deployed code. `submitScore` would revert when trying to pay rewards. Fix: V3 upgrade added `setTokens()` and try/catch around all token interactions.

**V5 Rollback** — A V5 implementation was deployed that used a storage layout mismatched with the existing proxy's storage. This caused all state reads (XP, username, bestScore) to return garbage. Fix: `scripts/rollbackV5.ts` re-pointed the proxy to the known-good V3 implementation at `0x6b730fbfe0c7bbc8b308c9963d2ecec4064910dd`.

---

## Project Structure

```
blockslide/
├── contracts/
│   ├── Game2048.sol                 # Main game contract (UUPS proxy-compatible)
│   ├── Game2048.t.sol               # Solidity unit tests (forge-std)
│   ├── Counter.sol                  # Example contract (reference)
│   ├── Counter.t.sol                # Counter Solidity tests
│   ├── Proxy.sol                    # ERC1967Proxy wrapper for Hardhat
│   ├── vendor/
│   │   └── ERC1967Proxy.sol         # Game2048Proxy — deployable artifact
│   └── test/
│       ├── MockERC20.sol            # Mock G$ for dev testing
│       └── MockIdentity.sol         # Mock GoodDollar identity for dev testing
├── test/
│   ├── Game2048.ts                  # TypeScript integration tests
│   └── Counter.ts                   # Counter integration tests
├── ignition/
│   ├── modules/
│   │   ├── Game2048.ts              # Production deployment (Celo mainnet)
│   │   ├── Game2048Dev.ts           # Dev deployment (mocks + proxy)
│   │   ├── Game2048Upgrade.ts       # V1 upgrade
│   │   ├── Game2048UpgradeV2.ts     # V2: shop, XP, combos
│   │   ├── Game2048UpgradeV3.ts     # V3: fix G$ address, try/catch
│   │   └── Game2048UpgradeV4.ts     # V4: onchain usernames
│   ├── deployments/
│   │   ├── chain-42220/             # Celo mainnet deployments
│   │   └── chain-11142220/          # Celo Sepolia (dev) deployments
│   └── parameters.alfajores.json    # Alfajores/Celo Sepolia parameters
├── scripts/
│   ├── setup-dev.ts                 # Post-deploy dev setup
│   ├── deployDevSepolia.ts          # Deploy with mocks to Sepolia
│   ├── exportLeaderboard.ts         # Export onchain leaderboard
│   ├── seedLeaderboard.ts           # Seed from exported data
│   ├── testSeedLocal.ts             # Test seedLeaderboard locally
│   ├── rollbackV5.ts                # Emergency rollback script
│   └── send-op-tx.ts                # OP-chain type test
├── subgraph/
│   ├── schema.graphql               # Player entity schema
│   ├── subgraph.yaml                # Subgraph manifest (celo, block 69294066)
│   ├── src/mapping.ts               # Event handlers (3 events)
│   ├── abis/Game2048.json           # Contract ABI
│   ├── networks.json                # Network configuration
│   └── package.json
├── frontend/
│   ├── app/
│   │   ├── layout.tsx               # Root layout (Google Fonts, globals.css)
│   │   ├── page.tsx                  # Client-only SPA entry
│   │   ├── AppRoot.tsx              # Provider tree (Web3Auth, QueryClient, Wagmi)
│   │   ├── globals.css              # Tailwind theme + utilities (layered)
│   ├── src/
│   │   ├── App.tsx                  # Main app component (routing, state)
│   │   ├── index.css                # Full game styles (1694 lines)
│   │   ├── web3auth.ts              # Web3Auth configuration
│   │   ├── lib/
│   │   │   ├── abi.ts               # Contract ABIs (Game2048, ERC20, Identity)
│   │   │   ├── constants.ts         # Addresses, chain config
│   │   │   ├── gameLogic.ts         # 2048 engine: seeded PRNG, slide/merge, init
│   │   │   └── sounds.ts            # Web Audio API synthesized sounds
│   │   ├── hooks/
│   │   │   ├── useGame.ts           # Game state, keyboard/touch, persistence
│   │   │   ├── useGameSession.ts    # Session lifecycle, sign + broadcast
│   │   │   ├── useIdentity.ts       # GoodDollar verification status
│   │   │   ├── useGoodDollarIdentity.ts  # SDK-based verification + claim
│   │   │   ├── useShop.ts           # Shop purchases, balance, inventory
│   │   │   └── useUsername.ts       # On-chain username management
│   │   └── components/
│   │       ├── Board.tsx            # 4×4 grid with combo badge
│   │       ├── Tile.tsx             # Individual tile (value, animation, color)
│   │       ├── GameControls.tsx     # New Game / Submit Score buttons
│   │       ├── ScorePanel.tsx       # Score, Best, XP display
│   │       ├── Home.tsx             # Landing page with hero + features
│   │       ├── HowToPlay.tsx        # 5-slide tutorial modal
│   │       ├── LoginScreen.tsx      # Web3Auth login screen
│   │       ├── IdentityGate.tsx     # Verification prompt
│   │       ├── ClaimUBI.tsx         # Daily G$ UBI claim
│   │       ├── DailyClaim.tsx       # GoodDollar wallet claim link
│   │       ├── Leaderboard.tsx      # XP-ranked leaderboard (subgraph)
│   │       ├── Shop.tsx             # Item shop with buy/approve flow
│   │       ├── UsernameEditor.tsx   # Inline username set/change
│   │       ├── UsernameModal.tsx    # Username setup prompt modal
│   │       ├── WalletButton.tsx     # Disconnect button
│   │       └── icons.tsx            # SVG icon components (13 icons)
│   ├── next.config.mjs
│   ├── postcss.config.mjs
│   ├── tsconfig.json
│   ├── vercel.json
│   └── package.json
├── hardhat.config.ts                # Hardhat 3 config (EDR, Celo networks)
├── tsconfig.json
├── package.json
├── AGENTS.md                        # AI agent instructions
├── CLAUDE.md                        # Legacy Claude instructions
├── LICENSE                          # MIT
└── README.md
```

---

## Security Considerations

- **Proxy storage layout** — All UUPS upgrades maintain Solidity storage slot compatibility. New state variables are appended to the end of existing storage.
- **Try/catch for token transfers** — Reward payments never block score submission. A broken or paused G$ token cannot DOS the game.
- **Commit-reveal seed scheme** — Prevents result cherry-picking. The seed is committed before play and revealed on submission.
- **Input validation** — All `submitScore` parameters are validated server-side (moveCount range, tile power-of-2, combo ≤ moves).
- **Ownable access control** — Treasury withdrawals, shop pricing, token address updates, upgrades, and leaderboard seeding are owner-only.
- **Session timeout** — 2-hour window prevents stale session accumulation. Anyone can expire a timed-out session.
- **Identity gating** — Only GoodDollar-verified humans can start onchain sessions, preventing bot farming of milestone rewards.

---

## License

MIT — see [LICENSE](LICENSE).

Built by [@CollinsC1O](https://github.com/CollinsC1O) and [@0xOlivanode](https://github.com/0xOlivanode).

- Telegram: [https://t.me/blockslide_xyz](https://t.me/blockslide_xyz)
- Web: [https://blockslide.app](https://blockslide.app)
