/**
 * Redis persistence for the stats aggregate. Same lazy-singleton client shape
 * as app/api/game/seed/route.ts so there is one connection per lambda.
 */
import { createClient } from "redis";
import { emptyState, type StatsState, STATE_VERSION } from "./state";

const STATE_KEY = "stats:v1:state";
const LOCK_KEY = "stats:v1:lock";

let client: ReturnType<typeof createClient> | null = null;

async function getClient() {
  if (!process.env.REDIS_URL) return null;
  if (client?.isOpen) return client;
  try {
    client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err: Error) => console.error("[stats] redis error:", err.message));
    await client.connect();
    return client;
  } catch (err) {
    console.error("[stats] redis connect failed:", (err as Error).message);
    client = null;
    return null;
  }
}

export async function loadState(): Promise<StatsState> {
  const c = await getClient();
  if (!c) return emptyState();
  try {
    const raw = await c.get(STATE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as StatsState;
    if (parsed.version !== STATE_VERSION) return emptyState();
    return parsed;
  } catch (err) {
    console.error("[stats] loadState failed:", (err as Error).message);
    return emptyState();
  }
}

export async function saveState(state: StatsState): Promise<boolean> {
  const c = await getClient();
  if (!c) return false;
  try {
    await c.set(STATE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error("[stats] saveState failed:", (err as Error).message);
    return false;
  }
}

/**
 * Best-effort mutex so two concurrent page loads don't both scan and then
 * clobber each other's write. A refresh that loses the race just serves cache.
 */
export async function acquireLock(seconds = 60): Promise<boolean> {
  const c = await getClient();
  if (!c) return true; // no redis: nothing to protect
  try {
    const ok = await c.set(LOCK_KEY, String(Date.now()), { NX: true, EX: seconds });
    return ok === "OK";
  } catch {
    return false;
  }
}

export async function releaseLock(): Promise<void> {
  const c = await getClient();
  if (!c) return;
  try { await c.del(LOCK_KEY); } catch { /* lock expires on its own */ }
}

export const isConfigured = () => Boolean(process.env.REDIS_URL);
