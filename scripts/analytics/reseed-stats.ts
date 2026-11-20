/**
 * Stats reseed, OPERATOR tool: snapshot, apply, roll back and check the stored aggregate.
 * docs/runbooks/STATS_RESEED.md is the procedure; read it first.
 *
 * This is the only reseed tool that touches Redis. It runs only when an authorised operator starts
 * it with their own REDIS_URL, which is read from the environment and never printed or logged. It
 * refuses a Redis that is not on this machine unless --allow-remote is given, and `apply` /
 * `rollback` additionally need --confirm-host to be typed as the host they are about to change.
 *
 * Run from frontend/ so the imports resolve:
 *   cd frontend
 *   REDIS_URL=... npx vite-node ../scripts/analytics/reseed-stats.ts -- <command> [options]
 *
 * Commands
 *   status                          Read-only. What is stored: size, checksum, expiry, checkpoint, totals, the refresh lock.
 *   snapshot --out <dir>            Read-only. Saves the exact stored bytes to <dir>/snapshot.json (never overwrites) and
 *                                   the facts to <dir>/snapshot.meta.json. This file is the rollback.
 *   apply    --snapshot <file> --dir <dry-run out dir> --confirm-host <host>
 *                                   Re-verifies the dry run's output offline, then takes the app's refresh lock, waits out
 *                                   the platform's 60 s function limit, and reads the stored value. If it is the snapshot, it
 *                                   writes the replacement. If the app has refreshed since (normal), it proves the value is
 *                                   the snapshot plus later scans only and merges the same approved gap logs into it. Anything
 *                                   else is refused. The swap is atomic on exactly the bytes it read; it then reads back and
 *                                   releases the lock.
 *   rollback --snapshot <file> --dir <dry-run out dir> --confirm-host <host> [--current-sha256 <hex>]
 *                                   The same guarded swap in reverse: puts the snapshot's exact bytes back, provided the stored
 *                                   value is the replacement or the replacement plus later scans. For anything else, pass the
 *                                   sha256 that `status` shows to say you know what you are replacing.
 *   check    --dir <dry-run out dir>  Read-only. Is the stored value the replacement, or the replacement plus later scans?
 *                                   Run it again after the next refresh and cron: a failure means it was overwritten.
 *
 * Options: --allow-remote, --settle-seconds <75>, --lock-seconds <900>, --lock-wait-seconds <180>
 * Exit code: 0 done / fine, 2 refused or a check failed, 1 an error.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDescendant, parseSnapshot, totalsOf } from "../../frontend/src/lib/stats/reseed";
import { applyResolver, rollbackResolver, verifyApplyInputs, type ReportFile } from "../../frontend/src/lib/stats/reseedPlan";
import { APP_KEYS, connect, describeTarget, guardedSwap, readFacts, type Redis } from "../../frontend/src/lib/stats/reseedStore";
import { derive } from "../../frontend/src/lib/stats/state";

type Command = "status" | "snapshot" | "apply" | "rollback" | "check";
interface Args {
  command?: Command; out?: string; snapshot?: string; dir?: string; confirmHost?: string; currentSha256?: string;
  allowRemote: boolean; settle: number; lockSeconds: number; lockWait: number; help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { allowRemote: false, settle: 75, lockSeconds: 900, lockWait: 180, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === "--") continue;
    else if (k === "--help" || k === "-h") a.help = true;
    else if (["status", "snapshot", "apply", "rollback", "check"].includes(k) && !a.command) a.command = k as Command;
    else if (k === "--out") a.out = v();
    else if (k === "--snapshot") a.snapshot = v();
    else if (k === "--dir") a.dir = v();
    else if (k === "--confirm-host") a.confirmHost = v();
    else if (k === "--current-sha256") a.currentSha256 = v();
    else if (k === "--allow-remote") a.allowRemote = true;
    else if (k === "--settle-seconds") a.settle = Number(v());
    else if (k === "--lock-seconds") a.lockSeconds = Number(v());
    else if (k === "--lock-wait-seconds") a.lockWait = Number(v());
    else throw new Error(`unknown option ${k} (try --help)`);
  }
  return a;
}

const n = (x: number) => x.toLocaleString("en-US");
const stop = (msg: string): never => { throw new Error(msg); };

/** What the dry run left in its output directory, re-verified here instead of trusted. */
function loadAndVerify(snapshotFile: string, dir: string) {
  const snapshotRaw = readFileSync(snapshotFile, "utf8");
  const replacementRaw = readFileSync(join(dir, "replacement-state.json"), "utf8");
  const gapLogsRaw = readFileSync(join(dir, "gap-logs.json"), "utf8");
  const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as ReportFile;
  const { problems, snapshot, replacement } = verifyApplyInputs({ snapshotRaw, replacementRaw, gapLogsRaw, report });
  return { snapshotRaw, replacementRaw, gapLogsRaw, snapshot, replacement, problems };
}

