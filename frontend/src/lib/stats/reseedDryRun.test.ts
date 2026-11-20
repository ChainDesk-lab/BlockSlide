/**
 * The dry run's safety promise, checked in the source: it can calculate and report but it has no
 * way to reach Redis, and the only files it writes are under its own output directory.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const CLI = "../../../../scripts/analytics/reseed-dry-run.ts";
const VERIFY_CLI = "../../../../scripts/analytics/verify-live-stats.ts";
const OPERATOR_CLI = "../../../../scripts/analytics/reseed-stats.ts";
const COLLECTOR = "../../../../scripts/analytics/lib/blockscout-logs.mjs";

/** Anything that would open, use or write the stats store. */
const REDIS = /from "redis"|createClient|\.connect\(|getClient|loadState|saveState|acquireLock|releaseLock|process\.env\.REDIS_URL|allowedRedisUrl|\bsetEx?\(|\.del\(|\.eval\(/;

describe("the reseed dry run cannot reach Redis", () => {
  const NO_REDIS: Array<[string, string]> = [
    ["the dry-run CLI", CLI],
    ["the endpoint verification CLI", VERIFY_CLI],
    ["the Blockscout collector", COLLECTOR],
    ["the planner", "./reseedPlan.ts"],
    ["the endpoint checker", "./reseedVerify.ts"],
    ["the RPC reader", "./rpcLogs.ts"],
    ["the checksum helper", "./reseedHash.ts"],
  ];

  it.each(NO_REDIS)("%s has no Redis client, connection or write", (_name, file) => {
    expect(read(file)).not.toMatch(REDIS);
  });

  it.each([...NO_REDIS, ["the merge library", "./reseed.ts"] as [string, string]])("%s never imports the module that touches Redis", (_name, file) => {
    expect(read(file)).not.toMatch(/reseedStore/);
  });

  it("only the operator tool imports the Redis module, and only to snapshot, apply, roll back and check", () => {
    const src = read(OPERATOR_CLI);
    expect(src).toContain('lib/stats/reseedStore"');
    const used = [...src.matchAll(/import \{([^}]*)\} from "\.\.\/\.\.\/frontend\/src\/lib\/stats\/reseedStore"/g)][0][1].split(",").map((x) => x.trim().replace(/^type\s+/, "")).sort();
    expect(used).toEqual(["APP_KEYS", "Redis", "connect", "describeTarget", "guardedSwap", "readFacts"].sort());
    // It never reads the URL from a flag, so it cannot end up in shell history; it is taken from the environment.
    expect(src).not.toMatch(/--redis-url|--url\b/);
    expect(src).toContain("process.env.REDIS_URL");
  });

  it("the merge library takes only the app's value parser from the store module, nothing that connects", () => {
    const src = read("./reseed.ts");
    expect(src.match(/from "\.\/store"/g)).toHaveLength(1);
    expect(src).toContain('import { parseStoredState } from "./store";');
    expect(src).not.toMatch(REDIS);
  });

  it("every file the CLI writes goes under --out-dir", () => {
    const writes = [...read(CLI).matchAll(/writeFileSync\(([^;]*)\)/g)].map((m) => m[1].trim());
    expect(writes.length).toBeGreaterThanOrEqual(3);
    for (const w of writes) expect(w, w).toMatch(/^join\(a\.outDir, /);
  });

  it("the collector writes only its own cache file", () => {
    const writes = [...read(COLLECTOR).matchAll(/(writeFileSync|renameSync)\(([^;]*)\)/g)].map((m) => m[2].trim());
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w, w).toMatch(/^(tmp|cacheFile)/);
  });

  it("the CLI's only network calls are GETs: the public response, Blockscout and RPC reads", () => {
    const src = read(CLI);
    expect(src).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
    expect(read(COLLECTOR)).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
  });
});
