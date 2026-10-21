/**
 * Gas planning for a specific transaction: how much gas to allow, what fee to
 * offer, and how much CELO the wallet must hold for a node to accept it.
 *
 * Why: the app used to treat 0.001 CELO as "enough gas" and send every
 * transaction with a fixed 500 gwei fee cap and fixed gas limits (200k for
 * startSession, 500k for submitScore). A node only accepts a transaction when
 * the balance covers gasLimit × feeCap — at a 200 gwei base fee that is 0.1 CELO
 * and 0.25 CELO, while real usage is far lower (measured on mainnet, Oct 2026:
 * startSession 39k–73k gas, submitScore 95k–435k gas). Wallets between those
 * numbers passed the app's check and were then rejected for "insufficient
 * funds". A fixed cap also stops working outright if the base fee passes it.
 *
 * Every number here is derived from live chain data at the moment of sending.
 */

/** Headroom added to the estimated gas limit: 20%, but never less than 50k gas. */
export const GAS_LIMIT_BUFFER_PCT = 20n;
/**
 * Minimum absolute headroom. 20% of a small estimate (a 95k submitScore → 19k)
 * is less than one storage slot going from zero to non-zero (~22k), which can
 * happen if the leaderboard changes between estimation and inclusion. Running
 * out of gas still burns the fee, so err on the side of a larger limit.
 */
export const GAS_LIMIT_MIN_HEADROOM = 50_000n;
/**
 * Headroom over the current base fee (EIP-1559) or gas price (legacy). Covers
 * a fee rise between planning and inclusion; a larger rise leaves the
 * transaction pending until fees fall, it is never silently overpaid.
 */
export const FEE_BUFFER_PCT = 20n;
/** Tip used only if the RPC can't suggest one. A tip, not a cap. */
export const FALLBACK_PRIORITY_FEE = 2_500_000_000n; // 2.5 gwei
/**
 * Gas budget used when the caller can't name a transaction (the balance check
 * in /api/gas-faucet): roughly one startSession plus one submitScore at their
 * measured medians (40k + 135k), with room to spare.
 */
export const DEFAULT_GAS_BUDGET = 250_000n;

export type FeePlan =
  | { type: "eip1559"; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { type: "legacy"; gasPrice: bigint };

export interface TxPlan {
  gas: bigint;
  /** false when estimation failed and the caller's fallback limit is used */
  gasEstimated: boolean;
  fees: FeePlan;
  /** Balance a node requires to accept the transaction: gas × fee cap. */
  requiredWei: bigint;
  balance: bigint;
  sufficient: boolean;
}

/** The fee data or balance couldn't be read — an RPC problem, not a lack of gas. */
export class GasPlanRpcError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GasPlanRpcError";
  }
}

/** The subset of a viem public client this module uses. */
export interface GasPlanClient {
  getGasPrice(): Promise<bigint>;
  getBlock(args: { blockTag: "latest" }): Promise<{ baseFeePerGas?: bigint | null }>;
  estimateMaxPriorityFeePerGas(): Promise<bigint>;
  estimateGas(args: { account: `0x${string}`; to: `0x${string}`; data: `0x${string}` }): Promise<bigint>;
  getBalance(args: { address: `0x${string}` }): Promise<bigint>;
}

export function withBuffer(value: bigint, pct: bigint): bigint {
  return value + (value * pct) / 100n;
}

export function feeCap(fees: FeePlan): bigint {
  return fees.type === "legacy" ? fees.gasPrice : fees.maxFeePerGas;
}

export function requiredBalance(gas: bigint, fees: FeePlan): bigint {
  return gas * feeCap(fees);
}

/**
 * Current fees. `legacy` is for wallets that only take a gasPrice (Magic's
 * eth_sendTransaction path); everything else gets EIP-1559 fields.
 */
export async function estimateFees(client: GasPlanClient, legacy: boolean): Promise<FeePlan> {
  try {
    if (legacy) {
      return { type: "legacy", gasPrice: withBuffer(await client.getGasPrice(), FEE_BUFFER_PCT) };
    }
    const [block, gasPrice, priority] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.getGasPrice(),
      client.estimateMaxPriorityFeePerGas().catch(() => FALLBACK_PRIORITY_FEE),
    ]);
    // A load-balanced RPC can answer from a node that is behind; its "latest"
    // block may carry an old, lower base fee. eth_gasPrice is base + tip, so
    // take whichever implies the higher base fee — a cap below the real base
    // fee is rejected outright.
    const fromGasPrice = gasPrice > priority ? gasPrice - priority : gasPrice;
    const blockBase = block.baseFeePerGas ?? fromGasPrice;
    const base = blockBase > fromGasPrice ? blockBase : fromGasPrice;
    return { type: "eip1559", maxFeePerGas: withBuffer(base, FEE_BUFFER_PCT) + priority, maxPriorityFeePerGas: priority };
  } catch (e) {
    throw new GasPlanRpcError("Couldn't read current network fees", e);
  }
}

/** Estimated gas + headroom; the caller's fallback limit if estimation fails. */
export async function estimateGasLimit(
  client: GasPlanClient,
  tx: { account: `0x${string}`; to: `0x${string}`; data: `0x${string}` },
  fallbackGas: bigint,
): Promise<{ gas: bigint; estimated: boolean }> {
  try {
    const estimate = await client.estimateGas(tx);
    const pct = withBuffer(estimate, GAS_LIMIT_BUFFER_PCT);
    const floor = estimate + GAS_LIMIT_MIN_HEADROOM;
    return { gas: pct > floor ? pct : floor, estimated: true };
  } catch {
    return { gas: fallbackGas, estimated: false };
  }
}

export async function planTransaction(
  client: GasPlanClient,
  tx: { account: `0x${string}`; to: `0x${string}`; data: `0x${string}`; fallbackGas: bigint; legacy: boolean },
): Promise<TxPlan> {
  const [fees, { gas, estimated }, balance] = await Promise.all([
    estimateFees(client, tx.legacy),
    estimateGasLimit(client, tx, tx.fallbackGas),
    client.getBalance({ address: tx.account }).catch((e) => {
      throw new GasPlanRpcError("Couldn't read wallet balance", e);
    }),
  ]);
  const requiredWei = requiredBalance(gas, fees);
  return { gas, gasEstimated: estimated, fees, requiredWei, balance, sufficient: balance >= requiredWei };
}

/** "0.0391" — CELO with 4 decimals, rounded up so a shortfall is never understated. */
export function formatCelo(wei: bigint): string {
  const unit = 10n ** 14n; // 0.0001 CELO
  const units = (wei + unit - 1n) / unit;
  return `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, "0")}`;
}

/** Upper bound accepted for a caller-supplied requirement (10 CELO). */
export const MAX_REQUIRED_WEI = 10n * 10n ** 18n;

/** Parse a caller-supplied `minWei` (decimal wei). null if absent or invalid. */
export function parseMinWei(raw: string | null | undefined): bigint | null {
  if (!raw || !/^\d{1,30}$/.test(raw)) return null;
  const v = BigInt(raw);
  return v > 0n && v <= MAX_REQUIRED_WEI ? v : null;
}

/** Balance needed for the default gas budget at the given live gas price. */
export function defaultRequiredWei(gasPrice: bigint): bigint {
  return DEFAULT_GAS_BUDGET * withBuffer(gasPrice, FEE_BUFFER_PCT);
}