async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.command) { console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*\n?/, "").replace(/^ \* ?/gm, "")); return a.help ? 0 : 1; }

  const url = process.env.REDIS_URL;
  if (!url) return stop("REDIS_URL is not set. It is read from the environment only, and never printed.");
  const target = describeTarget(url);
  if (!target.local && !a.allowRemote) return stop(`REDIS_URL points at "${target.host}", not this machine. Pass --allow-remote only if that is really intended.`);
  console.log(`Redis target: ${target.host}:${target.port}, db ${target.db}${target.tls ? ", TLS" : ""} (${target.local ? "this machine" : "REMOTE"}); keys ${APP_KEYS.state} and ${APP_KEYS.lock}\n`);

  const writes = a.command === "apply" || a.command === "rollback";
  if (writes && a.confirmHost !== target.host) return stop(`this changes ${APP_KEYS.state} on "${target.host}". Pass --confirm-host ${target.host} to confirm that is the Redis you mean.`);
  if (writes && (!a.snapshot || !a.dir)) return stop(`${a.command} needs --snapshot <file> and --dir <dry-run out dir>`);

  // Offline checks first: nothing is connected to until the files agree with each other.
  const files = writes ? loadAndVerify(a.snapshot!, a.dir!) : null;
  if (files && files.problems.length) { console.error(`REFUSED. The dry run's files do not check out:\n  - ${files.problems.join("\n  - ")}`); return 2; }
  if (a.command === "check" && !a.dir) return stop("check needs --dir <dry-run out dir>");

  const c: Redis = await connect(url);
  try {
    const { facts, raw } = await readFacts(c);
    const show = (label: string) => {
      console.log(`${label}: ${facts.present ? `${n(facts.bytes)} bytes, sha256 ${facts.sha256}, ttl ${facts.ttlSeconds}, checkpoint ${facts.checkpointBlock}, updatedAt ${facts.updatedAt}` : "NO VALUE"}`);
      console.log(`refresh lock : ${facts.lock.held ? `HELD (${JSON.stringify(facts.lock.value)}, ttl ${facts.lock.ttlSeconds}s)` : "free"}`);
    };

    if (a.command === "status") {
      show("stored value");
      if (raw) {
        const state = parseSnapshot(raw);
        const t = totalsOf(derive(state));
        console.log(`totals       : wallets ${n(t.playerWallets)}, logs ${n(t.logs)}, sessions ${n(t.sessionsStarted)}, games ${n(t.gamesCompleted)}, usernames ${n(t.usernamesSet)}, rewards ${n(t.rewardsPaid)}, G$ ${n(t.gDollarPaid)}`);
        console.log(`detail       : per-day detail from block ${state.detailSinceBlock ?? "none"}; season XP tally ${state.seasonTally ? `PRESENT (since block ${state.seasonTally.sinceBlock}, window ${state.seasonTally.startBlock}-${state.seasonTally.endBlock ?? "open"})` : "absent"}`);
      }
      return 0;
    }

    if (a.command === "snapshot") {
      show("stored value");
      if (raw === null) return stop("there is no stored value to snapshot");
      parseSnapshot(raw); // throws unless it parses and re-serialises to the same bytes
      if (facts.type !== "string") return stop(`the key is of type ${facts.type}, expected string`);
      const dir = a.out ?? stop("snapshot needs --out <dir>");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "snapshot.json"), raw, { flag: "wx" }); // exact bytes; never overwrites an earlier snapshot
      writeFileSync(join(dir, "snapshot.meta.json"), JSON.stringify({ capturedAt: new Date().toISOString(), target: { host: target.host, port: target.port, db: target.db }, key: APP_KEYS.state, ...facts }, null, 2), { flag: "wx" });
      console.log(`\nwrote ${join(dir, "snapshot.json")} and snapshot.meta.json. KEEP THEM: snapshot.json is the rollback.`);
      return 0;
    }

    if (a.command === "check") {
      show("stored value");
      if (raw === null) { console.error("FAIL: there is no stored value"); return 2; }
      const replacement = parseSnapshot(readFileSync(join(a.dir!, "replacement-state.json"), "utf8"));
      const problems = isDescendant(replacement, parseSnapshot(raw));
      console.log(problems.length ? `\nFAIL: this is not the replacement or a later scan of it:\n  - ${problems.join("\n  - ")}` : "\nOK: nothing in the stored value has gone below the replacement (it is the replacement, or the replacement plus later scans).");
      return problems.length ? 2 : 0;
    }

    // apply / rollback
    show("stored value before");
    const f = files!;
    let resolve: Parameters<typeof guardedSwap>[1]["resolve"];
    if (a.command === "apply") {
      resolve = applyResolver({ snapshotRaw: f.snapshotRaw, replacementRaw: f.replacementRaw, gapLogsRaw: f.gapLogsRaw });
      const before = totalsOf(derive(f.snapshot!)), after = totalsOf(derive(f.replacement!));
      console.log(`\nAPPLY. Merges the approved gap logs into the stored value. Against the snapshot that gives:\n  wallets ${n(before.playerWallets)} -> ${n(after.playerWallets)}, logs ${n(before.logs)} -> ${n(after.logs)}, sessions ${n(before.sessionsStarted)} -> ${n(after.sessionsStarted)}, games ${n(before.gamesCompleted)} -> ${n(after.gamesCompleted)}, usernames ${n(before.usernamesSet)} -> ${n(after.usernamesSet)}, rewards ${n(before.rewardsPaid)} -> ${n(after.rewardsPaid)}, G$ ${n(before.gDollarPaid)} -> ${n(after.gDollarPaid)}\n(If the app has refreshed since the snapshot, the same logs are merged into the value actually stored, after proving it is the snapshot plus later scans only.)\n`);
    } else {
      resolve = rollbackResolver({ snapshotRaw: f.snapshotRaw, replacementRaw: f.replacementRaw, acknowledgedSha256: a.currentSha256 });
      console.log("\nROLLBACK. This puts the snapshot's exact bytes back; the app then re-scans from the snapshot's checkpoint.\n");
    }

    const lockToken = `reseed ${a.command} pid ${process.pid} ${new Date().toISOString()}`;
    const out = await guardedSwap(c, { baseline: f.snapshotRaw, resolve, lockToken, lockSeconds: a.lockSeconds, settleSeconds: a.settle, lockWaitSeconds: a.lockWait, log: (m) => console.log(`  ${m}`) });
    if (out.status === "refused") { console.error(`\nREFUSED (${out.reason}): ${out.detail}\nNothing was changed by this run.`); return 2; }
    const now = await readFacts(c);
    console.log(`\n${a.command === "apply" ? "APPLIED" : "ROLLED BACK"}${out.rebased ? " (the stored value had moved on since the snapshot; the decision was made from the value actually stored)" : ""}. sha256 ${out.beforeSha256} -> ${out.afterSha256}; read back identical; ttl ${now.facts.ttlSeconds}`);
    if (now.raw) { const t = totalsOf(derive(parseSnapshot(now.raw))); console.log(`now stored: wallets ${n(t.playerWallets)}, logs ${n(t.logs)}, sessions ${n(t.sessionsStarted)}, games ${n(t.gamesCompleted)}, usernames ${n(t.usernamesSet)}, rewards ${n(t.rewardsPaid)}, G$ ${n(t.gDollarPaid)}; checkpoint ${now.facts.checkpointBlock}`); }
    console.log(a.command === "apply"
      ? "Next: run `check` now and again after the next refresh and cron tick, and run the endpoint verification from the runbook."
      : "Next: confirm /api/stats serves the snapshot's numbers again once its cache expires (the runbook says how).");
    return 0;
  } finally {
    await c.quit();
  }
}

main().then((code) => process.exit(code), (err) => { console.error(`\nERROR: ${(err as Error).message}`); process.exit(1); });
