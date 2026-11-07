/**
 * The Redis URL the app may connect to.
 *
 * Under `next dev` (NODE_ENV "development") only a Redis on this machine is allowed, so a
 * production REDIS_URL pasted into a local env file can never be used by a local server: the
 * app then behaves as if Redis were unset. Production and preview builds (NODE_ENV
 * "production") and tests are unchanged.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalRedisUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "redis:" || u.protocol === "rediss:") && LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** REDIS_URL if this environment may use it, otherwise null (and a one-line warning in dev). */
export function allowedRedisUrl(env: { REDIS_URL?: string; NODE_ENV?: string } = process.env): string | null {
  const url = env.REDIS_URL;
  if (!url) return null;
  if (env.NODE_ENV !== "development" || isLocalRedisUrl(url)) return url;
  if (!warned) {
    warned = true;
    console.error("[redis] Ignoring REDIS_URL: local development may only use a Redis on this machine (localhost).");
  }
  return null;
}
let warned = false;

/** For clients that create inside a try/catch: throws instead of returning null. */
export function requireAllowedRedisUrl(env: { REDIS_URL?: string; NODE_ENV?: string } = process.env): string {
  const url = allowedRedisUrl(env);
  if (!url) throw new Error("REDIS_URL is not set or not allowed in this environment");
  return url;
}
