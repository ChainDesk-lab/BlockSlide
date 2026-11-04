/**
 * Whether Undo Step can be used, and if not, why. Two independent keys must both turn:
 *
 *  1. The operator switch, UNDO_ENABLED (NEXT_PUBLIC_UNDO_ENABLED, off by default): production stays
 *     off until the contract remediation has been independently reviewed and verified.
 *  2. The contract: it must report supportsUndoAtSubmit() == true. Only the upgraded implementation
 *     has it, and that implementation also restricts consumeUndo to the player (the deployed one
 *     lets anyone burn anyone's credits). On the old contract Undo stays unavailable: the app never
 *     calls consumeUndo at all.
 *
 * When available, Undo works like an XP boost: the take-back is instant and local, and the credits
 * used in the game are deducted in the same transaction as the score (submitScoreWithUndos). The
 * contract rejects a claim of more credits than the player holds, and records nothing if it does.
 */
import type { UndoMode } from "./undoHistory";

export type UndoUnavailableReason = "switched-off" | "checking-contract" | "contract-not-upgraded";

export type UndoAvailability =
  | { available: true; reason: null }
  | { available: false; reason: UndoUnavailableReason };

export function undoAvailability(o: { enabled: boolean; mode: UndoMode }): UndoAvailability {
  if (!o.enabled) return { available: false, reason: "switched-off" };
  if (o.mode === "unknown") return { available: false, reason: "checking-contract" };
  if (o.mode !== "at_submit") return { available: false, reason: "contract-not-upgraded" };
  return { available: true, reason: null };
}

/** Player-facing explanation for an unavailable Undo. */
export function undoUnavailableMessage(reason: UndoUnavailableReason): string {
  switch (reason) {
    case "switched-off": return "Undo Step is switched off for now. Credits you already own are kept.";
    case "checking-contract": return "Checking whether Undo Step is available…";
    case "contract-not-upgraded": return "Undo Step is unavailable until the game contract upgrade that secures Undo credits. Credits you already own are kept.";
  }
}

/** Credits the player can still use this game: owned minus already used, never negative; null until the balance is known. */
export function usableUndoCredits(owned: bigint | undefined, usedThisGame: number): bigint | null {
  if (owned === undefined) return null;
  const left = owned - BigInt(usedThisGame);
  return left > 0n ? left : 0n;
}
