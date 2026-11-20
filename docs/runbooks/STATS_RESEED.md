# Stats reseed runbook: correcting two holes in the production `/stats` aggregate

> **Status: PREPARED, NOT EXECUTED.** Nothing in this document has been done to production.
> The preparation never connected to the production Redis, never held a production credential, and wrote nothing
> to production. Every step marked **[operator]** below is outstanding and needs an authorised operator and an
> explicit approval (section 13). The rehearsal in section 11 ran against a throwaway Redis on a developer machine.

## 1. Summary

The public Stats and Analytics pages understate the game's history. The stored aggregate (`stats:v1:state` in Redis)
is missing 204 logs from two separate stretches of blocks, so every all-time number on those pages is a little low.

| Metric | Production now | Correct | Missing |
|---|---:|---:|---:|
| Player wallets | 696 | **707** | 11 |
| Logs | 14,326 | **14,530** | 204 |
| Sessions started | 4,072 | **4,121** | 49 |
| Games completed | 3,144 | **3,192** | 48 |
| Usernames set | 682 | **693** | 11 |
| Rewards paid | 78 | **78** | 0 |
| G$ paid | 730 | **730** | 0 |

"Production now" is the public `/api/stats` response at checkpoint block 82,177,767 on 2026-11-07. "Correct" is the full
scan described in section 4. Rewards paid and G$ paid are the same before and after.

**The fix is to merge the 204 missing logs into the stored aggregate, not to rebuild it.** Everything else in the stored
value stays byte-for-byte as it is (section 3). The procedure is: snapshot, dry run, review, apply under the app's own
lock, verify, monitor, with a one-command rollback (section 8). The tools are written and tested; the rehearsal passed
end to end against the real application code and real chain data (section 11).

## 2. What is wrong

### 2.1 The two holes

Times are computed from block numbers (one block per second, anchored at block 78,384,272 = 2026-09-24T21:23:50Z, as
in `frontend/src/lib/stats/config.ts`), so they are accurate to about a minute.

| | Hole 1 | Hole 2 |
|---|---|---|
| **Blocks** | **78,449,181 to 78,475,878** (26,698 blocks) | **79,399,477 to 79,400,437** (961 blocks) |
| **UTC** | 2026-09-25 15:25:39 to 22:50:36 | 2026-10-06 15:23:55 to 15:39:55 |
| **Logs missing** | 196 | 8 |
| **What they are** | 47 `SessionStarted`, 11 `UsernameSet`, 46 `ScoreSubmitted`, 46 `XpEarned`, 46 `StreakUpdated` | 2 `SessionStarted`, 2 `ScoreSubmitted`, 2 `XpEarned`, 2 `StreakUpdated` |
| **Nearest counted logs** | blocks 78,440,387 (before) and 78,475,889 (after) | blocks 79,340,200 (before) and 79,476,507 (after) |
| **Shortfall on the day** | stored 245 of 441 logs | stored 0 of 8 logs (the whole day) |

Together: 204 logs, 11 wallets the aggregate has never seen (14 wallets touched, 3 of them already known), 11 usernames,
49 sessions, 48 completed games. No `RewardPaid`, purchase or other event is in either hole. Both holes lie far below
the per-day detail, which starts at block 81,916,916 (2026-11-04), so the detail and the recent-events feed are unaffected.

Outside the two holes the stored aggregate matches the complete scan: removing exactly these two runs reproduces every public series.
The corrected weekly series differ only from the week of 2026-09-21 on (new wallets that week 92 becomes 103; the running total is 11 higher from that
week onward).

Each hole is every log from its first to its last block. A boundary placed anywhere between the nearest counted log and the first missing
log (and likewise at the other end) describes the same hole.

### 2.2 How we know

Four independent kinds of evidence. None of them accessed or modified the production Redis. The investigation did make read-only requests to the public production
`/api/stats` endpoint (evidence 1 compares against that response); the log sources were Blockscout and a public Celo RPC:

1. **The public series.** Rebuilding the aggregate from the full log list minus exactly these two runs gives a state whose
   public view equals production's `/api/stats` response in every series (totals, daily, weekly, funnel, engagement,
   retention, per-day detail, recent events). That is the `explains-everything` gate of the dry run.
2. **Two log sources agree.** The complete list (14,530 logs) comes from Blockscout's archive index. Re-reading each hole's
   exact blocks from a Celo RPC node, four reads per chunk and unioned, returns exactly the same logs as Blockscout, with the
   same topics and data, for both holes (196 and 8). No read disagreed and none failed.
3. **Event counts match the independently verified totals.** The Blockscout list has 4,121 `SessionStarted`, 3,192
   `ScoreSubmitted`, 3,192 `XpEarned`, 3,192 `StreakUpdated`, 693 `UsernameSet`, 78 `RewardPaid`, 29 `XpBoostPurchased`,
   6 `ShieldPurchased`, 5 `UndoPurchased`, 1 `CosmeticPurchased` and 21 non-player logs: 14,530 in all.
4. **A second, fully independent full-history scan from RPC** (section 4.3), run on 2026-11-07 and pinned to block 82,177,767: all 2,577 chunks
   read three times each, **none failed and none disagreed**. It found **14,530 logs**, a topic histogram equal to Blockscout's event by event (including the 21
   non-player logs), and **707 wallets** (the union of the player events). Its unique wallets per event (616 usernames, 537 sessions, 284 games, 54 rewarded) equal the
   corrected funnel exactly; the stored funnel has 605, 526, 273 and 54.

### 2.3 What caused them

