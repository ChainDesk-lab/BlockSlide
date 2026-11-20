/**
 * Post-reseed verification of what /api/stats serves, as a pure comparison between the live response
 * and the expected public view the dry run wrote (expected-public.json).
 *
 * The app keeps scanning after a reseed, so the live response may be AHEAD of the expected view (new
 * events, a later checkpoint). What cannot change is history: every day before the expected
 * checkpoint's UTC day, and every week that ended before it, is final. So the default check demands
 * those match exactly and that no total has gone down; --strict (same checkpoint, nothing new yet)
 * demands the whole response match.
 */
import { blockToUnix } from "./config";
import { totalsOf, type Totals } from "./reseed";
import type { StatsSnapshot } from "./state";

export interface Check { id: string; ok: boolean; detail: string }

const utcDay = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

export function verifyStats(live: StatsSnapshot, expected: StatsSnapshot, opts: { strict?: boolean } = {}): { ok: boolean; checks: Check[] } {
  const checks: Check[] = [];
  const add = (id: string, ok: boolean, detail: string) => { checks.push({ id, ok, detail }); };
  const sameCheckpoint = live.checkpointBlock === expected.checkpointBlock;

  add("checkpoint", opts.strict ? sameCheckpoint : live.checkpointBlock >= expected.checkpointBlock,
    `live ${live.checkpointBlock}, expected ${opts.strict ? "exactly" : "at least"} ${expected.checkpointBlock}`);

  const lt = totalsOf(live), et = totalsOf(expected);
  const metrics = Object.keys(et) as Array<keyof Totals>;
  const bad = metrics.filter((m) => (opts.strict || sameCheckpoint ? lt[m] !== et[m] : lt[m] < et[m]));
  add("totals", bad.length === 0, bad.length ? bad.map((m) => `${m} ${lt[m]} vs expected ${et[m]}`).join("; ")
    : `${metrics.length} metrics ${opts.strict || sameCheckpoint ? "equal" : "at or above"} the expected (wallets ${lt.playerWallets}, logs ${lt.logs}, rewards ${lt.rewardsPaid}, G$ ${lt.gDollarPaid})`);

  const cutDay = utcDay(blockToUnix(expected.checkpointBlock));
  const cutUnix = Date.parse(cutDay + "T00:00:00Z") / 1000;

  const liveDaily = new Map(live.daily.map((d) => [d.day, d.events]));
  const dayBad = expected.daily.filter((d) => d.day < cutDay && liveDaily.get(d.day) !== d.events).map((d) => `${d.day} ${liveDaily.get(d.day) ?? "missing"} vs ${d.events}`);
  add("history-daily", dayBad.length === 0, dayBad.length ? `${dayBad.length} day(s) differ: ${dayBad.slice(0, 5).join(", ")}` : `every day before ${cutDay} matches`);

  const liveWeekly = new Map(live.weekly.map((w) => [w.week, w]));
  const weekEnd = (w: string) => Date.parse(w + "T00:00:00Z") / 1000 + 7 * 86_400;
  const weekBad = expected.weekly.filter((w) => weekEnd(w.week) <= cutUnix).filter((w) => {
    const l = liveWeekly.get(w.week);
    return !l || l.newWallets !== w.newWallets || l.activeWallets !== w.activeWallets || l.events !== w.events || l.cumulative !== w.cumulative;
  }).map((w) => `${w.week} (new ${liveWeekly.get(w.week)?.newWallets ?? "missing"} vs ${w.newWallets}, cumulative ${liveWeekly.get(w.week)?.cumulative ?? "missing"} vs ${w.cumulative})`);
  add("history-weekly", weekBad.length === 0, weekBad.length ? `${weekBad.length} week(s) differ: ${weekBad.slice(0, 5).join(", ")}` : `every week that ended before ${cutDay} matches`);

  const liveDetail = new Map(live.detail.days.map((d) => [d.day, d]));
  const detailBad = expected.detail.days.filter((d) => d.day < cutDay).filter((d) => {
    const l = liveDetail.get(d.day);
    return !l || l.sessions !== d.sessions || l.games !== d.games || l.active !== d.active;
  }).map((d) => d.day);
  add("detail-untouched", live.detail.sinceBlock === expected.detail.sinceBlock && detailBad.length === 0,
    `detail starts at block ${live.detail.sinceBlock} (expected ${expected.detail.sinceBlock})${detailBad.length ? `; per-day detail differs on ${detailBad.join(", ")}` : "; per-day detail before the checkpoint's day matches"}`);

  const funnelBad = expected.funnel.filter((f, i) => (opts.strict || sameCheckpoint ? live.funnel[i]?.count !== f.count : (live.funnel[i]?.count ?? -1) < f.count)).map((f) => f.label);
  add("funnel", funnelBad.length === 0, funnelBad.length ? `differs: ${funnelBad.join(", ")}` : "every funnel stage is at or above the expected");

  if (opts.strict) {
    const strictBad = (JSON.stringify({ ...live, updatedAt: 0, scan: 0 }) !== JSON.stringify({ ...expected, updatedAt: 0, scan: 0 }));
    add("whole-response", !strictBad, strictBad ? "the live response differs from the expected view somewhere" : "the live response equals the expected view (apart from updatedAt and scan)");
  }
  return { ok: checks.every((c) => c.ok), checks };
}

/** The numbers /stats and /analytics should show, as the text a visitor sees (en-US grouping). */
export function visibleNumbers(view: StatsSnapshot): Array<{ label: string; text: string }> {
  const f = (x: number) => x.toLocaleString("en-US");
  return [
    { label: "Player wallets", text: f(view.playerWallets) },
    { label: "Sessions started", text: f(view.totals.sessionsStarted) },
    { label: "Games completed", text: f(view.totalGames) },
    { label: "G$ paid to players", text: f(view.gDollarPaid) },
  ];
}
