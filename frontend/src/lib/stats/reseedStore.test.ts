/**
 * The Redis side of a reseed. The pure parts run everywhere. The rest runs against a SCRATCH Redis
 * only when REDIS_TEST_URL is set (and is skipped otherwise, so CI needs no Redis), using key names
 * of its own, never the app's. Example:
 *   redis-server --port 6391 --save "" --appendonly no &
 *   REDIS_TEST_URL=redis://127.0.0.1:6391/0 npx vitest run src/lib/stats/reseedStore.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  connect, describeTarget, digest, extendLock, guardedSwap, ownsLock, readFacts, releaseLockIfOwner, swapIfUnchanged, takeLock,
  type Keys, type Redis,
} from "./reseedStore";
import { buildState, isDescendant } from "./reseed";
import { CP, D, FIXED_AT, world } from "./reseedTestWorld";

describe("describeTarget", () => {
  it("never includes credentials, and knows what is local", () => {
    const t = describeTarget("rediss://default:s3cret-password@redis-1234.example.com:6380/2");
    expect(t).toEqual({ host: "redis-1234.example.com", port: "6380", db: "2", tls: true, local: false });
    expect(JSON.stringify(t)).not.toContain("s3cret");
    expect(describeTarget("redis://127.0.0.1:6391").local).toBe(true);
    expect(describeTarget("redis://[::1]:6391/0").local).toBe(true);
  });
});

describe("isDescendant", () => {
  const { gap, stored, complete } = world();
  it("accepts the replacement itself and the replacement plus later scans", () => {
    expect(isDescendant(complete, complete)).toEqual([]);
    const later = buildState([...world().all, { blockNumber: CP + 10, logIndex: 0, topics: [], data: "0x" }], { checkpointBlock: CP + 20, detailSinceBlock: D, updatedAt: FIXED_AT });
    expect(isDescendant(complete, later)).toEqual([]);
  });
  it("notices the old snapshot written back over the corrected state", () => {
    const problems = isDescendant(complete, stored);
    expect(problems.join("\n")).toMatch(/totalLogs went down/);
    expect(problems.join("\n")).toMatch(/dailyEvents 2026-09-23 went down/);
    expect(problems.join("\n")).toMatch(/wallet 0x[0-9a-f]+ is missing/);
    expect(gap.length).toBeGreaterThan(0);
  });
  it("notices the checkpoint going backwards", () => {
    expect(isDescendant(complete, { ...structuredClone(complete), checkpointBlock: complete.checkpointBlock - 1 })[0]).toMatch(/checkpoint went back/);
  });
});

const URL_ = process.env.REDIS_TEST_URL;
const KEYS: Keys = { state: "reseed-test:state", lock: "reseed-test:lock" };

describe.skipIf(!URL_)("against a scratch Redis", () => {
  let c: Redis, other: Redis;
  const OLD = JSON.stringify(world().stored), NEW = JSON.stringify(world().complete);
  const quick = { settleSeconds: 2, pollSeconds: 1, lockWaitSeconds: 2, keys: KEYS };
  const fastSleep = async () => {};

  beforeAll(async () => {
    if (!describeTarget(URL_!).local) throw new Error("REDIS_TEST_URL must point at this machine");
    c = await connect(URL_!); other = await connect(URL_!);
  });
  afterAll(async () => { await c?.quit(); await other?.quit(); });
  beforeEach(async () => { await c.del([KEYS.state, KEYS.lock]); await c.set(KEYS.state, OLD); });

  it("reports what is stored, without changing anything", async () => {
    const { facts, raw } = await readFacts(c, KEYS);
    expect(raw).toBe(OLD);
    expect(facts).toMatchObject({ present: true, bytes: OLD.length, sha256: digest("sha256", OLD), type: "string", ttlSeconds: -1, lock: { held: false } });
    expect(facts.checkpointBlock).toBe(CP);
  });

  describe("swapIfUnchanged", () => {
    it("swaps when the value is exactly the expected one, and keeps an expiry", async () => {
      await c.set(KEYS.state, OLD, { EX: 1000 });
      expect(await swapIfUnchanged(c, OLD, NEW, KEYS)).toEqual({ status: "swapped" });
      expect(await c.get(KEYS.state)).toBe(NEW);
      expect(await c.ttl(KEYS.state)).toBeGreaterThan(900);
    });
    it("leaves the key alone when the value is not the expected one", async () => {
      const r = await swapIfUnchanged(c, "something else", NEW, KEYS);
      expect(r.status).toBe("conflict");
      expect(await c.get(KEYS.state)).toBe(OLD);
    });
    it("Redis aborts the swap if anything writes the key between the check and the transaction", async () => {
      const r = await swapIfUnchanged(c, OLD, NEW, KEYS, async () => { await other.set(KEYS.state, "a refresh saved this"); });
      expect(r.status).toBe("conflict");
      expect(await c.get(KEYS.state)).toBe("a refresh saved this");
    });
  });

  describe("the lock", () => {
    it("is exclusive, and only its owner can release it", async () => {
      expect(await takeLock(c, "mine", 60, KEYS)).toBe(true);
      expect(await takeLock(other, "yours", 60, KEYS)).toBe(false);
      expect(await releaseLockIfOwner(other, "yours", KEYS)).toBe(false);
      expect(await ownsLock(c, "mine", KEYS)).toBe(true);
      await extendLock(c, "mine", 120, KEYS);
      expect(await c.ttl(KEYS.lock)).toBeGreaterThan(60);
      expect(await releaseLockIfOwner(c, "mine", KEYS)).toBe(true);
      expect(await c.get(KEYS.lock)).toBeNull();
    });
  });

  describe("guardedSwap (apply and rollback)", () => {
    it("applies the replacement and releases its lock", async () => {
      const logs: string[] = [];
      const r = await guardedSwap(c, { expectedRaw: OLD, newRaw: NEW, lockToken: "t1", sleep: fastSleep, log: (m) => logs.push(m), ...quick });
      expect(r).toEqual({ status: "done", beforeSha256: digest("sha256", OLD), afterSha256: digest("sha256", NEW), rebased: false });
      expect(await c.get(KEYS.state)).toBe(NEW);
      expect(await c.get(KEYS.lock)).toBeNull();
      expect(logs.join("\n")).toMatch(/took the refresh lock/);
    });

    it("rolls back to the snapshot the same way", async () => {
      await c.set(KEYS.state, NEW);
      const r = await guardedSwap(c, { expectedRaw: NEW, newRaw: OLD, lockToken: "t1", sleep: fastSleep, ...quick });
      expect(r.status).toBe("done");
      expect(await c.get(KEYS.state)).toBe(OLD);
    });

    it("refuses, before taking the lock, when the stored value is not the snapshot", async () => {
      await c.set(KEYS.state, "the app moved on");
      const logs: string[] = [];
      const r = await guardedSwap(c, { expectedRaw: OLD, newRaw: NEW, lockToken: "t1", sleep: fastSleep, log: (m) => logs.push(m), ...quick });
      expect(r).toMatchObject({ status: "refused", reason: "state_changed" });
      expect(await c.get(KEYS.state)).toBe("the app moved on");
      expect(await c.get(KEYS.lock)).toBeNull();
      expect(logs).toEqual([]); // it never took the lock or waited out the settle period for nothing
    });

    it("refuses when the key does not exist", async () => {
      await c.del(KEYS.state);
      expect(await guardedSwap(c, { expectedRaw: OLD, newRaw: NEW, lockToken: "t1", sleep: fastSleep, ...quick })).toMatchObject({ status: "refused", reason: "missing" });
    });

    it("waits for a refresh that holds the lock, then gives up without touching anything", async () => {
      await other.set(KEYS.lock, "a-refresh", { EX: 60 });
      const r = await guardedSwap(c, { expectedRaw: OLD, newRaw: NEW, lockToken: "t1", sleep: fastSleep, ...quick });
      expect(r).toMatchObject({ status: "refused", reason: "lock_unavailable" });
      expect(await c.get(KEYS.state)).toBe(OLD);
      expect(await c.get(KEYS.lock)).toBe("a-refresh"); // not ours, not removed
    });

    it("carries on when an earlier, slow refresh deletes our lock as it ends (the app's release is an unconditional DEL)", async () => {
      let n = 0;
      const r = await guardedSwap(c, { expectedRaw: OLD, newRaw: NEW, lockToken: "t1", log: () => {}, ...quick, sleep: async () => { if (++n === 1) await other.del(KEYS.lock); } });
      expect(r.status).toBe("done");
      expect(await c.get(KEYS.state)).toBe(NEW);
    });

    it("stops, changing nothing, if someone else takes the lock while we wait", async () => {
      let n = 0;
      const r = await guardedSwap(c, { expectedRaw: OLD, newRaw: NEW, lockToken: "t1", ...quick, sleep: async () => { if (++n === 1) await other.set(KEYS.lock, "someone-else"); } });
      expect(r).toMatchObject({ status: "refused", reason: "lock_lost" });
      expect(await c.get(KEYS.state)).toBe(OLD);
      expect(await c.get(KEYS.lock)).toBe("someone-else"); // and we did not delete theirs
    });

    it("stops if a refresh saves while we wait: its value is kept, not overwritten", async () => {
      let n = 0;
      const r = await guardedSwap(c, { expectedRaw: OLD, newRaw: NEW, lockToken: "t1", ...quick, sleep: async () => { if (++n === 1) await other.set(KEYS.state, "a slow refresh saved this"); } });
      expect(r).toMatchObject({ status: "refused", reason: "state_changed" });
      expect(await c.get(KEYS.state)).toBe("a slow refresh saved this");
    });

    describe("with a resolver: deciding from the value actually stored", () => {
      const plus = (cur: string) => ({ newRaw: cur + "+gap" });

      it("when the stored value is the baseline, it is not reported as rebased", async () => {
        const r = await guardedSwap(c, { baseline: OLD, resolve: plus, lockToken: "t1", sleep: fastSleep, ...quick });
        expect(r).toMatchObject({ status: "done", rebased: false });
        expect(await c.get(KEYS.state)).toBe(OLD + "+gap");
      });

      it("when the app has refreshed since the snapshot, it decides from what is stored now and says so", async () => {
        await c.set(KEYS.state, "app refreshed once");
        const logs: string[] = [];
        const r = await guardedSwap(c, { baseline: OLD, resolve: plus, lockToken: "t1", sleep: fastSleep, log: (m) => logs.push(m), ...quick });
        expect(r).toMatchObject({ status: "done", rebased: true, beforeSha256: digest("sha256", "app refreshed once") });
        expect(await c.get(KEYS.state)).toBe("app refreshed once+gap");
        expect(logs.join("\n")).toMatch(/moved on since the snapshot/);
      });

      it("if it changes AGAIN while waiting, the decision is made from the value read just before the swap", async () => {
        const seen: string[] = [];
        let n = 0;
        const r = await guardedSwap(c, {
          baseline: OLD, lockToken: "t1", ...quick,
          resolve: (cur) => { seen.push(cur); return plus(cur); },
          sleep: async () => { if (++n === 1) await other.set(KEYS.state, "a slow refresh saved this"); },
        });
        expect(r.status).toBe("done");
        expect(seen[0]).toBe(OLD);
        expect(seen[seen.length - 1]).toBe("a slow refresh saved this");
        expect(await c.get(KEYS.state)).toBe("a slow refresh saved this+gap");
      });

      it("refuses without changing anything when the resolver refuses, early (no lock taken)", async () => {
        const logs: string[] = [];
        const r = await guardedSwap(c, { baseline: OLD, resolve: () => ({ refuse: "not the snapshot plus later scans" }), lockToken: "t1", sleep: fastSleep, log: (m) => logs.push(m), ...quick });
        expect(r).toMatchObject({ status: "refused", reason: "state_changed" });
        expect(await c.get(KEYS.state)).toBe(OLD);
        expect(logs).toEqual([]);
      });

      it("refuses without changing anything when the value becomes unacceptable while waiting, and releases its lock", async () => {
        let n = 0;
        const r = await guardedSwap(c, {
          baseline: OLD, lockToken: "t1", ...quick,
          resolve: (cur) => (cur === OLD ? plus(cur) : { refuse: "history was rewritten" }),
          sleep: async () => { if (++n === 1) await other.set(KEYS.state, "rewritten"); },
        });
        expect(r).toMatchObject({ status: "refused", reason: "state_changed" });
        expect((r as { detail: string }).detail).toMatch(/history was rewritten/);
        expect(await c.get(KEYS.state)).toBe("rewritten");
        expect(await c.get(KEYS.lock)).toBeNull();
      });
    });

    it("a refresh that read the OLD value cannot overwrite the corrected one afterwards (the app's own GET-compare-SET)", async () => {
      expect((await guardedSwap(c, { expectedRaw: OLD, newRaw: NEW, lockToken: "t1", sleep: fastSleep, ...quick })).status).toBe("done");
      // What store.saveState does: GET, compare with what it loaded, SET only if equal.
      const appSave = async (expectedRaw: string, next: string) => {
        if ((await other.get(KEYS.state)) !== expectedRaw) return "conflict";
        await other.set(KEYS.state, next);
        return "saved";
      };
      expect(await appSave(OLD, "old state plus new scans")).toBe("conflict");
      expect(await c.get(KEYS.state)).toBe(NEW);
    });
  });
});