- **Hole 1 is the incident recorded in `scripts/analytics/seed-stats.mjs`** (added in commit `921ed29a`, 2026-11-04):
  "Seeding to the newest log [Blockscout] returns and checkpointing there left a permanent hole once (25 Sep 2026: 196 logs
  never counted, found by a full RPC re-scan on 3 Nov 2026), because the incremental scan only ever reads ABOVE the
  checkpoint." The count (196) and the date (25 Sep) match exactly, and the hole ends only 11 blocks below the next counted log, which is what a seed
  checkpoint just above a still-filling stretch would look like. (That last point is an inference: the seed's checkpoint block was not recorded.) The seed script was fixed with a 50,000-block safety margin, but the stored
  production value was never reseeded, so the hole stayed.
- **Hole 2 (8 logs, 6 Oct) is a different, previously unrecorded miss.** It is every log of that day, so a stretch of the
  live scan returned nothing for it. The scanner reads each chunk three times and unions the results, which defends against
  an occasional empty answer but not against all three being empty. **The cause is not established.** It dates from 6 Oct, before the recent stats changes (#67, #72), so it is not a result of them.

Why neither hole ever healed: `scan.ts` only reads blocks above the stored checkpoint, so a missed stretch is never revisited.

## 3. Approach: merge the holes, do not rebuild

`scripts/analytics/seed-stats.mjs --replace` rebuilds the whole aggregate from Blockscout. Its own header says what that
costs: "It does not rebuild the optional fields the live scan adds (per-day sessions/games/active wallets, the recent-events
feed and the season XP tally): those restart from the new checkpoint, and the page shows earlier days' detail as unknown."
It also rewinds the checkpoint by 50,000 blocks. That would change data unrelated to the holes, which this runbook must not do.

| | `seed-stats.mjs --replace` | This runbook (merge) |
|---|---|---|
| Totals, wallets, daily and weekly series | rebuilt | corrected |
| Per-day detail (since 2026-11-04) | **reset** | untouched |
| Recent-events feed | **reset** | untouched |
| Checkpoint | **rewound 50,000 blocks** | untouched |
| `updatedAt` | new | untouched |
| Every wallet the holes do not touch (693 of 707) | rebuilt | byte-identical |
| Rewards paid, G$ paid | rebuilt | untouched (and checked) |
| Guard against a state that moved | the lock and a backup file | byte-exact compare-and-swap under the app's lock, after a settle wait |

Why a merge is exact. Every field a log changes in `applyLogs()` (`state.ts`) is a commutative merge: counters add,
a wallet's row takes the minimum first block, maximum last block, summed counts, OR of the event mask and OR of the week
bitmap. The only order-dependent parts (per-day detail, the recent-events feed, the season tally) cover only the UTC day
of `detailSinceBlock` onward. A hole entirely before that day can therefore be filled by folding its logs in, and the result
is identical to what a complete scan would have produced. `mergeGapLogs()` refuses anything it cannot prove safe: a log above
the checkpoint, on or after the first detail day, inside a season tally, before genesis, a duplicate, or an empty gap.
(Running the missing logs through `applyLogs()` on the live state instead is **not** equivalent: it would add Sep/Oct entries to
the per-day detail and push old events into the recent feed. A test pins that down.)

## 4. Method: the full scan and the Blockscout reconciliation

### 4.1 Building the complete log list

1. **Blockscout, blocks 69,294,066 (genesis) to a safety horizon.** The v2 archive index
   (`/api/v2/addresses/<game>/logs`), the same source as `seed-stats.mjs`. On 2026-11-07 it took 310 pages (50 logs each). The
   public limit is 180 requests per window and each page took 13 to 24 seconds, so the collector
   (`scripts/analytics/lib/blockscout-logs.mjs`) cuts the range into spans fetched concurrently, honours the rate-limit headers
   across all workers, and saves progress so an interrupted run resumes. The collection took about 32 minutes (1,935 s) with 8 spans at a time. (The
   Etherscan-style `module=logs&action=getLogs` endpoint answered `429` after 10 requests, with a window of about 32 minutes, when tried; do not use it.)
2. **The newest stretch from RPC.** Blockscout's newest blocks can still be filling in, which is exactly how hole 1 happened.
   Logs at or below `checkpoint - 50,000` blocks (about 14 hours) are taken from Blockscout, and the stretch above it up to the
   checkpoint is read from a public Celo RPC (`forno.celo.org`) in 5,000-block chunks, each read three times and the results
   unioned by (block, logIndex). This stretch held 0 logs on 2026-11-07, which is consistent with Blockscout's newest log
   being at block 82,073,852.
3. **The union-of-repeats rule.** Public Celo nodes sometimes answer a range that has logs with an empty result instead of
   an error. The failure is only ever a missing log, never an invented one, so repeated reads unioned converge on the truth.
   Chunks where the repeated reads disagree are counted and reported, and a chunk where every read fails makes the log source
   gate fail.

### 4.2 Reconciliation

| Check | Result on 2026-11-07 |
|---|---|
| Blockscout log count | 14,530, all unique, blocks 69,294,066 to 82,073,852 |
| Event counts against the verified totals | equal, event by event (section 2.2) |
| Hole 1 re-read from RPC (6 chunks, 4 reads each) | identical to Blockscout: 196 logs, same topics and data |
| Hole 2 re-read from RPC (1 chunk, 4 reads) | identical to Blockscout: 8 logs, same topics and data |
| Newest stretch from RPC (blocks 82,127,457 to 82,177,456, 3 reads) | 0 logs, no disagreement, no failed chunk |
| First-seen week per wallet from Blockscout's transaction list (checked while investigating) | 707 wallets, 103 in the week of 2026-09-21, equal to the corrected series |
| Full-history RPC scan (`count-users.mjs`, 2,577 chunks, 3 reads each, pinned to block 82,177,767) | 14,530 logs, 0 failed and 0 disagreeing chunks, histogram equal to Blockscout's, 707 wallets, per-event wallets 616 / 537 / 284 / 54 equal to the corrected funnel |
| G$ paid recomputed from the 78 raw `RewardPaid` logs | 730,000,000,000,000,000,000 wei = 730 G$, equal to the stored value |

A wallet is the topic 1 of an explicit allowlist of player events (`PLAYER_EVENT_SIGS` in `config.ts`), never any
address-shaped topic: `CosmeticCatalogUpdated`'s indexed item id and `Upgraded`'s implementation address would inflate the
count (see the `user-count-definitions` note in the project memory, 692 against 676 on 24 Sep).

### 4.3 The second full scan

`scripts/analytics/count-users.mjs` re-reads the whole history from RPC (2,577 chunks, repeated reads, 10 to 12 at a time) and prints
the unique wallets per event and a topic histogram. It is the same method that found hole 1 on 3 Nov, and it shares no code or data source with the Blockscout path.
It was run for this document (about 20 minutes) with `TO_BLOCK=82177767 REPEATS=3 CONCURRENCY=10`. Repeat it, pinned to the new checkpoint
(`TO_BLOCK=<checkpoint> node count-users.mjs`), if you want the same cross-check on the day. It is entirely read-only.

## 5. Before you start

**Who does what.** **[anyone]** can run the dry runs and verification: they need only the repo and network access to
Blockscout, a public RPC and the public site. **[operator]** is a person authorised to read and write the production Redis;
only they hold `REDIS_URL`. **[reviewer]** reads the dry-run report. **[approver]** (the owner) signs section 13 before step 5.

**The operator needs.** A Redis user with `GET`, `SET`, `DEL`, `EXPIRE`, `TTL`, `TYPE`, `WATCH`, `UNWATCH`, `MULTI` and `EXEC`
on `stats:v1:state` and `stats:v1:lock` (the tool opens up to three short-lived connections); a Redis server of version 6.0
or later (`SET ... KEEPTTL`); Node 20 or later and `npm ci` in `frontend/`. The credential is read from the environment and is
never printed. Never put it on a command line:

```sh
read -rs REDIS_URL; export REDIS_URL      # paste it; nothing is echoed
```

**Timing.** Avoid the cron ticks (`0 */6 * * *`, so 00:00, 06:00, 12:00 and 18:00 UTC) by at least 15 minutes either side, and
prefer a quiet hour. The reseed itself blocks refreshes for about 90 seconds; the pages keep serving the stored numbers meanwhile.

**Common to every command.** Run from `frontend/`. The scripts are TypeScript run by `vite-node`:
`npx vite-node ../scripts/analytics/<script>.ts -- <options>`. Against a Redis that is not on this machine the operator tool
refuses unless `--allow-remote` is given, and `apply` and `rollback` additionally require `--confirm-host <the Redis host>`.

| Script | Touches | Writes |
|---|---|---|
| `reseed-dry-run.ts` | Blockscout, a public RPC, the public `/api/stats` (GET only) | files under `--out-dir` and the Blockscout cache |
| `verify-live-stats.ts` | the site you point it at (GET only) | nothing |
| `reseed-stats.ts` | **the Redis in `REDIS_URL`** | `snapshot` writes files; `apply` and `rollback` write `stats:v1:state` and take/release `stats:v1:lock` |

Tests pin this down: the dry run, verification and every library they use contain no Redis client, connection or write and
never import the module that has them (`reseedDryRun.test.ts`).

## 6. Procedure

### Step 1. Dry run from public data **[anyone]**

Confirms the holes are still what section 2 says and nothing new has appeared. Changes nothing.

```sh
cd frontend
npx vite-node ../scripts/analytics/reseed-dry-run.ts -- \
  --expect ../scripts/analytics/reseed-expected.2026-11-07.json \
  --rpc-verify-gap --out-dir ./reseed-out/public
```

The first run reads Blockscout for roughly 30 to 45 minutes (32 minutes with 8 spans at a time on 2026-11-07; the default is 6). It saves progress in `./reseed-logs-cache.json`; if it stops, run
the same command again. Keep `--segments` and `--blockscout-to` unchanged between runs or the cache is ignored.

Expected: both holes as in section 2.1, the seven totals under "replacement" equal to the expected file, every gate `PASS` except
two `SKIPPED` that need the snapshot, and `NO GATE FAILED, but a public response cannot show the untouched fields`.

If anything differs from section 2 (a different hole, a failed gate), **stop** and read section 12. If new player events have
happened since 2026-11-07, the `expected-totals` gate fails for a good reason: take the new independently verified totals from the
dry run's "independent" figures, check them against section 4.3, and only then update the expected file. Never edit it to make a
gate pass without understanding the difference.

### Step 2. Snapshot **[operator]**

```sh
cd frontend
npx vite-node ../scripts/analytics/reseed-stats.ts -- status   --allow-remote
npx vite-node ../scripts/analytics/reseed-stats.ts -- snapshot --allow-remote --out ~/stats-reseed/<date>
```

`status` is read-only: it shows the Redis host, the value's size, SHA-256, expiry, checkpoint and `updatedAt`, the current
totals, where per-day detail starts, whether a season XP tally is present, and whether the refresh lock is held. Check the host is the production Redis and the totals are the "production now"
column of section 1 (or higher, if events have happened).

`snapshot` writes the stored bytes to `<dir>/snapshot.json` and the facts to `snapshot.meta.json`. It refuses to overwrite an
earlier snapshot, and it refuses a value that does not serialise back to the same bytes. **`snapshot.json` is the rollback: keep
it, with the report, until the reseed has been verified for at least a week.** It contains only public on-chain data
(wallet addresses and counts), but keep it with the operator's other working files.

Do not snapshot with `redis-cli GET`: it appends a newline, which changes the bytes and defeats the byte-exact checks.

Expect the stored value to change after the snapshot (its checkpoint and `updatedAt` move on every refresh). That is normal and is handled at step 5.

### Step 3. Dry run from the snapshot **[anyone with the snapshot file]**

```sh
cd frontend
npx vite-node ../scripts/analytics/reseed-dry-run.ts -- \
  --snapshot ~/stats-reseed/<date>/snapshot.json \
  --expect ../scripts/analytics/reseed-expected.2026-11-07.json \
  --rpc-verify-gap --out-dir ~/stats-reseed/<date>/dry
```

It rebuilds the comparison at the snapshot's own checkpoint, so the two are directly comparable. It reuses the Blockscout cache from
step 1 when run within about a day of it (the default `--blockscout-to` is the checkpoint minus 50,000 blocks, rounded up to the next
100,000); later than that, pass the same `--blockscout-to` and `--segments` as step 1 or it reads Blockscout again. The required result is
`READY TO APPLY: every gate passed`, with `replacement-state.json`, `gap-logs.json`, `report.json` and `expected-public.json` written.
The reviewer checks, in the console output or `report.json`:

- [ ] The two holes are the ones in section 2.1 (blocks, logs, event mix). With the snapshot, exactly one combination of runs fits.
- [ ] "stored now" matches the totals `status` showed; "replacement" equals the expected file; rewards paid and G$ paid are `unchanged`.
- [ ] All eleven gates are `PASS`, none `SKIPPED`. In particular "only what the gap explains changed" (verified field by field),
      "the app's own loader accepts the replacement", and "the gap's logs, re-read from RPC, are identical to Blockscout's".
- [ ] `inputs.stored.sha256` equals the SHA-256 `status` printed in step 2.

The gates, and what each one stops: see Appendix A.

### Step 4. Approval **[approver]**

Section 13 signed. Nothing is applied before this.

### Step 5. Apply **[operator]**

```sh
cd frontend
npx vite-node ../scripts/analytics/reseed-stats.ts -- apply --allow-remote --confirm-host <the Redis host> \
  --snapshot ~/stats-reseed/<date>/snapshot.json --dir ~/stats-reseed/<date>/dry
```

It takes about 90 seconds. It first re-verifies the dry run's files offline (it trusts nothing the report merely claims: it
recomputes the merge from the snapshot and the gap logs and requires the replacement to be exactly that, byte for byte), then:

