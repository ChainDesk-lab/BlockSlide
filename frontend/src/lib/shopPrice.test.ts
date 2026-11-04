/**
 * Regression: shop prices are only ever shown from the chain. A loading or
 * failed read is never displayed as 0 G$ or treated as free, and cosmetics no
 * longer carry hard-coded zero prices.
 */
import { describe, expect, it } from "vitest";
import { decodeFunctionResult, encodeFunctionResult } from "viem";
import { cosmeticPriceFromRead, priceBlockReason, priceLabel, toPriceRead } from "./shopPrice";
import { COSMETICS_CATALOG } from "./avatarSystem";
import { GAME2048_MERGED_ABI } from "./abiMerged";

const G = 10n ** 18n;

describe("toPriceRead", () => {
  it("is loading while the read is pending", () => {
    expect(toPriceRead({ status: "pending" })).toEqual({ value: undefined, status: "loading" });
  });
  it("is unavailable when the read failed", () => {
    expect(toPriceRead({ status: "error" })).toEqual({ value: undefined, status: "unavailable" });
  });
  it("is ready with the chain's value", () => {
    expect(toPriceRead({ status: "success", data: 500n * G })).toEqual({ value: 500n * G, status: "ready" });
  });
  it("keeps a real on-chain zero as zero (not as a failure)", () => {
    expect(toPriceRead({ status: "success", data: 0n })).toEqual({ value: 0n, status: "ready" });
  });
});

describe("priceLabel", () => {
  it("never shows a number for a loading or failed price", () => {
    expect(priceLabel({ value: undefined, status: "loading" })).toBe("…");
    expect(priceLabel({ value: undefined, status: "unavailable" })).toBe("Unavailable");
  });
  it("formats a loaded price in whole G$", () => {
    expect(priceLabel({ value: 1500n * G, status: "ready" })).toBe("1,500 G$");
  });
});

describe("priceBlockReason", () => {
  it("blocks buying while loading or after a failed read", () => {
    expect(priceBlockReason({ value: undefined, status: "loading" })).toBe("Loading price…");
    expect(priceBlockReason({ value: undefined, status: "unavailable" })).toBe("Price unavailable");
  });
  it("blocks an item the contract doesn't list", () => {
    expect(priceBlockReason({ value: 150n * G, status: "ready" }, false)).toBe("Unavailable");
  });
  it("blocks a real zero price (the contract rejects it)", () => {
    expect(priceBlockReason({ value: 0n, status: "ready" })).toBe("Coming soon");
  });
  it("allows a loaded, listed, non-zero price", () => {
    expect(priceBlockReason({ value: 150n * G, status: "ready" })).toBeNull();
  });
});

describe("cosmetics catalog", () => {
  it("carries no hard-coded prices", () => {
    for (const item of COSMETICS_CATALOG) expect(item).not.toHaveProperty("price");
  });
  it("lists the five items the contract prices (ids 1-5)", () => {
    expect(COSMETICS_CATALOG.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("getCosmeticItem ABI", () => {
  it("decodes the contract's struct return into price and exists", () => {
    const encoded = encodeFunctionResult({
      abi: GAME2048_MERGED_ABI,
      functionName: "getCosmeticItem",
      result: { price: 150n * G, exists: true },
    });
    const decoded = decodeFunctionResult({ abi: GAME2048_MERGED_ABI, functionName: "getCosmeticItem", data: encoded });
    expect(decoded).toEqual({ price: 150n * G, exists: true });
  });
});

describe("cosmetic price reads never enable a purchase unless they succeeded", () => {
  const canBuy = (c: ReturnType<typeof cosmeticPriceFromRead>) => priceBlockReason(c.price, c.listed) === null;

  it("blocks while the batch is pending", () => {
    expect(canBuy(cosmeticPriceFromRead(undefined, "pending"))).toBe(false);
  });
  it("blocks when the item's read failed", () => {
    expect(canBuy(cosmeticPriceFromRead({ status: "failure" }, "success"))).toBe(false);
  });
  it("blocks when the whole batch errored", () => {
    expect(canBuy(cosmeticPriceFromRead(undefined, "error"))).toBe(false);
  });
  it("blocks a malformed success (e.g. an ABI mismatch decoding to the wrong shape)", () => {
    expect(canBuy(cosmeticPriceFromRead({ status: "success", result: [150n * G, true] }, "success"))).toBe(false);
    expect(canBuy(cosmeticPriceFromRead({ status: "success", result: undefined }, "success"))).toBe(false);
  });
  it("blocks an item the contract doesn't list, or prices at zero", () => {
    expect(canBuy(cosmeticPriceFromRead({ status: "success", result: { price: 150n * G, exists: false } }, "success"))).toBe(false);
    expect(canBuy(cosmeticPriceFromRead({ status: "success", result: { price: 0n, exists: true } }, "success"))).toBe(false);
  });
  it("allows only a successful, listed, non-zero price", () => {
    expect(canBuy(cosmeticPriceFromRead({ status: "success", result: { price: 150n * G, exists: true } }, "success"))).toBe(true);
  });
});
