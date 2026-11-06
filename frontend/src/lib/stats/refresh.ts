/**
 * One bounded catch-up of the stored aggregate, shared by GET /api/stats and the cron route.
 * The caller must already hold the lock.
 *
 * Safety rules:
 * - It only ever builds on an aggregate that was read back successfully ("ok"). A missing,
 *   unreadable, garbled or wrong-version value is reported, never scanned over: scanning an
 *   empty stand-in from genesis and saving it would replace years of history with a few hours.
 * - The scan runs on a copy. If it throws part-way, the last known-good aggregate is returned
 *   untouched, so a half-applied chunk is never served or saved.
 * - The save is conditional on the stored value not having changed since it was read.
 */
import type { StatsState } from "./state";
import { loadState, saveState, type LoadResult, type SaveResult } from "./store";
import { getHeadBlock, scanForward, type ScanResult } from "./scan";

export type RefreshOutcome =
  /** Nothing to build on; nothing was scanned or written. */
  | { status: "not_loaded"; load: Exclude<LoadResult, { status: "ok" }> }
  /** The scan failed; `state` is the aggregate as it was read, unchanged and not re-saved. */
  | { status: "failed"; state: StatsState; error: string }
  | { status: "scanned"; state: StatsState; head: number; result: ScanResult; save: SaveResult | "nothing_new" };

export async function refreshAggregate(): Promise<RefreshOutcome> {
  const load = await loadState();
  if (load.status !== "ok") return { status: "not_loaded", load };

  const work = structuredClone(load.state);
  try {
    const head = await getHeadBlock();
    const result = await scanForward(work, head);
    const save = result.chunks > 0 ? await saveState(work, load.raw) : "nothing_new";
    return { status: "scanned", state: work, head, result, save };
  } catch (err) {
    return { status: "failed", state: load.state, error: (err as Error).message };
  }
}
