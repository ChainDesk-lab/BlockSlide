/**
 * How to Play page content.
 * Sourced values from contracts/Game2048.sol (see file references).
 * Edit this file to update copy without touching components.
 */

export interface HowToPlaySection {
  id: string;
  title: string;
  body: string;
}

export const howToPlaySections: HowToPlaySection[] = [
  {
    id: "what-is-blockslide",
    title: "What is BlockSlide?",
    body: `BlockSlide is an onchain 2048 game on the Celo blockchain where every game you play earns XP and real cryptocurrency rewards in G$ (GoodDollar). Your scores and streaks are recorded onchain, and you can compete on leaderboards with other players worldwide.`,
  },
  {
    id: "how-to-play",
    title: "How to Play",
    body: `Use arrow keys (or swipe on mobile) to slide tiles in any direction. When two tiles with the same number touch, they merge into one. Keep merging to reach the 2048 tile—or go higher!

Each game you finish is submitted onchain as a permanent record. This records your score, your highest tile, and any rewards you've earned. You need to be connected to a wallet (MiniPay or Web3Auth) to play, but you don't need to verify your identity unless you want to claim G$ rewards.`,
  },
  {
    id: "xp-and-rewards",
    title: "XP and Rewards",
    body: `XP is earned from every game based on your score: you get 1 XP for every 10 points. Reach certain tile milestones in a single game to earn G$ rewards:

• Reach tile 256: 5 G$ (Game2048.sol line 44)
• Reach tile 512: 15 G$ (Game2048.sol line 45)
• Reach tile 1024: 40 G$ (Game2048.sol line 46)
• Reach tile 2048: 100 G$ (Game2048.sol line 47)

You earn these rewards once per account when you first hit each milestone. XP keeps accumulating with every game.`,
  },
  {
    id: "xp-boosts-and-combos",
    title: "Boosters and Combos",
    body: `Earn extra XP with combos: play 5 consecutive games within 2 hours to trigger a 5× XP multiplier for your next game.

From the shop, buy time-limited boosters to amplify your XP further (they last 24 hours):
• 2× XP Boost: 50 G$ (Game2048.sol line 154) — doubles XP earned
• 5× XP Boost: 125 G$ (Game2048.sol line 155) — multiplies XP earned by 5

Boosts stack: a combo game with an active 5× boost earns 5 × 5 = 25× XP.`,
  },
  {
    id: "the-shop",
    title: "The Shop",
    body: `The shop lets you spend G$ to buy tools that boost your game:

Shields: Streak Shield (25 G$ per shield, Game2048.sol line 153) protects your daily streak for 24 hours. Miss a day and a shield is consumed instead of breaking your streak. Stack shields to protect multiple days.

XP Boosters: Buy 2× or 5× XP boosts (50 G$ and 125 G$ respectively) to multiply your XP earnings for 24 hours. Perfect for grinding leaderboard rankings or chasing high scores.`,
  },
  {
    id: "verification-and-gooddollar",
    title: "Verification and GoodDollar",
    body: `GoodDollar is a decentralized Universal Basic Income protocol—a real cryptocurrency that has real value. G$ earned in BlockSlide can be spent in the shop or transferred to other wallets.

To claim G$ rewards and participate in bounties, you must verify with GoodDollar's identity system (one face, one wallet). This ensures rewards go to real people and prevents fraud. Verification takes under a minute in the app and only needs to happen once per wallet.

Without verification, you can still play and earn XP, but G$ rewards won't be sent to you, and you're ineligible for limited-time bounties.`,
  },
  {
    id: "bounties",
    title: "Bounties",
    body: `Bounties are limited-time competitions where everyone starts from 0 XP on a fresh leaderboard. Unlike the main leaderboard (which records all-time progress), bounties are snapshot events with real prizes for top finishers.

How to enter:
1. Make sure you're verified with GoodDollar (see "Verification" above)
2. Play games normally during the bounty period
3. Your XP is tracked on the bounty leaderboard in real time
4. When the bounty ends, prizes are awarded to top finishers

Visit the bounties page to see active competitions, prize pools, and how much time is left.`,
  },
  {
    id: "your-profile",
    title: "Your Profile",
    body: `Your profile page shows your stats: total XP, best single-game score, number of games played, and current streak. Profiles are public and shareable—send your profile link to friends to show off your high scores.

You can also set a custom username on your profile, and see your G$ earned and spent (if those fields are available for your account).`,
  },
  {
    id: "community",
    title: "Join the Community",
    body: `Meet other players and stay updated:

• Follow us on X: [X_LINK]
• Chat on Telegram: [TELEGRAM_LINK]
• Visit blockslide.app

Have questions? Tap the help icon anytime for this guide.`,
  },
];