1. takes the app's refresh lock (`stats:v1:lock`) with its own token, waiting up to 3 minutes for a refresh that holds it;
2. waits 75 seconds, re-asserting the lock each poll (section 7 says why 75);
3. reads the stored value as it is now, under the lock, and decides from that:
   - **it is the snapshot:** it writes the replacement the dry run produced;
   - **it is not, because the app has refreshed since the snapshot** (normal: the app rewrites the value on each refresh, which happens when a request arrives
     and the value is more than 5 minutes old, and at the 6-hourly cron): it proves, field by field, that the value is *the snapshot plus scans of later blocks and nothing
     else* (every day before the snapshot's checkpoint unchanged, every wallet's first block unchanged, per-day detail and older feed entries
     unchanged, nothing gone down), then merges the **same approved gap logs** into the value actually stored. The result is the replacement plus those later scans;
   - **anything else** (history changed, the checkpoint went back, or the gap is already in) is refused. That last case is what stops a second apply of the
     same files from counting the gap twice;
4. swaps with `WATCH`/`MULTI`/`EXEC` on exactly the bytes it read, which Redis aborts if the key changes at all in between, keeping any expiry;
5. reads the value back and requires it to be exactly what it wrote;
6. releases the lock only if the token is still its own.

Expected ending: `APPLIED. sha256 <before> -> <after>; read back identical; ttl -1` and a line with the totals now stored. If the value had moved on,
it says so (`APPLIED (the stored value had moved on since the snapshot ...)`) and the checkpoint is the app's later one. If it was the snapshot, the second
hash equals `inputs.replacement.sha256` in `report.json`.

