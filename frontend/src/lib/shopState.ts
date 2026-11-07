/**
 * Shop UI decisions, kept pure so they can be tested without a wallet.
 *
 * buyButtonState mirrors the purchase rules the shop has always applied, in the same order:
 * an item whose price is loading, unavailable, unlisted or zero can't be bought (a failed
 * price must never look free); then affordability; then the G$ approval; then the purchase.
 * "Owned" is added in front for cosmetics the contract reports as owned. It is decided only
 * from that on-chain read: when ownership is unknown the normal purchase rules apply.
 */

export type BuyVariant = "owned" | "disabled" | "approve" | "buy";

export interface BuyButtonState {
  label: string;
  variant: BuyVariant;
  disabled: boolean;
  /** Which existing action the button runs, if any. */
  action: "approve" | "buy" | null;
  /** Show the spinner instead of the label. */
  busy: boolean;
}

export function buyButtonState(o: {
  /** priceBlockReason(): a reason the item can't be bought, or null. */
  blocked: string | null;
  /** True only when the contract says this wallet owns the item. */
  owned?: boolean;
  affordable: boolean;
  approved: boolean;
  /** This item's purchase is in flight. */
  pending: boolean;
  /** The G$ approval is in flight. */
  approvePending: boolean;
  /** Any shop transaction is in flight (one at a time). */
  anyPending: boolean;
}): BuyButtonState {
  if (o.owned) return { label: "Owned", variant: "owned", disabled: true, action: null, busy: false };
  if (o.blocked) return { label: o.blocked, variant: "disabled", disabled: true, action: null, busy: false };
  if (!o.affordable) return { label: "Insufficient G$", variant: "disabled", disabled: true, action: null, busy: false };
  if (!o.approved) return { label: "Buy Now", variant: "approve", disabled: o.anyPending, action: "approve", busy: o.approvePending };
  return { label: "Buy Now", variant: "buy", disabled: o.anyPending, action: "buy", busy: o.pending };
}

export type ShopCategory = "power-ups" | "cosmetics";

/** The tab to show for a `?category=` value; anything else opens Power-ups. */
export function shopCategoryFromParam(value: string | null | undefined): ShopCategory {
  return value === "cosmetics" ? "cosmetics" : "power-ups";
}

/** Whole G$ for the balance pill and prices ("…" while unknown). */
export function formatG(wei: bigint | undefined): string {
  if (wei === undefined) return "…";
  return (Number(wei) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " G$";
}
