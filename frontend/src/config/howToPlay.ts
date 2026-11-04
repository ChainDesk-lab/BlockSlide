/**
 * How to Play: the facts the guide states, each taken from the code that enforces it.
 * Prices are not here: they are set on-chain and change, so the page reads them live.
 * A test (howToPlay.test.ts) checks these against contracts/Game2048.sol and the game code.
 */

export interface GuideSection {
  id: string;
  title: string;
}

/** The nine sections of the guide, in order (Figma frame 6). */
export const GUIDE_SECTIONS: GuideSection[] = [
  { id: "what-is-blockslide", title: "What is BlockSlide?" },
  { id: "how-to-play", title: "How to Play" },
  { id: "xp-and-rewards", title: "XP and Rewards" },
  { id: "boosters-and-combos", title: "Boosters and Combos" },
  { id: "the-shop", title: "The Shop" },
  { id: "verification", title: "Verification and GoodDollar" },
  { id: "bounties", title: "Bounties" },
  { id: "your-profile", title: "Your Profile" },
  { id: "community", title: "Join the Community" },
];

export const RULES = {
  /** _awardXp: earned = score / 10 */
  scorePerXp: 10,
  /** COMBO_THRESHOLD: consecutive merging moves in one game */
  comboMoves: 5,
  /** COMBO_XP_MULTIPLIER */
  comboMultiplier: 5,
  /** BOOST_DURATION_V6 = 5 hours */
  boostHours: 5,
  /** SESSION_TIMEOUT = 2 hours: a started game must be submitted within this */
  sessionHours: 2,
  /** REWARD_256 … REWARD_2048, paid once per wallet, verified players only */
  milestones: [
    { tile: 256, reward: 5 },
    { tile: 512, reward: 15 },
    { tile: 1024, reward: 40 },
    { tile: 2048, reward: 100 },
  ],
  /** gameLogic: a new tile is a 2 ninety percent of the time, otherwise a 4 */
  spawnTwoPercent: 90,
  /** gameLogic: highestTile >= 2048 wins and ends the game */
  winTile: 2048,
  /** useGame: a swipe shorter than this (px) is a tap and does nothing */
  minSwipePx: 20,
} as const;

/** useGame KEYS: every key that moves the board. */
export const CONTROLS = {
  arrows: ["←", "↑", "↓", "→"],
  letters: "W A S D",
  vim: "H J K L",
} as const;

export const COMMUNITY = [
  { label: "X / Twitter", value: "@blockslide_app", href: "https://x.com/blockslide_app" },
  { label: "Telegram", value: "BlockSlide community", href: "https://t.me/blockslide_xyz" },
  { label: "Website", value: "blockslide.app", href: "https://blockslide.app" },
] as const;
