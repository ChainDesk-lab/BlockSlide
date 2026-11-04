/**
 * Getting a wallet enough CELO for the transaction it is about to send.
 *
 * 1. Check the balance against the transaction's real requirement
 *    (`requiredWei`: gas limit × fee cap, from lib/gasPlan.ts). Without one,
 *    /api/gas-faucet uses its default budget at live fees.
 * 2. If short, ask the GoodDollar faucet (triggerFaucet from
 *    @goodsdks/citizen-sdk), then poll the balance every 2 s for up to 30 s.
 *    The faucet's API path returns before the CELO lands, so a single early
 *    check reports failure for wallets funded moments later — likely the
 *    August "stuck at top up gas" reports.
 * 3. The wallet is marked as having used the faucet (Redis, /api/gas/tier1)
 *    once CELO actually arrived — even if it wasn't enough for this
 *    transaction, because the faucet did pay out. If nothing arrived, the
 *    wallet keeps its turn.
 * 4. Otherwise the caller opens the manual (Telegram) top-up modal.
 *
 * All I/O is injected so the flow is testable without a wallet or network.
 */
import { formatCelo } from "./gasPlan";

/** Player-facing status while the faucet top-up is in flight. */
export const GAS_TOP_UP_PROGRESS = "Getting you some gas, this takes a few seconds...";

/** Player-facing error when the faucet couldn't cover them and the modal opens. */
export const GAS_MANUAL_NEEDED = "You need a little CELO for gas. Follow the steps to top up, then try again.";

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 30_000;

export interface GasStatus {
  balance: bigint;
  /** The requirement the server compared against. */
  requiredWei: bigint;
  sufficient: boolean;
}

export interface GasTopUpResult {
  ok: boolean;
  /** Player-facing message when not ok */
  error: string | null;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Balance vs requirement from /api/gas-faucet. null when the check itself
 * failed — never read as "not enough gas".
 */
export async function fetchGasStatus(
  address: string,
  requiredWei?: bigint,
  fetchFn: FetchFn = fetch,
): Promise<GasStatus | null> {
  try {
    const qs = new URLSearchParams({ address });
    if (requiredWei !== undefined) qs.set("minWei", requiredWei.toString());
    const res = await fetchFn(`/api/gas-faucet?${qs.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { balance?: string; requiredWei?: string; balanceSufficient?: boolean };
    if (typeof data.balance !== "string" || typeof data.balanceSufficient !== "boolean") return null;
    return {
      balance: BigInt(data.balance),
      requiredWei: data.requiredWei ? BigInt(data.requiredWei) : (requiredWei ?? 0n),
      sufficient: data.balanceSufficient,
    };
  } catch {
    return null;
  }
}

export interface GasTopUpDeps {
  fetchFn?: FetchFn;
  /** null when the wallet/public client isn't ready, so the faucet can't run. */
  triggerFaucet: (() => Promise<string>) | null;
  canUseFaucet: () => Promise<boolean>;
  markFaucetUsed: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function runGasTopUp(args: {
  address: string;
  requiredWei?: bigint;
  onProgress?: (message: string) => void;
  deps: GasTopUpDeps;
}): Promise<GasTopUpResult> {
  const { address, requiredWei, onProgress, deps } = args;
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  const before = await fetchGasStatus(address, requiredWei, fetchFn);
  if (!before) {
    return { ok: false, error: "Could not verify wallet balance. Please check your connection and try again." };
  }
  if (before.sufficient) return { ok: true, error: null };

  let canUse = true;
  try {
    canUse = await deps.canUseFaucet();
  } catch {
    /* fail open: GoodDollar enforces its own limits */
  }
  if (!canUse || !deps.triggerFaucet) return { ok: false, error: GAS_MANUAL_NEEDED };

  onProgress?.(GAS_TOP_UP_PROGRESS);
  let result = "error";
  try {
    result = await deps.triggerFaucet();
  } catch (e) {
    console.warn("[Gas] Faucet error", e);
  }
  if (result !== "topped_via_contract" && result !== "topped_via_api") {
    // "skipped": GoodDollar won't top this wallet (canTop false) or the SDK's
    // own 1 h client-side throttle. "error": contract and API both failed.
    console.warn(`[Gas] Faucet did not top up: ${result}`);
    return { ok: false, error: GAS_MANUAL_NEEDED };
  }

  // Poll until the balance covers this transaction, not just until any CELO lands.
  let latest: GasStatus | null = before;
  const deadline = now() + POLL_TIMEOUT_MS;
  while (now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    latest = (await fetchGasStatus(address, requiredWei, fetchFn)) ?? latest;
    if (latest?.sufficient) break;
  }

  const arrived = !!latest && latest.balance > before.balance;
  if (arrived) {
    try {
      await deps.markFaucetUsed();
    } catch (e) {
      console.warn("[Gas] Could not mark faucet as used server-side:", e);
    }
  }
  if (latest?.sufficient) return { ok: true, error: null };

  if (arrived && latest) {
    return {
      ok: false,
      error: `The faucet added some CELO, but this transaction needs up to ${formatCelo(latest.requiredWei)} CELO and your wallet has ${formatCelo(latest.balance)}. ${GAS_MANUAL_NEEDED}`,
    };
  }
  console.warn(`[Gas] Faucet accepted but no CELO after ${POLL_TIMEOUT_MS / 1000}s`);
  return { ok: false, error: GAS_MANUAL_NEEDED };
}

/**
 * After the player taps "I've topped up": null to close the modal, or the
 * message to show instead. A failed check closes rather than trapping them.
 */
export function topUpConfirmMessage(status: GasStatus | null): string | null {
  if (!status || status.sufficient) return null;
  if (status.balance === 0n) {
    return "No CELO has arrived yet. It can take a minute after someone sends it, so try again shortly.";
  }
  return `Your wallet has ${formatCelo(status.balance)} CELO; this needs up to ${formatCelo(status.requiredWei)}. Top up a little more, then try again.`;
}