**Abort and do not retry blindly if** it prints `REFUSED`. Nothing was changed by a refused run. The reasons and what to do:

| Refusal | Meaning | Do |
|---|---|---|
| `state_changed` | The stored value is not the snapshot plus later scans: history changed, the checkpoint went back, **the gap is already in** (a second apply of the same files), or it changed during the swap. The message names the first differences | If the gap is already in, nothing is wrong: run `check`. Otherwise re-run steps 2 and 3 |
| `lock_unavailable` | A refresh (or something else) held the lock for 3 minutes | Look at `status`; retry away from a cron tick |
| `lock_lost` | Something else took the lock during the wait | Investigate who; retry |
| `verification_failed` | The read-back is not what was written | Run `status` and `check` **immediately** (section 7), then decide on rollback |
| "The dry run's files do not check out" | A file was altered, or the report is not `readyToApply` | Re-run step 3; never edit these files |

### Step 6. Verify: `check` **[operator]**, the endpoint verification **[anyone]**, immediately and then as in section 10

```sh
cd frontend
npx vite-node ../scripts/analytics/reseed-stats.ts -- check --allow-remote --dir ~/stats-reseed/<date>/dry
npx vite-node ../scripts/analytics/verify-live-stats.ts -- --base https://blockslide.app \
  --expected ~/stats-reseed/<date>/dry/expected-public.json --browser --playwright <path to playwright/index.mjs>
```

### Step 7. Monitor **[operator, then anyone]**

Run `check` (and the verification) about 10 minutes after the apply, about 5 minutes after the next cron tick, and a day later.
A failure means the corrected value was overwritten; section 7 says what to do. After a week of clean checks, the snapshot may be archived.

