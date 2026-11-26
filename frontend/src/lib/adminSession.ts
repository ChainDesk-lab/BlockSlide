/**
 * Admin sessions for the admin pages.
 *
 * An admin (config/admins.ts) signs adminLoginMessage with their wallet once; the server checks the
 * signature and gives back a random session token, valid for SESSION_HOURS. Only a hash of the token
 * is stored (Redis), so the stored value can't be used to sign in. Admin API calls send the token
 * as `Authorization: Bearer <token>`.
 *
 * The owner's export key (REFERRALS_EXPORT_SECRET) is also accepted, for scripts such as the export.
 */
import { createHash, randomBytes } from "crypto";
import { getRedis } from "../../app/api/_lib/redis";
import { isAdminWallet } from "../config/admins";
import { secretMatches } from "./referrals";

export const SESSION_HOURS = 12;
const key = (token: string) => `admin:v1:session:${createHash("sha256").update(token).digest("hex")}`;

type Redis = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

export async function createAdminSession(client: Redis, address: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_HOURS * 3600_000;
  await client.set(key(token), JSON.stringify({ address: address.toLowerCase(), expiresAt }), { EX: SESSION_HOURS * 3600 });
  return { token, expiresAt };
}

export type AdminIdentity = { address: string } | { ownerKey: true };

/**
 * Who is calling, from the Authorization header, or null when it isn't an admin. A session for a
 * wallet that has since been removed from the admin list is refused.
 */
export async function adminFromRequest(client: Redis | null, authorization: string | null): Promise<AdminIdentity | null> {
  const given = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!given) return null;
  if (secretMatches(given, process.env.REFERRALS_EXPORT_SECRET)) return { ownerKey: true };
  if (!client || !/^[0-9a-f]{64}$/.test(given)) return null;
  const raw = await client.get(key(given));
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as { address?: string; expiresAt?: number };
    if (!s.address || !s.expiresAt || s.expiresAt < Date.now() || !isAdminWallet(s.address)) return null;
    return { address: s.address };
  } catch {
    return null;
  }
}

export const adminLabel = (who: AdminIdentity) => ("address" in who ? who.address : "owner key");
