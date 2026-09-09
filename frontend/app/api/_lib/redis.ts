import { createClient } from "redis";

/**
 * Shared Redis accessor for the API routes.
 *
 * Guarantees the caller is never blocked:
 *  - if REDIS_URL is unset, returns null immediately (no socket attempt);
 *  - if the server is unreachable, fails fast (short connect timeout, only a
 *    couple of reconnect attempts) and returns null;
 *  - concurrent callers during a cold start share one connect attempt.
 *
 * Every route treats a null client as "cache/registry unavailable" and still
 * serves a correct (subgraph-only) response.
 */

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connecting: Promise<RedisClient | null> | null = null;

export async function getRedis(): Promise<RedisClient | null> {
  if (client?.isOpen) return client;
  if (!process.env.REDIS_URL) return null;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const c = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 3000,
          // Applies to the initial connect too: give up after 2 retries so a
          // bad URL rejects in a few seconds instead of hanging the request.
          reconnectStrategy: (retries) =>
            retries > 2 ? false : Math.min(retries * 200, 800),
        },
      });
      c.on("error", (e: Error) =>
        console.error("[Redis] client error:", e.message)
      );
      await c.connect();
      client = c;
      return client;
    } catch (e) {
      console.error(
        "[Redis] connect failed:",
        e instanceof Error ? e.message : String(e)
      );
      client = null;
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}
