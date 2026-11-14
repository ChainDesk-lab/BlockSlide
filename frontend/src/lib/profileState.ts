/**
 * Profile UI decisions, kept pure so they can be tested without a wallet or network.
 *
 * Only values the app can actually read are shown. Rank comes from the first leaderboard
 * page (the API has no per-wallet lookup), personal best and games played from the subgraph.
 * Solve time and per-run history are not recorded by any source the app reads, so they are
 * reported as such rather than estimated.
 */

export interface ProfileStatView {
  value: string;
  /** The caption under the value. */
  note: string;
  /** "empty" renders the value muted: it is a status, not a number. */
  tone: "default" | "accent" | "empty";
}

export function rankStat(o: { loading: boolean; error: boolean; rank: number | null; pageSize: number }): ProfileStatView | null {
  if (o.loading) return null;
  if (o.rank !== null) return { value: `#${o.rank}`, note: "Global standing", tone: "default" };
  if (o.error) return { value: "Unavailable", note: "Leaderboard can't be read right now", tone: "empty" };
  return { value: `Outside top ${o.pageSize}`, note: "Global standing", tone: "empty" };
}

export function countStat(value: number | null, note: string): ProfileStatView | null {
  if (value === null) return null;
  return { value: value.toLocaleString("en-US"), note, tone: "accent" };
}

/** Solve time isn't recorded on-chain or by the indexer: say so, never estimate it. */
export const SOLVE_TIME_STAT: ProfileStatView = { value: "Not tracked", note: "Run times aren't recorded yet", tone: "empty" };

/** "https://blockslide.app/?ref=0x7a8c…" shortened for the invite field; the copied link is always the full one. */
export function shortLink(url: string, keep = 28): string {
  return url.length <= keep ? url : `${url.slice(0, keep)}…`;
}

/**
 * The invite card's count line. `played` is null when it can't be read right now; `counts` is
 * null while loading, "error" when the counts can't be read at all.
 */
export function inviteNote(counts: { joined: number; played: number | null } | null | "error"): string | null {
  if (counts === null) return null;
  if (counts === "error") return "Invite counts can't be read right now";
  if (counts.joined === 0) return "No one has joined through your link yet";
  const joined = `${counts.joined} player${counts.joined === 1 ? "" : "s"} joined through your link`;
  return counts.played === null ? joined : `${joined} · ${counts.played} ${counts.played === 1 ? "has" : "have"} played`;
}
