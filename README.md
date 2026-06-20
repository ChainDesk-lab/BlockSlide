# BlockSlide

> An onchain 2048 where progress earns G$.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Celo Mainnet](https://img.shields.io/badge/Celo-Mainnet-35D07F?logo=celo)](https://celoscan.io/address/0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6)
[![Build](https://img.shields.io/badge/build-hardhat%203-blue)](#)

<!--
TODO: Add live demo badge and screenshot once deployed publicly
[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://blockslide.vercel.app)
![Gameplay Screenshot](screenshot.png)
-->

**Play BlockSlide**: [https://block-slide-henna.vercel.app](https://block-slide-henna.vercel.app)

---

## What It Is

BlockSlide is the classic 2048 tile-sliding puzzle, rebuilt as a **hybrid onchain game** on Celo. You play in the browser with instant responsiveness, then settle your score, XP, and streak onchain — earning **G$ (GoodDollar)** milestone rewards along the way. It's a proof-of-humanity-gated game where verified humans compete on a leaderboard, level up with XP, and spend their G$ on streak shields and XP boosts.

---

## How It Works

Game logic runs **offchain in the browser** — tile spawning, sliding, merging, combo tracking, and win/loss detection all happen client-side via a seeded PRNG. Each session begins by committing `keccak256(seed)` to the contract; the seed is revealed on submission, proving the board wasn't cherry-picked. This gives instant, lag-free play while preserving trustless verification.

Onchain settlement handles the high-value state:

| Offchain (browser) | Onchain (contract) |
|---|---|
| Tile physics, rendering, animations | Session lifecycle (`startSession` / `submitScore`) |
| Seed generation & combo tracking | Seed hash commitment & verification |
| Local score display & UX | Milestone reward payouts (G$) |
| Keyboard & swipe input | XP calculation, streak tracking, leaderboard |
| Sound synthesis (Web Audio) | Shop (streak shields, XP boosts) |
| | G$ treasury management |

This hybrid split means the user experience feels like a native app while every meaningful action — scoring, rewards, progress — is permanently settled onchain.

---

## G$ Integration

BlockSlide is the first (and only) game integrated directly with **GoodDollar's G$ token** on Celo.

**Milestone reward tiers:**

| Tile | G$ Reward |
|---|---|
| 256 | 5 G$ |
| 512 | 15 G$ |
| 1024 | 40 G$ |
| 2048 | 100 G$ |

- Rewards are paid from the contract treasury, funded by the owner.
- **Proof-of-humanity gating**: Only GoodDollar-verified humans (`isWhitelisted`) can start a session. This prevents bots from farming rewards.
- **Safe failure mode**: If the treasury is empty or the token is paused, the reward is skipped but the score, XP, and leaderboard still record. Unclaimed milestones remain claimable on a future submission once the treasury is refilled.
- Milestones are claimed cumulatively — reaching 2048 pays all four tiers (160 G$ total).

**Shop (spend G$):**

| Item | Price | Effect |
|---|---|---|
| Streak Shield | 25 G$ | Protects one streak break |
| 2× XP Boost | 50 G$ | 2× XP for 24 hours |
| 5× XP Boost | 125 G$ | 5× XP for 24 hours |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Smart Contracts** | Solidity 0.8.28, OpenZeppelin Upgradeable (UUPS) |
| **Contract Framework** | Hardhat 3, Ignition (deployments) |
| **Testing (Solidity)** | forge-std (Foundry) |
| **Testing (TypeScript)** | node:test + viem |
| **Blockchain** | Celo (mainnet + Alfajores testnet) |
| **Frontend** | React 18, TypeScript, Vite 5 |
| **Web3** | Wagmi 2, RainbowKit 2, viem 2 |
| **Data / State** | TanStack React Query 5 |
| **GoodDollar SDK** | @goodsdks/citizen-sdk (face verification) |
| **Deployment** | Vercel (frontend) |

---

## Smart Contract Details

**Contract**: `Game2048` (UUPS upgradeable proxy via ERC1967)

| Network | Proxy Address | Explorer |
|---|---|---|
| **Celo Mainnet** | `0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6` | [Celoscan](https://celoscan.io/address/0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6) |
| Celo Alfajores (dev) | `0x6C1176b821a76fa8f5Eb13528116D4fC42f33e64` | |

<!--
TODO: add testnet explorer link once Alfajores endpoints are live
-->

**What the contract owns:**
- Session lifecycle (start, submit, expire)
- Score/tile records & top-10 leaderboard
- Milestone reward accounting and G$ transfers
- XP accrual, streak tracking, shield inventory, XP boosts
- Shop pricing (owner-adjustable)
- UUPS upgrade authorization (owner only)

**What stays offchain:**
- Game board state, tile physics, rendering
- Seed generation, combo tracking
- UI, animations, sound, tutorial

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for `forge-std` tests)

### Clone & Install

```bash
git clone https://github.com/your-org/blockslide.git
cd blockslide

# Install contract dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### Environment Variables

Copy the example (if available) or set these in the root `.env`:

```env
CELO_PRIVATE_KEY=0x...           # Deployer wallet
SEPOLIA_PRIVATE_KEY=0x...        # Optional, for Sepolia tests
```

<!--
TODO: create .env.example
-->

### Run Tests

```bash
# All tests
npx hardhat test

# Solidity unit tests only
npx hardhat test solidity

# TypeScript integration tests only
npx hardhat test nodejs
```

### Run the Frontend Locally

```bash
cd frontend
npm run dev
```

Opens at `http://localhost:5173`. Connect a wallet on Celo mainnet to play.

### Deploy Contracts

```bash
# Deploy to Alfajores (dev — includes MockERC20 + MockIdentity)
npx hardhat ignition deploy ignition/modules/Game2048Dev.ts --network celoSepolia

# Deploy to Celo mainnet
npx hardhat ignition deploy ignition/modules/Game2048.ts --network celo
```

---

## Project Structure

```
blockslide/
├── contracts/
│   ├── Game2048.sol              # Main game contract (UUPS proxy)
│   ├── Game2048.t.sol            # Solidity unit tests (forge-std)
│   ├── Counter.sol               # Example contract
│   ├── vendor/
│   │   └── ERC1967Proxy.sol      # Proxy artifact for Ignition
│   └── test/
│       ├── MockERC20.sol         # Mock G$ for dev
│       └── MockIdentity.sol      # Mock GoodDollar identity for dev
├── test/
│   ├── Game2048.ts               # TypeScript integration tests
│   └── Counter.ts
├── ignition/
│   ├── modules/
│   │   ├── Game2048.ts           # Production deploy module
│   │   ├── Game2048Dev.ts        # Dev/testnet deploy module
│   │   ├── Game2048Upgrade.ts    # V1 upgrade
│   │   ├── Game2048UpgradeV2.ts  # V2 upgrade (shop, XP, combos)
│   │   └── Game2048UpgradeV3.ts  # V3 upgrade (fix G$ address, try/catch)
│   ├── deployments/
│   │   └── chain-42220/          # Celo mainnet addresses
│   └── parameters.alfajores.json
├── scripts/
│   ├── setup-dev.ts              # Post-deploy dev setup
│   └── send-op-tx.ts
├── frontend/
│   ├── src/
│   │   ├── main.tsx / App.tsx
│   │   ├── lib/
│   │   │   ├── abi.ts            # Contract ABIs
│   │   │   ├── constants.ts      # Addresses, config
│   │   │   ├── gameLogic.ts      # 2048 engine (seeded PRNG)
│   │   │   └── sounds.ts         # Web Audio API synthesis
│   │   ├── hooks/
│   │   │   ├── useGame.ts        # Offchain game state
│   │   │   ├── useGameSession.ts # Onchain session lifecycle
│   │   │   ├── useIdentity.ts    # GoodDollar verification
│   │   │   └── useShop.ts        # Shop transactions
│   │   └── components/
│   │       ├── Board.tsx / Tile.tsx
│   │       ├── GameControls.tsx / ScorePanel.tsx
│   │       ├── HowToPlay.tsx / IdentityGate.tsx
│   │       ├── Leaderboard.tsx / Shop.tsx
│   │       └── WalletButton.tsx / icons.tsx
│   ├── index.css                 # Full game styles (960 lines)
│   ├── wagmi.ts                  # Wagmi config (Celo RPC)
│   └── vite.config.ts / vercel.json
├── hardhat.config.ts
├── package.json
└── tsconfig.json
```

---

## Roadmap

- [ ] **MiniPay listing** — wallet-optimized build for Celo's MiniPay
- [ ] **More milestone tiers** — 4096, 8192 with escalating G$ rewards
- [ ] **Daily challenges** — time-limited boards with bonus G$ pools
- [ ] **Multiplayer races** — same-seed races where players compete on the same board
- [ ] **G$ staking** — stake G$ to enter higher-stakes leaderboard pools
- [ ] **Mobile push notifications** — streak reminders, reward alerts

---

## Team & Contact

Built by [@CollinsC1O](https://github.com/CollinsC1O) and [@0xOlivanode](https://github.com/0xOlivanode).

- Telegram: [https://t.me/blockslide_xyz](https://t.me/blockslide_xyz)
- Project Telegram channel for updates and feedback

---

## License

[MIT](LICENSE) — feel free to fork, learn from, and build on BlockSlide you can  create an issue, and make a pull request.

<!--
TODO: add a LICENSE file to the repository root
-->

