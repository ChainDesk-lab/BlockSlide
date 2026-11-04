/**
 * Shop redesign (Figma frame 4): the card button follows the shop's existing purchase rules,
 * "Owned" comes only from the contract, the currency is G$, and nothing is invented
 * (no rarity tiers, no products, prices or balances beyond what the chain returns).
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ShopCard from "./ShopCard";
import { buyButtonState, formatG, shopCategoryFromParam } from "../lib/shopState";
import { priceBlockReason, priceLabel, type PriceRead } from "../lib/shopPrice";
import { COSMETICS_CATALOG } from "../lib/avatarSystem";

const G = (n: number) => BigInt(n) * 10n ** 18n;
const ready = (v: bigint): PriceRead => ({ status: "ready", value: v });
const base = { blocked: null, affordable: true, approved: true, pending: false, approvePending: false, anyPending: false };
const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

/** The pre-redesign ItemButton, rule for rule, to prove the new state machine didn't change them. */
function legacyItemButton(price: PriceRead, listed: boolean, affordable: boolean, approved: boolean): { label: string; disabled: boolean; action: string | null } {
  const blocked = priceBlockReason(price, listed);
  if (blocked) return { label: blocked, disabled: true, action: null };
  if (!affordable) return { label: "Insufficient G$", disabled: true, action: null };
  if (!approved) return { label: "Buy", disabled: false, action: "approve" };
  return { label: "Buy", disabled: false, action: "buy" };
}

