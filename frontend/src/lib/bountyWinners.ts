/**
 * Bounty winners configuration
 * Update this after each bounty period ends with the winner list.
 * Format: wallet address or username as the identifier, along with placement, prize, and bounty ID.
 */

export interface BountyWinner {
  address?: `0x${string}`;
  username?: string;
  placement: number; // e.g., 1, 2, 3...
  week: number; // e.g., 1, 2, 3 for "Week 1 Bounty", "Week 2 Bounty", etc.
  prizeAmount: number; // e.g., 100 (in dollars or whatever unit)
  bountyId: string; // unique identifier for the bounty period, e.g., "week_1_2024"
}

/**
 * Current bounty winners list.
 * Replace this with new winners after each bounty period.
 *
 * Example entry:
 *   {
 *     address: "0x1234567890123456789012345678901234567890",
 *     placement: 1,
 *     week: 1,
 *     prizeAmount: 100,
 *     bountyId: "week_1_2024",
 *   }
 *
 * Or with username:
 *   {
 *     username: "alice",
 *     placement: 2,
 *     week: 1,
 *     prizeAmount: 50,
 *     bountyId: "week_1_2024",
 *   }
 */
export const BOUNTY_WINNERS: BountyWinner[] = [];

/**
 * Find a bounty winner by wallet address or username.
 */
export function findBountyWinner(
  address?: `0x${string}`,
  username?: string
): BountyWinner | undefined {
  if (!address && !username) return undefined;

  return BOUNTY_WINNERS.find((winner) => {
    if (address && winner.address?.toLowerCase() === address.toLowerCase()) {
      return true;
    }
    if (username && winner.username?.toLowerCase() === username.toLowerCase()) {
      return true;
    }
    return false;
  });
}