## 7. Avoiding concurrent refreshes overwriting the corrected state

**Who writes `stats:v1:state`:** `GET /api/stats` when the stored `updatedAt` is older than 5 minutes (`STALE_AFTER_MS`, default
`5 * 60 * 1000`; it can be overridden by `STATS_STALE_AFTER_MS`), and the cron `GET /api/stats/refresh` every 6 hours. Both take the
lock (`SET stats:v1:lock <timestamp> NX EX 60` from the page route, `EX 120` from the cron), read the value, scan forward on a
copy, and save with a GET-compare-SET that skips if the value changed since it was read (`refresh.ts`, `store.ts`). Both routes
have `maxDuration = 60`, so the platform kills a function after 60 seconds. Releasing the lock is an unconditional `DEL`.

**What could go wrong and what stops it:**

| Hazard | Stopped by |
|---|---|
| A new refresh starts during the procedure | The reseed holds the same lock. The app, which wants to refresh, finds it held and serves the stored value without scanning or saving |
| A refresh that started before the reseed took the lock, and writes after it | The reseed waits 75 seconds (more than the 60-second function limit) holding the lock, so any earlier refresh has finished or been killed. If one still writes, its compare fails against the changed value and it is skipped |
| A slow earlier refresh ends and deletes the lock (the app's release is an unconditional `DEL`) | The reseed re-asserts the lock every 5 seconds and re-takes it if it was removed. If someone else took it, the reseed stops with `lock_lost` and changes nothing. It never deletes a lock that is not its own |
| The stored value changes between the snapshot and the swap (the normal case: the app refreshed) | The decision is made under the lock from the value actually stored, after proving it is the snapshot plus later scans only (step 5). Anything else is refused |
| The value changes between that read and the write | The swap is a compare-and-swap on exactly the bytes read, so it refuses |
| The same files are applied twice | The second finds the gap already in the value and refuses; nothing is counted twice |
| The key changes between the compare and the write | `WATCH`: Redis aborts the transaction |
| A refresh reads the old value, the reseed swaps, and the refresh then saves | Its compare fails (the value changed), so its save is skipped. Tested with the app's compare logic reproduced in the test; the app's own save code was not run against a swap |
| Two operators at once | Only one takes the lock; the swap is exclusive |
| A cron tick during the procedure | The cron's lock attempt reports `skipped: locked` and does nothing; the reseed also waits for a cron that holds the lock. Schedule away from the ticks anyway |
| The reseed tool crashes after taking the lock | The lock expires by itself (900 seconds by default, `--lock-seconds`); refreshes are blocked until then, and pages serve the stored numbers. If the operator is sure no tool is running, `DEL stats:v1:lock` clears it |

**What is not closed.** The app's own `saveState` is two commands (GET, then SET), not one, as its comment says ("narrows the
race the lock already guards rather than closing it outright"). A refresh that somehow outlived the lock **and** the 75-second wait
and is inside that millisecond window when the swap lands could still write its older base over the corrected value. This is
very unlikely (the platform kills functions at 60 seconds), but it is why step 7 exists: `check` detects exactly this, because the
old value has lower counts on the repaired days. **Recovery:** an overwrite by an older refresh leaves the old state, either exactly the snapshot or the snapshot plus later
scans. Both are what step 5 recognises, so run step 5 again with the same files (rehearsed for both). If the stored value is
anything else, take a new snapshot and start again at step 3.

**Optional follow-up (not needed to run this):** make `saveState` atomic (`WATCH`/`MULTI`, or a Lua compare-and-set) and make
`releaseLock` delete only its own token. That removes the remaining window and the premature-release behaviour. It is a change to
deployed code, so it needs its own review and release.

## 8. Rollback

Use it if verification fails in a way new activity cannot explain, or something regresses. It restores the snapshot's exact bytes
under the same lock, settle wait and compare-and-swap.

```sh
cd frontend
npx vite-node ../scripts/analytics/reseed-stats.ts -- rollback --allow-remote --confirm-host <the Redis host> \
  --snapshot ~/stats-reseed/<date>/snapshot.json --dir ~/stats-reseed/<date>/dry
```

- It accepts a stored value that is the replacement **or the replacement plus later scans** (what the app leaves within minutes),
  decided under the lock from the value actually stored. For anything else (the test is that nothing in the stored value has gone below the replacement),
  run `status` and pass its SHA-256 as `--current-sha256 <hex>` to say you know what you are replacing.
- Afterwards the stored value hashes to the snapshot's SHA-256 (rehearsed: identical). The app then rescans from the snapshot's
  checkpoint; at most 12 chunks (60,000 blocks, about 16.7 hours) per refresh, so a snapshot older than that catches up over a few
  refreshes. No data is lost: the scan is deterministic from the chain.
- The pages show the old, known-low numbers again. Do not leave it that way: find the cause and apply again.
- **Last resort if the tool cannot run.** Take the lock by hand (`SET stats:v1:lock rollback NX EX 300`), restore with
  `redis-cli -x SET stats:v1:state < snapshot.json` (`-x` reads the argument from the file; byte-identical, checked), then
  `DEL stats:v1:lock`. This has none of the compare-and-swap guarantees; prefer the tool.

## 9. Rewards paid and G$ paid are preserved

Five independent reasons, three of them checked by the tools on every run:

1. **The holes contain no reward.** Neither contains a `RewardPaid` log (the dry run reports each hole's event mix, and a gate
   fails if either does).
2. **The merge adds nothing to them.** `mergeGapLogs()` adds each log's own effect, and `RewardPaid` is the only event that touches
   `rewardPaidWei`.
3. **A gate compares them before and after.** `rewards-preserved` requires the same `RewardPaid` count (78) and the same
   `rewardPaidWei` (730,000,000,000,000,000,000) in the snapshot and the replacement, and `apply` re-runs the same check from the
   files before it touches Redis, and again on the value actually stored when it has to merge into a value that has moved on. A reward in a hole fails it even when everything else about the replacement is internally
   consistent (tested).
4. **Recomputed from the raw logs.** The 78 `RewardPaid` logs' amounts sum to exactly 730 G$, equal to the stored value.
5. **The verifier checks the live site.** `verify-live-stats.ts` requires rewards paid and G$ paid to equal the expected values
   (or to have only risen, if new rewards were paid after the apply).

## 10. Verifying `/api/stats`, `/stats` and `/analytics`

```sh
cd frontend
npx vite-node ../scripts/analytics/verify-live-stats.ts -- --base https://blockslide.app \
  --expected <dry out dir>/expected-public.json [--strict] [--browser --playwright <path>]
```

It reads `/api/stats?cb=<time>` (a cache-buster, so it shows what the app serves now) and checks, against `expected-public.json`:

| Check | Default | `--strict` |
|---|---|---|
| Checkpoint | at least the expected | exactly the expected |
| The seven totals | at least the expected (equal if the checkpoint is the same) | equal |
| History: every day before the expected checkpoint's UTC day, and every week that ended before it | **equal** | equal |
| Per-day detail: start block, and every day before the checkpoint's day | **equal** | equal |
| Funnel | each stage at least the expected | equal |
| Whole response | not checked | equal apart from `updatedAt` and `scan` |

Default mode is the one to use after the app has scanned further: history cannot change, and no total may fall. `--strict` is only
for the moments straight after the apply, before any new block has been scanned.

It then requests `/stats` and `/analytics` (HTTP 200), and with `--browser` opens each in a real browser (signed out, service
worker blocked) and waits until the page shows the numbers `/api/stats` reports, with no error panels and no page errors.
Playwright is not a dependency of this repo; the script says plainly when it was skipped, and then the pages were **not** checked
in a browser (open each in a private window and compare the numbers it prints).

**Caching.** `/api/stats` is sent with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, so the CDN can serve the old
body for up to about 6 minutes after the apply. The verifier's cache-buster avoids this for the API. The pages fetch
`/api/stats` without one and refresh every 120 seconds, so allow roughly 6 to 8 minutes before a page shows the corrected numbers
(`--wait-minutes` defaults to 8). A page that still shows the old numbers after that is a real failure, not caching.

What a visitor should see: **Player wallets 707, Sessions started 4,121, Games completed 3,192, G$ paid to players 730** (higher
if there has been new activity since).

## 11. Rehearsal record

Run on 2026-11-07 on a developer machine, with **no production system involved except read-only requests to the public site,
Blockscout and a public RPC**:

- **Redis:** a throwaway Redis 8.10 on `127.0.0.1:6391`, no persistence, separate from every other instance.
- **State:** a "production-like" aggregate built from the real logs minus exactly the two holes. Its public view equals production's
  response in every series, so the simulation is faithful. 58,908 bytes.
- **App:** the real application, a production build (`next start`) with `REDIS_URL` pointed at the scratch Redis.
- **Tools:** the real ones, run exactly as in section 6.

| # | What was run | Result |
|---|---|---|
| 1 | `status` | 696 wallets, 14,326 logs, lock free, no expiry |
| 2 | `snapshot`; then again | Written, SHA-256 equal to the stored value; the second run refused to overwrite |
| 3 | Dry run from the snapshot, with the RPC re-read | `READY TO APPLY`, all 11 gates `PASS`; exactly 1 of 246 candidate runs fits hole 1 |
| 4 | Verification **before** the apply (strict) | **Failed as it must**, naming `2026-09-25 245 vs 441`, `2026-10-06 missing vs 8`, six weeks, funnel |
| 5 | `apply` with no `--confirm-host`; with the wrong one | Refused before anything else |
| 5c | `apply` with a replacement changed by one byte | Refused offline, three findings (checksum, not the exact merge, `totalLogs` off by one) |
| 6 | `apply` (settle shortened to 5 s) | `APPLIED`; hash equals the dry run's; read back identical; expiry kept; lock released; `updatedAt` and checkpoint untouched |
| 7 | `status`, `check` | 707 / 14,530 / 4,121 / 3,192 / 693 / 78 / 730; `check` OK |
| 8 | Verification **after** (strict, real browser) | All checks passed; `/stats` and `/analytics` showed 707, 4,121, 3,192, 730, no error panels |
| 9 | The old snapshot written back over the corrected state (an overwrite) | `check` **failed**, naming the counters that fell; the verifier failed on the repaired days and weeks |
| 10 | `apply` again with the same files | `APPLIED` (idempotent recovery) |
| 11 | `rollback` | Stored bytes equal the snapshot again (same SHA-256) |
| 12 | `apply` holding the lock for 25 s; the real app asked for `/api/stats` three times meanwhile (it wanted to refresh) | Served the stored value, `scan: null`, stored bytes unchanged: it neither scanned nor saved |
| 13 | After the lock was released | The real app refreshed **on top of the corrected state**: 707 wallets kept, checkpoint 82,177,767 to 82,178,089, `scan: {chunks: 1, caughtUp: true}` |
| 14 | `check` and verification (default) after that | Both passed; strict mode correctly failed (the checkpoint had moved on) |
| 15 | The old apply files, re-run after the app had moved the state on (this was refused by the first version of `apply`; see Appendix C) | Now accepted when the value is the snapshot plus later scans (row 18) |
| 16 | `rollback` from a value the app had refreshed (replacement plus later scans) | `ROLLED BACK`; stored bytes equal the snapshot again |
| 17 | The real app refreshed the snapshot state (checkpoint 82,177,767 to 82,178,994), so it no longer equalled the snapshot | Stored value differs from the snapshot, totals unchanged (696) |
| 18 | `apply` with the **old** dry-run files against that moved-on value | `APPLIED (the stored value had moved on ...)`; 707 / 14,530 / 4,121 / 3,192 / 693 / 78 / 730; the app's later checkpoint 82,178,994 kept; `check` OK; default-mode verification all passed |
| 19 | `apply` a second time with the same files | `REFUSED (state_changed)`: `dailyEvents 2026-09-25: 245 became 441`, `2026-10-06: 0 became 8`, ...; totals stayed 707; nothing changed |
| 20 | `rollback`, then `apply` immediately (no refresh in between), with the final code | The original fast path: `APPLIED`, not rebased; the after-hash equals `inputs.replacement.sha256` in the report; checkpoint untouched; `check` OK |

**Which version of the tool.** Rows 1 to 15 ran before `apply` and `rollback` were changed to decide under the lock from the value actually stored (Appendix C). Rows 16 to 20
were run with the final code, and rows 16 and 20 re-exercise rollback, the lock, the settle wait and the swap. The unit tests and the scratch-Redis tests (106 across
the three affected files) cover every path in both versions. The offline file checks (rows 5 and 5c) and the endpoint verifier (rows 4, 8, 9, 14) are unchanged code.

**Not tested, and why it matters.**

- **The production Redis provider.** TLS, ACLs, connection limits, and `WATCH`/`MULTI`/`KEEPTTL` behaviour on that provider were not
  exercised. `status` is read-only and a good first check; a refused `apply` changes nothing.
- **Vercel's 60-second function limit and the cron.** The 75-second wait is derived from `maxDuration = 60` in the code, not
  measured. The cron schedule is read from `vercel.json`, not observed.
- **The CDN.** There is none in the rehearsal, so the 6-minute lag is from the response headers, not observed.
- **Real traffic.** The app was asked for `/api/stats` by hand, not under load.
- **Hole 2's cause.** Unknown (section 2.3).

## 12. If something does not match

| Observation | Meaning | Do |
|---|---|---|
| A third shortfall day appears, or the holes differ from section 2.1 | A new miss, or the data changed | Stop. Re-run step 1 and read the report; the tool handles several holes but each needs the gates |
| `no-extras` fails (the stored series has **more** than a complete scan) | Not a hole: double counting or a different problem | Stop. Do not merge. Investigate |
| `contiguous` or `explains-everything` fails | The shortfall is not a set of contiguous runs the logs explain | Stop. Do not guess |
| `log-source-complete` fails | The log list does not reach the checkpoint, or an RPC chunk failed | Re-run; if it persists the RPC is unhealthy |
| `rpc-confirms-gap` fails (RPC and Blockscout disagree about a hole) | One source is incomplete exactly where the stakes are | Stop. Decide which is right from a third source (`count-users.mjs`) |
| `rewards-preserved` fails | A hole contains a reward, or the totals moved | Stop. The requirement is that rewards do not change |
| The gap is inside the per-day detail period (`gap_in_detail_coverage`) | A merge cannot repair the per-day active counts | Stop. This needs a different procedure |
| `status` says the season XP tally is PRESENT | A gap inside the tally is refused; both holes lie before 2026-11-04, so they should be before it | Check the tally's `sinceBlock` is above 79,400,437; the dry run refuses otherwise |

Only the operator can tell whether production has a `seasonTally`: `status` prints it (`season XP tally PRESENT` or `absent`). The merge
refuses a gap that overlaps one, and merges a gap before it without touching the tally.

## 13. Outstanding operator steps and approvals

Everything below is **NOT DONE**. Nothing has been applied to production, and no production credential was requested or used.

| # | Step | Who | Status |
|---|---|---|---|
| A1 | Approve this procedure and the merge approach (section 3) | approver | NOT DONE |
| A2 | Choose the window (away from 00/06/12/18 UTC) and who is on hand | approver, operator | NOT DONE |
| O1 | Re-run step 1 on the day and confirm it matches section 2 | anyone | NOT DONE (run once on 2026-11-07 for this document) |
| O2 | Obtain `REDIS_URL` for production through the team's secure store; set it with `read -rs` | operator | NOT DONE |
| O3 | Step 2: `status` and `snapshot`; keep the snapshot | operator | NOT DONE |
| O4 | Step 3: dry run from the snapshot; reviewer ticks the checklist | anyone, reviewer | NOT DONE |
| A3 | Approve applying this exact `report.json` (record its `inputs.gapLogs.sha256`: the 204 logs to be merged) | approver | NOT DONE |
| O5 | Step 5: apply | operator | NOT DONE |
| O6 | Step 6: `check`, and endpoint verification with a real browser | operator (`check`), anyone (verification) | NOT DONE |
| O7 | Step 7: checks at +10 min, after the next cron tick, and +24 h | operator, anyone | NOT DONE |
| O8 | Archive the snapshot after a week of clean checks | operator | NOT DONE |

Sign-off (to be completed by people, not by this document):

| Role | Name | Date | Approved `report.json`: `inputs.gapLogs.sha256` (what is merged) |
|---|---|---|---|
| Reviewer | | | |
| Approver | | | |
| Operator | | | |

## 14. Open questions and follow-ups

1. **Approve the 75-second wait?** It blocks refreshes for about 90 seconds in total. The pages keep serving the stored numbers.
2. **Ship the atomic-save hardening first or after?** Section 7. It is optional for this reseed.
3. **Hole 2's cause.** A scan chunk whose every read came back empty is the leading guess, but it is not established, and there
   is no log of it. A cheap recurring check would catch the next one early: the public-mode dry run
   (`reseed-dry-run.ts` without `--snapshot`) is read-only and reports any shortfall; run it weekly.
4. **Update `scripts/analytics/seed-stats.mjs`'s header** to point at this runbook, so nobody reseeds with `--replace` and loses
   the per-day detail.

## Appendix A. The gates

| Gate | Stops |
|---|---|
| The input's checkpoint and detail start are the ones used to build the comparison | A comparison made at the wrong block |
| The log list covers every block up to the checkpoint | A Blockscout lag or a failed RPC chunk silently hiding logs |
| A shortfall exists | Nothing to do is reported as such |
| The stored series never has more than a complete scan | Double counting mistaken for a hole |
| The shortfall is one or more contiguous runs, each a separate hole | A shape no set of runs explains |
| The runs reproduce a complete scan exactly (every public series and every aggregate field) | A wrong or incomplete explanation |
| Rewards paid and G$ paid are unchanged | Any change to either |
| Only what the gap explains changed (checkpoint, timestamp, detail, feed, tally, every other wallet untouched) | Collateral changes |
| The app's own loader accepts the replacement | A value the app would answer `503` for |
| The replacement totals equal the expected totals | A wrong independent total |
| The gap's logs, re-read from RPC, are identical to Blockscout's | One source being incomplete where it matters |

## Appendix B. Files

| File | Purpose |
|---|---|
| `frontend/src/lib/stats/reseed.ts` | Merge, diff, locate the gaps, compare totals, parse a snapshot, prove "snapshot plus later scans only" (pure) |
| `frontend/src/lib/stats/reseedPlan.ts` | The dry run as one function, re-verification of its output, and what `apply` and `rollback` decide from the stored value (pure) |
| `frontend/src/lib/stats/reseedVerify.ts` | Checks of a live `/api/stats` response (pure) |
| `frontend/src/lib/stats/reseedStore.ts` | The only Redis-touching module: snapshot facts, lock, compare-and-swap, `isDescendant` |
| `frontend/src/lib/stats/reseedHash.ts` | Checksums (Node only) |
| `frontend/src/lib/stats/reseedTestWorld.ts` | The synthetic history the tests share |
| `frontend/src/lib/stats/rpcLogs.ts` | Union-of-repeats RPC reader |
| `scripts/analytics/lib/blockscout-logs.mjs` | Segmented, rate-limit-aware, resumable Blockscout reader |
| `scripts/analytics/reseed-dry-run.ts` | The dry run |
| `scripts/analytics/reseed-stats.ts` | The operator tool: `status`, `snapshot`, `apply`, `rollback`, `check` |
| `scripts/analytics/verify-live-stats.ts` | Endpoint verification |
| `scripts/analytics/reseed-expected.2026-11-07.json` | The expected totals |

Tests: `reseed.test.ts`, `reseedPlan.test.ts`, `reseedVerify.test.ts`, `rpcLogs.test.ts`, `blockscoutLogs.test.ts`,
`reseedDryRun.test.ts` run everywhere. `reseedStore.test.ts` also runs against a scratch Redis when `REDIS_TEST_URL` is set
(`redis-server --port 6391 --save "" --appendonly no`), using key names of its own, and is skipped otherwise.

## Appendix C. Review record

- Every claim about the app (`store.ts`, `refresh.ts`, both routes, `vercel.json`, `config.ts`, `state.ts`) was read at source.
- Only the **core safety checks** were mutation-tested (deliberately broken, and the tests had to fail): the merge (`mergeGapLogs`), the dry-run gates (`planReseed`),
  the apply-input verification (`verifyApplyInputs`), the later-scans proof (`verifyLaterScansOnly`), the apply and rollback resolvers (`applyResolver`,
  `rollbackResolver`), and the Redis swap and lock (`guardedSwap`, `swapIfUnchanged`, `releaseLockIfOwner`). Of 33 deliberate breakages (22 in the first round, 11 more after
  the design change), 29 were caught at once; the other 4 exposed missing assertions, which were added and then caught. **The endpoint verifier (`reseedVerify.ts`,
  `verify-live-stats.ts`), the RPC reader (`rpcLogs.ts`) and the Blockscout collector (`blockscout-logs.mjs`) were not mutation-tested**, and nothing outside the list
  above was; that code is covered by ordinary tests and the rehearsal only.
- Reading this procedure against how production really behaves found **one design flaw**, after the first rehearsal had passed: `apply` required the stored value to be
  byte-identical to the snapshot, but the app rewrites it on every refresh, so it would routinely have refused (safely, but impractically, and "redo the steps" invites
  mistakes). The rehearsal had disabled the app's refresh for most steps, which hid it. `apply` now decides under the lock from the value actually stored (section 6, step 5).
- The tests and the rehearsal found **three real bugs in the tooling itself**, all fixed before this document: a collector that
  dropped a whole span when resuming after a failed first request; an apply check that would have wrongly refused a valid
  replacement (it explained the change with a gap summary that did not know which wallets already existed); and a dry-run option
  that silently skipped the RPC cross-check after a field was renamed (caught because the report said `SKIPPED`).
- The real data found **one design limitation**: the planner first assumed a single hole, and stopped (correctly) when it met two. It now
  finds any number of separate holes, with a test for the production shape (a part-day hole and a whole-day hole).
- Please look hard at: `guardedSwap` in `reseedStore.ts`; `applyResolver` and `verifyApplyInputs` in `reseedPlan.ts`; `verifyLaterScansOnly` in `reseed.ts`; the `gap_in_detail_coverage`
  guard in `mergeGapLogs` (day granularity, not block).
