/**
 * The contract's own top-10 score table (`getLeaderboard()`), shaped for the
 * analytics page. This is the on-chain record of the best submitted scores,
 * distinct from the XP leaderboard served by /api/leaderboard.
 */

export interface RawLeaderboardEntry { player: string; score: bigint; highestTile: number }

export interface TopScore { rank: number; player: string; username: string | null; score: number; highestTile: number }

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Drop empty slots (the table is a fixed array of 10, zero-filled until enough
 * scores exist), attach on-chain usernames, and rank by score.
 *
 * The contract does NOT keep the array sorted: it replaces entries in place, so
 * slot 0 is not the best score (on 29 Oct 2026 slot 0 held 11,480 while the
 * best was 15,308). Ranking therefore sorts here, by score then highest tile.
 * `usernames` is index-aligned with the non-empty entries, in contract order.
 */
export function shapeTopScores(entries: readonly RawLeaderboardEntry[], usernames: readonly string[]): TopScore[] {
  const filled = entries.filter((e) => e.player.toLowerCase() !== ZERO && e.score > 0n);
  return filled
    .map((e, i) => ({
      player: e.player.toLowerCase(),
      username: usernames[i] ? usernames[i] : null,
      score: Number(e.score),
      highestTile: Number(e.highestTile),
    }))
    .sort((x, y) => y.score - x.score || y.highestTile - x.highestTile)
    .map((r, i) => ({ rank: i + 1, ...r }));
}
