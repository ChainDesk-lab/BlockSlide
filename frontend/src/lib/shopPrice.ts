/**
 * How the shop shows a price that comes from the contract.
 *
 * A price is only ever shown as a number once the chain has returned it. While
 * the read is in flight it is "loading"; if the read failed it is
 * "unavailable". Neither state is ever rendered as 0 G$ or treated as free —
 * the shop once displayed hard-coded zero prices, and earlier still showed
 * real zeros because no price had been set on-chain.
 */

export type PriceStatus = "loading" | "ready" | "unavailable";

export interface PriceRead {
  value: bigint | undefined;
  status: PriceStatus;
}

/** Map a wagmi read (`status` is "pending" | "error" | "success") to a price. */
export function toPriceRead(read: { data?: bigint; status: "pending" | "error" | "success" }): PriceRead {
  if (read.status === "success" && read.data !== undefined) return { value: read.data, status: "ready" };
  if (read.status === "error") return { value: undefined, status: "unavailable" };
  return { value: undefined, status: "loading" };
}

/** Text for the price tag. */
export function priceLabel(price: PriceRead): string {
  if (price.status === "loading") return "…";
  if (price.status === "unavailable" || price.value === undefined) return "Unavailable";
  return (Number(price.value) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " G$";
}

/**
 * Why the buy button can't be used for this price, or null when it can.
 * `listed` is false for a cosmetic the contract says doesn't exist.
 */
export function priceBlockReason(price: PriceRead, listed = true): string | null {
  if (price.status === "loading") return "Loading price…";
  if (price.status === "unavailable" || price.value === undefined) return "Price unavailable";
  if (!listed) return "Unavailable";
  // A real on-chain zero means the owner hasn't priced the item; the contract
  // rejects purchases at zero (ZeroPriceNotAllowed).
  if (price.value === 0n) return "Coming soon";
  return null;
}

export interface CosmeticPrice {
  price: PriceRead;
  /** false when the contract says the item doesn't exist */
  listed: boolean;
}

/**
 * One cosmetic's price from its `getCosmeticItem` read (an entry of wagmi's
 * useReadContracts result) and the batch's overall status. Anything other than
 * a well-formed success is loading or unavailable — never a buyable price.
 */
export function cosmeticPriceFromRead(
  entry: { status: "success" | "failure"; result?: unknown } | undefined,
  batchStatus: "pending" | "error" | "success",
): CosmeticPrice {
  if (entry?.status === "success") {
    const item = entry.result as { price?: unknown; exists?: unknown } | null | undefined;
    if (item && typeof item.price === "bigint" && typeof item.exists === "boolean") {
      return { price: { value: item.price, status: "ready" }, listed: item.exists };
    }
    // Decoded into an unexpected shape (e.g. an ABI mismatch): not a price.
    return { price: { value: undefined, status: "unavailable" }, listed: true };
  }
  if (entry?.status === "failure" || batchStatus === "error") {
    return { price: { value: undefined, status: "unavailable" }, listed: true };
  }
  return { price: { value: undefined, status: "loading" }, listed: true };
}
