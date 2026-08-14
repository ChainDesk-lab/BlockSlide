export interface Bounty {
  id: string;
  title: string;
  description: string;
  startTime: string; // ISO UTC
  endTime: string;   // ISO UTC
  prizes: string;
  howToParticipate: string[];
  winnerCriteria: string;
}

// Bounty times: Aug 1 2026 12:00 PM WAT (UTC+1) = 2026-08-01T11:00:00Z
// Bounty times: Aug 3 2026 23:59:59 WAT (UTC+1) = 2026-08-03T22:59:59Z
// Bounty #2 times: Aug 7 2026 12:00 PM WAT (UTC+1) = 2026-08-07T11:00:00Z
// Bounty #2 times: Aug 14 2026 12:00 PM WAT (UTC+1) = 2026-08-14T11:00:00Z
// Bounty #3 times: Aug 18 2026 12:00 PM WAT (UTC+1) = 2026-08-18T11:00:00Z (Monday)
// Bounty #3 times: Aug 25 2026 12:00 PM WAT (UTC+1) = 2026-08-25T11:00:00Z
export const bounties: Bounty[] = [
  {
    id: "bounty-1",
    title: "BlockSlide Launch Bounty",
    description: "Join the BlockSlide launch celebration! Compete with verified players worldwide to earn top rankings and prizes.",
    startTime: "2026-08-01T11:00:00Z",
    endTime: "2026-08-03T22:59:59Z",
    prizes: "$30 prize pool",
    howToParticipate: [
      "Follow BlockSlide on X (@BlockSlideGame)",
      "Join our Telegram community for updates and tips",
      "Sign up on blockslide.app via email or wallet",
      "Verify your identity with GoodDollar (one-face-one-wallet)",
      "Play games during the bounty period",
      "Use shop boosts to climb faster on the leaderboard",
    ],
    winnerCriteria: "Top 5 verified players by XP earned during the bounty period",
  },
  {
    id: "bounty-2",
    title: "BlockSlide Week 2 Bounty",
    description: "Keep the momentum going! Compete in our second bounty week with verified players worldwide to earn top rankings and prizes.",
    startTime: "2026-08-07T11:00:00Z",
    endTime: "2026-08-14T11:00:00Z",
    prizes: "$20 prize pool",
    howToParticipate: [
      "Follow BlockSlide on X (@BlockSlideGame)",
      "Join our Telegram community for updates and tips",
      "Sign up on blockslide.app via email or wallet",
      "Verify your identity with GoodDollar (one-face-one-wallet)",
      "Play games during the bounty period",
      "Use shop boosts to climb faster on the leaderboard",
    ],
    winnerCriteria: "Top 5 verified players by XP earned during the bounty period",
  },
  {
    id: "bounty-3",
    title: "BlockSlide Week 3 Bounty",
    description: "The competition continues! Join our third bounty week to prove your skills and compete for prizes with verified players worldwide.",
    startTime: "2026-08-18T11:00:00Z",
    endTime: "2026-08-25T11:00:00Z",
    prizes: "$25 prize pool",
    howToParticipate: [
      "Follow BlockSlide on X (@BlockSlideGame)",
      "Join our Telegram community for updates and tips",
      "Sign up on blockslide.app via email or wallet",
      "Verify your identity with GoodDollar (one-face-one-wallet)",
      "Play games during the bounty period",
      "Use shop boosts to climb faster on the leaderboard",
    ],
    winnerCriteria: "Top 5 verified players by XP earned during the bounty period",
  },
];

export function getBountyStatus(bounty: Bounty): "upcoming" | "live" | "ended" {
  const now = new Date();
  const startTime = new Date(bounty.startTime);
  const endTime = new Date(bounty.endTime);

  if (now < startTime) return "upcoming";
  if (now <= endTime) return "live";
  return "ended";
}
