/**
 * Which between-games pop-up to show next, on every device.
 *
 * Unverified players: only "verify", once per visit, until they are verified.
 * Verified players: "vote" first (when the vote reminder is due), then "telegram"
 * (until they have tapped Join, at most once a day).
 */
export type PromptKind = "verify" | "vote" | "telegram";

export interface PromptInputs {
  /** This wallet can submit scores (the contract's whitelist check). */
  verified: boolean;
  /** The verification status is still loading or a scan is in progress: show nothing yet. */
  verificationUnsettled: boolean;
  verifyShownThisVisit: boolean;
  voteDue: boolean;
  telegramDue: boolean;
}

export function nextPrompt(i: PromptInputs): PromptKind | null {
  if (i.verificationUnsettled) return null;
  if (!i.verified) return i.verifyShownThisVisit ? null : "verify";
  if (i.voteDue) return "vote";
  if (i.telegramDue) return "telegram";
  return null;
}

// ── Telegram: per wallet, stored locally ────────────────────────────────────
// We can't see Telegram membership, so tapping "Join" counts as joined.
const tgKey = (address: string) => `blockslide_telegram_${address.toLowerCase()}`;

interface TelegramState { joined?: boolean; lastShownAt?: number; dismissedUntil?: number }

function readTelegram(address: string): TelegramState {
  try {
    const raw = localStorage.getItem(tgKey(address));
    return raw ? (JSON.parse(raw) as TelegramState) : {};
  } catch {
    return {};
  }
}

function writeTelegram(address: string, s: TelegramState) {
  try { localStorage.setItem(tgKey(address), JSON.stringify(s)); } catch { /* ignore */ }
}

export function isTelegramDue(address: string, now = Date.now()): boolean {
  const s = readTelegram(address);
  if (s.joined) return false;
  if (s.dismissedUntil && now < s.dismissedUntil) return false;
  if (s.lastShownAt && new Date(s.lastShownAt).toDateString() === new Date(now).toDateString()) return false;
  return true;
}

export function markTelegramShown(address: string, now = Date.now()) {
  writeTelegram(address, { ...readTelegram(address), lastShownAt: now });
}

export function markTelegramJoined(address: string) {
  writeTelegram(address, { ...readTelegram(address), joined: true });
}

export function dismissTelegramForWeek(address: string, now = Date.now()) {
  writeTelegram(address, { ...readTelegram(address), dismissedUntil: now + 7 * 24 * 60 * 60 * 1000 });
}

/** A game started from either a fresh board ("idle") or after a finished one ("done", Play Again). */
export function isNewGameStart(prev: string, next: string): boolean {
  return (prev === "idle" || prev === "done") && next === "starting";
}