describe("Shop: card button state", () => {
  it("matches the existing purchase rules for every price state, listing, balance and approval", () => {
    const prices: PriceRead[] = [{ status: "loading", value: undefined }, { status: "unavailable", value: undefined }, ready(0n), ready(G(25))];
    for (const price of prices) for (const listed of [true, false]) for (const affordable of [true, false]) for (const approved of [true, false]) {
      const legacy = legacyItemButton(price, listed, affordable, approved);
      const next = buyButtonState({ ...base, blocked: priceBlockReason(price, listed), affordable, approved });
      const ctx = JSON.stringify({ price, listed, affordable, approved }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      expect(next.action, ctx).toBe(legacy.action);
      expect(next.disabled, ctx).toBe(legacy.disabled);
      // Only the purchase label changed wording ("Buy" -> "Buy Now", as designed).
      expect(next.label, ctx).toBe(legacy.label === "Buy" ? "Buy Now" : legacy.label);
    }
  });

  it("a price that hasn't loaded or failed never looks free or buyable", () => {
    expect(buyButtonState({ ...base, blocked: priceBlockReason({ status: "loading", value: undefined }) })).toMatchObject({ label: "Loading price…", disabled: true, action: null });
    expect(buyButtonState({ ...base, blocked: priceBlockReason({ status: "unavailable", value: undefined }) })).toMatchObject({ label: "Price unavailable", disabled: true });
    expect(buyButtonState({ ...base, blocked: priceBlockReason(ready(0n)) })).toMatchObject({ label: "Coming soon", disabled: true });
    expect(priceLabel({ status: "unavailable", value: undefined })).toBe("Unavailable");
  });

  it("Owned wins over every other state, and only when the contract says so", () => {
    expect(buyButtonState({ ...base, owned: true })).toEqual({ label: "Owned", variant: "owned", disabled: true, action: null, busy: false });
    expect(buyButtonState({ ...base, owned: true, affordable: false })).toMatchObject({ label: "Owned" });
    expect(buyButtonState({ ...base, owned: false })).toMatchObject({ label: "Buy Now", action: "buy" });
    expect(buyButtonState({ ...base })).toMatchObject({ label: "Buy Now", action: "buy" }); // unknown ownership: unchanged rules
  });

  it("one transaction at a time: every button is disabled while any is pending, and the active one spins", () => {
    expect(buyButtonState({ ...base, anyPending: true })).toMatchObject({ disabled: true, busy: false });
    expect(buyButtonState({ ...base, anyPending: true, pending: true })).toMatchObject({ disabled: true, busy: true, action: "buy" });
    expect(buyButtonState({ ...base, approved: false, anyPending: true, approvePending: true })).toMatchObject({ action: "approve", busy: true, disabled: true });
  });
});

describe("Shop: helpers", () => {
  it("tabs follow ?category=, defaulting to Power-ups", () => {
    expect(shopCategoryFromParam("cosmetics")).toBe("cosmetics");
    expect(shopCategoryFromParam("power-ups")).toBe("power-ups");
    expect(shopCategoryFromParam(null)).toBe("power-ups");
    expect(shopCategoryFromParam("<script>")).toBe("power-ups");
  });

  it("the balance is whole G$, and unknown until read", () => {
    expect(formatG(undefined)).toBe("…");
    expect(formatG(0n)).toBe("0 G$");
    expect(formatG(G(9420))).toBe("9,420 G$");
  });
});

describe("Shop: card rendering", () => {
  const render = (p: Partial<Parameters<typeof ShopCard>[0]> = {}) => renderToStaticMarkup(createElement(ShopCard, {
    name: "Streak Shield", image: createElement("img", { src: "/shop-icons/streak-shield.svg", alt: "" }), price: "25 G$",
    description: "Protects your streak for one missed day.", button: buyButtonState(base), ...p,
  }));

  it("shows the asset, name, G$ price, description and a Buy Now button", () => {
    const html = render();
    expect(html).toContain("/shop-icons/streak-shield.svg");
    expect(html).toContain("Streak Shield");
    expect(html).toContain("25 G$");
    expect(html).toContain("Buy Now");
    expect(html).not.toContain("disabled");
  });

  it("Owned and unavailable states render disabled; a badge shows only real state", () => {
    const ownedHtml = render({ badge: { label: "Owned", tone: "owned" }, button: buyButtonState({ ...base, owned: true }) });
    expect(ownedHtml).toMatch(/shop-card__btn--owned" disabled="">Owned</);
    expect(ownedHtml).toContain("shop-card__badge--owned");
    expect(render({ button: buyButtonState({ ...base, blocked: "Price unavailable" }) })).toMatch(/disabled="">Price unavailable</);
    expect(render()).not.toContain("shop-card__badge");
  });

  it("a pending purchase shows a spinner, not a label", () => {
    const html = render({ button: buyButtonState({ ...base, anyPending: true, pending: true }) });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("spinner");
    expect(html).not.toContain("Buy Now");
  });

  it("clicking runs the button's action through the existing handlers", () => {
    const onAction = vi.fn();
    const el = ShopCard({ name: "x", image: null, price: "1 G$", description: "", button: buyButtonState({ ...base, approved: false }), onAction });
    // Find the button element in the returned tree and invoke its handler as React would.
    const find = (n: any): any => (n?.type === "button" ? n : [].concat(n?.props?.children ?? []).map(find).find(Boolean));
    find(el).props.onClick();
    expect(onAction).toHaveBeenCalledWith("approve");
  });
});

describe("Shop: guards", () => {
  const shop = src("Shop.tsx"), card = src("ShopCard.tsx"), state = src("../lib/shopState.ts");

  it("prices and balances are G$ only: no SLIDE token anywhere in the shop", () => {
    for (const s of [shop, card, state]) expect(s).not.toMatch(/\bSLIDE\b/);
    expect(shop).toContain("formatG(gdBalance)");
  });

  it("no invented rarity tiers, products or prices", () => {
    for (const s of [shop, card]) expect(s).not.toMatch(/\b(RARE|EPIC|COMMON|LEGENDARY|rarity)\b/i);
    // Every cosmetic comes from the existing catalog, every power-up price from the chain.
    expect(shop).toContain("COSMETICS_CATALOG.map");
    for (const p of ["prices.undo", "prices.shield", "prices.boost2x", "prices.boost5x"]) expect(shop).toContain(p);
    expect(COSMETICS_CATALOG).toHaveLength(5);
  });

  it("purchases still go through the existing hook actions; ownership is read from the contract", () => {
    for (const a of ["buyShield", "buyBoost(2)", "buyBoost(5)", "buyUndoMove(undoQuantity)", "buyCosmetic(cosmetic.id)", "approve()"]) expect(shop).toContain(a);
    expect(shop).toContain('functionName: "getCosmeticsOwned"');
    expect(shop).not.toMatch(/writeContract|sendTransaction/);
  });

  it("every product image is an existing asset", () => {
    const icons = src("ShopIcon.tsx");
    for (const f of ["undo-step", "streak-shield", "xp-boost-2x", "xp-boost-5x", "tile-skin", "fits", "leaderboard-flair", "goggles", "caps"]) {
      expect(icons).toContain(`/shop-icons/${f}.svg`);
      expect(() => readFileSync(join(__dirname, "../../public/shop-icons", `${f}.svg`))).not.toThrow();
    }
  });
});

describe("Shop: original Figma artwork", () => {
  const shop = src("Shop.tsx"), css = readFileSync(join(__dirname, "../index.css"), "utf8");
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  /** SHA-256 of each file exactly as supplied by the team (3 Nov 2026): never re-encoded or resized. */
  const ORIGINALS: Record<string, string> = {
    "undo-step.png": "aa063501ef3eb865a90181c1b64840cd6568906f4553edf9709777eebc185101",
    "streak-shield.png": "4a67f81b0132025bb2f7e1b1608bdb336c9cedeb2104eb660b62bf37a7e22677",
    "goggles.jpg": "9e9efa6f7a5cf55fe685d7a1a2ffcf4e5f6ca777eb486a92e0405402a284616f",
    "fits.jpg": "0b8d9135c58687a6e060378b08ad3a08eb5095a55ae70c86485d2c62eb3d624b",
    "caps.jpg": "7ae0c8ffb0388e6cd14902997afec7f7763a53010e91b7b054c6f276dfe24b05",
    // The supplied originals with only the baked-in label strip cropped off, saved losslessly:
    // lightning bolt 237x160 -> rows 34-159, columns 0-235 (label strip and a 1px grey export edge removed);
    // tile pattern 471x309 -> rows 69-308 (label strip removed).
    "xp-boost.png": "c5c35e221f4f259bd47f9df42c2a39a4e073a7949624451f66bc94549cea2bef",
    "tile-skin.png": "d80e259693544b65b7080f62c3df5ae1250b41e30100e31fd61f3d22eef1f984",
    // xp-boost.png recoloured gold for XP Boost 5x (hue rotated -78 degrees, same size, lossless).
    "xp-boost-5x.png": "3bcfa3cca4f1ebca37b3081606450bce7105e68d824c47905cd0a115307aed2b",
  };

  it("every artwork file is exactly the supplied original (or its label-cropped version)", () => {
    for (const [file, sha] of Object.entries(ORIGINALS)) {
      const bytes = readFileSync(join(__dirname, "../../public/shop-art", file));
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(sha);
    }
  });

  it("each image is on its confirmed product", () => {
    expect(shop).toMatch(/name="Undo Step"[\s\S]{0,120}art=\{ART\.undo\}/);
    expect(shop).toMatch(/name="Streak Shield"[\s\S]{0,120}art=\{ART\.shield\}/);
    expect(shop).toContain('undo: { src: "/shop-art/undo-step.png" }');
    expect(shop).toContain('shield: { src: "/shop-art/streak-shield.png" }');
    // Cosmetic ids from the catalog: 2 Fits, 4 Goggles, 5 Caps.
    expect(COSMETICS_CATALOG.find((c) => c.id === 2)?.name).toBe("Fits");
    expect(COSMETICS_CATALOG.find((c) => c.id === 4)?.name).toBe("Goggles");
    expect(COSMETICS_CATALOG.find((c) => c.id === 5)?.name).toBe("Caps");
    expect(shop).toContain('2: { src: "/shop-art/fits.jpg"');
    expect(shop).toContain('4: { src: "/shop-art/goggles.jpg" }');
    expect(shop).toContain('5: { src: "/shop-art/caps.jpg"');
    // The lightning bolt goes on BOTH boosts; the tile pattern on Tile Skin (catalog id 1).
    expect(shop).toMatch(/name="XP Boost 2x"[\s\S]{0,120}art=\{ART\.boost\}/);
    expect(shop).toMatch(/name="XP Boost 5x"[\s\S]{0,120}art=\{ART\.boost5\}/);
    expect(shop).toContain('boost5: { src: "/shop-art/xp-boost-5x.png", fit: "contain" }');
    expect(shop).toContain('boost: { src: "/shop-art/xp-boost.png", fit: "contain" }');
    expect(COSMETICS_CATALOG.find((c) => c.id === 1)?.name).toBe("Tile Skin");
    expect(shop).toContain('1: { src: "/shop-art/tile-skin.png" }');
  });

  it("the cropped images no longer carry a rarity label, and keep their artwork's proportions", () => {
    const png = (f: string) => { const b = readFileSync(join(__dirname, "../../public/shop-art", f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
    expect(png("xp-boost.png")).toEqual({ w: 236, h: 126 }); // the 34-row label strip and a 1px export edge removed
    expect(png("xp-boost-5x.png")).toEqual({ w: 236, h: 126 }); // gold version: same size as the 2x bolt
        expect(png("tile-skin.png")).toEqual({ w: 471, h: 240 }); // full width kept; cut on the black line between tile rows
  });

  it("Leaderboard Flair, with no supplied original, keeps its existing artwork", () => {
    expect(shop).not.toMatch(/\b3: \{ src: "\/shop-art/); // catalog id 3 = Leaderboard Flair
    expect(shop).not.toMatch(/shop-art\/(leaderboard|flair)/i);
    expect(COSMETICS_CATALOG.find((c) => c.id === 3)?.name).toBe("Leaderboard Flair");
    expect(shop).toContain("art={COSMETIC_ART[cosmetic.id]}"); // undefined for id 3 -> ShopIcon fallback
  });

  it("artwork fills its band without distortion, and the card falls back to the icon without it", () => {
    expect(css).toContain(".shop-card__art { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }");
    const withArt = renderToStaticMarkup(createElement(ShopCard, { name: "Goggles", image: createElement("span", null, "ICON"), art: { src: "/shop-art/goggles.jpg" }, price: "1 G$", description: "", button: buyButtonState(base) }));
    expect(withArt).toContain('class="shop-card__media shop-card__media--art"');
    expect(withArt).toContain('src="/shop-art/goggles.jpg"');
    expect(withArt).not.toContain("ICON");
    const contained = renderToStaticMarkup(createElement(ShopCard, { name: "XP Boost 2x", image: null, art: { src: "/shop-art/xp-boost.png", fit: "contain" }, price: "1 G$", description: "", button: buyButtonState(base) }));
    expect(contained).toContain("shop-card__media--contain");
    expect(contained).toContain('class="shop-card__art shop-card__art--contain"');
    expect(css).toContain(".shop-card__art--contain { object-fit: contain; }");
    const without = renderToStaticMarkup(createElement(ShopCard, { name: "Flair", image: createElement("span", null, "ICON"), price: "1 G$", description: "", button: buyButtonState(base) }));
    expect(without).toContain("ICON");
    expect(without).not.toContain("shop-card__media--art");
  });

  it("names, prices and purchase logic are untouched by the artwork change", () => {
    for (const a of ["buyShield", "buyBoost(2)", "buyBoost(5)", "buyUndoMove(undoQuantity)", "buyCosmetic(cosmetic.id)", "approve()"]) expect(shop).toContain(a);
    for (const p of ["prices.undo", "prices.shield", "prices.boost2x", "prices.boost5x"]) expect(shop).toContain(p);
    for (const n of ['name="Undo Step"', 'name="Streak Shield"', 'name="XP Boost 2x"', 'name="XP Boost 5x"', "name={cosmetic.name}"]) expect(shop).toContain(n);
  });
});
