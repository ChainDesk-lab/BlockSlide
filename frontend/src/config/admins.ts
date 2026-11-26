/**
 * BlockSlide admins: the only wallets that can open the admin pages (referral payment review).
 *
 * On the live site the admins are exactly the wallets listed here; adding or removing one is a
 * code change. Outside production, NEXT_PUBLIC_ADMIN_WALLETS (comma-separated) can add test wallets.
 * Wallet addresses are public, so this list is not a secret: the server still makes an admin prove
 * the wallet is theirs with a signature (lib/adminSession.ts) before showing or changing anything.
 */
const OWNER_WALLETS = [
  "0x6816E23A509A0c8ba9C5877Ca5209574e7e5e112",
  "0xcb6f72152DB12546b21ef0dD5F614Ca532531838",
];

const fromEnv = process.env.NODE_ENV !== "production"
  ? (process.env.NEXT_PUBLIC_ADMIN_WALLETS || "").split(",").map((a) => a.trim()).filter(Boolean)
  : [];

export const ADMIN_WALLETS: readonly string[] = [...new Set([...OWNER_WALLETS, ...fromEnv]
  .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
  .map((a) => a.toLowerCase()))];

export function isAdminWallet(address: string | null | undefined): boolean {
  return !!address && ADMIN_WALLETS.includes(address.toLowerCase());
}
