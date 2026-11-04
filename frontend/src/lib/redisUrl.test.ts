/**
 * Local development can only ever reach a Redis on this machine; production and tests are unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allowedRedisUrl, isLocalRedisUrl, requireAllowedRedisUrl } from "./redisUrl";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

describe("Redis URL guard", () => {
  it("recognises only this machine as local", () => {
    for (const u of ["redis://127.0.0.1:6390/1", "redis://localhost:6379", "redis://[::1]:6390", "rediss://localhost:6390"]) expect(isLocalRedisUrl(u), u).toBe(true);
    for (const u of ["redis://default:pw@redis-12345.cloud.redislabs.com:12345", "rediss://x.upstash.io:6379", "redis://10.0.0.5:6379", "redis://127.0.0.1.evil.com:6379", "http://localhost:6379", "not a url"]) expect(isLocalRedisUrl(u), u).toBe(false);
  });

  it("under next dev, a remote (production) REDIS_URL is refused; a local one is used", () => {
    expect(allowedRedisUrl({ NODE_ENV: "development", REDIS_URL: "rediss://default:secret@prod.upstash.io:6379" })).toBeNull();
    expect(allowedRedisUrl({ NODE_ENV: "development", REDIS_URL: "redis://127.0.0.1:6390/1" })).toBe("redis://127.0.0.1:6390/1");
    expect(() => requireAllowedRedisUrl({ NODE_ENV: "development", REDIS_URL: "rediss://prod.upstash.io:6379" })).toThrow();
  });

  it("production and tests keep using REDIS_URL as before", () => {
    expect(allowedRedisUrl({ NODE_ENV: "production", REDIS_URL: "rediss://prod.upstash.io:6379" })).toBe("rediss://prod.upstash.io:6379");
    expect(allowedRedisUrl({ NODE_ENV: "test", REDIS_URL: "redis://fake" })).toBe("redis://fake");
    expect(allowedRedisUrl({ NODE_ENV: "development" })).toBeNull();
  });

  it("every Redis client in the app goes through the guard", () => {
    const clients: Record<string, string> = {
      "../../app/api/_lib/redis.ts": "allowedRedisUrl()",
      "../../app/api/game/seed/route.ts": "requireAllowedRedisUrl()",
      "./faucet.ts": "requireAllowedRedisUrl()",
      "./stats/store.ts": "allowedRedisUrl()",
    };
    for (const [file, call] of Object.entries(clients)) {
      const src = read(file);
      expect(src, file).toContain(call);
      expect(src, file).not.toMatch(/url:\s*process\.env\.REDIS_URL/);
    }
  });

  it("the seed script refuses to write to a non-local Redis unless told --allow-remote", () => {
    const seed = read("../../../scripts/analytics/seed-stats.mjs");
    expect(seed).toContain('const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);');
    expect(seed).toContain('if (!local && !process.argv.includes("--allow-remote"))');
    expect(seed.indexOf("--allow-remote\"))")).toBeLessThan(seed.indexOf("await client.connect();"));
  });
});
