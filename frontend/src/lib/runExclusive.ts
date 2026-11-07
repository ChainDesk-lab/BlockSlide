/**
 * Run `fn` unless a previous call holding the same lock is still running.
 * Returns false (and does nothing) when the lock is held. The lock is released
 * however `fn` ends, including a throw.
 *
 * Used for score submission: its preflight (gas check, seed recovery,
 * simulation) runs before the transaction's own pending state, so a second tap
 * could otherwise start a second submission that would revert on-chain.
 */
export async function runExclusive(
  lock: { current: boolean },
  fn: () => Promise<void>,
  onBusyChange?: (busy: boolean) => void,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  onBusyChange?.(true);
  try {
    await fn();
    return true;
  } finally {
    lock.current = false;
    onBusyChange?.(false);
  }
}
