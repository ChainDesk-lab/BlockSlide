import { useState, useEffect, useRef } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useSearchParams } from "next/navigation";
import { useShop } from "../hooks/useShop";
import { useContractAddress } from "../hooks/useContractData";
import { ShopIcon } from "./ShopIcon";
import Notice from "./Notice";
import ShopCard, { CoinMark, type ShopArt, type ShopBadge } from "./ShopCard";
import { COSMETICS_CATALOG } from "../lib/avatarSystem";
import { GAME2048_V6_FUNCTIONS } from "../lib/abiV6";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";
import { undoUnavailableMessage } from "../lib/undoAvailability";
import { priceLabel, priceBlockReason, type PriceRead } from "../lib/shopPrice";
import { buyButtonState, formatG, shopCategoryFromParam, type ShopCategory } from "../lib/shopState";
import { useUbiContribution } from "../hooks/useUbiContribution";
import { formatBps, ubiContributionFor } from "../lib/ubiContribution";

const CELOSCAN = "https://celoscan.io";

/** G$ with up to 2 decimals (contributions are often fractional: 5% of 25 = 1.25). */
function fmtGExact(val: bigint): string {
  return (Number(val) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " G$";
}

function fmtTimeLeft(expiry: bigint): string {
  const secsLeft = Number(expiry) - Math.floor(Date.now() / 1000);
  if (secsLeft <= 0) return "Expired";
  const h = Math.floor(secsLeft / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

const COSMETIC_ICON: Record<number, "tile" | "fits" | "flair" | "goggles" | "caps"> = { 1: "tile", 2: "fits", 3: "flair", 4: "goggles", 5: "caps" };

/**
 * Original Figma product artwork (public/shop-art), as supplied by the team. Five files are
 * byte-identical to the originals; xp-boost.png and tile-skin.png are the originals with only the
 * baked-in tier-label strip cropped off (the game has no product tiers). Leaderboard Flair
 * has no supplied original and keeps its existing illustration (ShopIcon).
 */
const ART = {
  undo: { src: "/shop-art/undo-step.png" },
  shield: { src: "/shop-art/streak-shield.png" },
  // The supplied bolt for 2x; 5x uses the same artwork recoloured gold (hue rotated -78 degrees) to set it apart.
  boost: { src: "/shop-art/xp-boost.png", fit: "contain" }, // the whole bolt and ring stay visible, as in the design
  boost5: { src: "/shop-art/xp-boost-5x.png", fit: "contain" },
} satisfies Record<string, ShopArt>;
const COSMETIC_ART: Partial<Record<number, ShopArt>> = {
  1: { src: "/shop-art/tile-skin.png" },
  2: { src: "/shop-art/fits.jpg", position: "center 42%" }, // keeps the BLOCKSLIDE chest print in view
  4: { src: "/shop-art/goggles.jpg" },
  5: { src: "/shop-art/caps.jpg", position: "center 48%" },
};
const COSMETIC_DESC: Record<string, string> = {
  tile: "Applies to the game board when equipped.",
  avatar: "Avatar accessory.",
  flair: "Renders next to your name on leaderboards.",
};

export default function Shop() {
  const { isConnected } = useAccount();
  const searchParams = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<ShopCategory>(() => shopCategoryFromParam(searchParams.get("category")));
  const [undoQuantity, setUndoQuantity] = useState(1);

  useEffect(() => {
    if (searchParams.get("tab") === "shop") setActiveCategory(shopCategoryFromParam(searchParams.get("category")));
  }, [searchParams]);

  const selectCategory = (cat: ShopCategory) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "shop");
    params.set("category", cat);
    window.history.pushState({}, "", `?${params.toString()}`);
    setActiveCategory(cat);
  };

  const {
    prices, cosmeticPrices,
    shieldCount, xpBoost, boostActive,
    playerXp, streakCount,
    gdBalance,
    undoCredits,
    pendingAction,
    approve, buyShield, buyBoost, buyUndoMove, buyCosmetic,
    isApproved, canAfford,
    error,
    lastUbiContribution,
    undo,
  } = useShop();
  const ubi = useUbiContribution();

  // Which cosmetics this wallet owns, straight from the contract (getCosmeticsOwned). If the read
  // fails or hasn't returned, ownership is unknown and the cards behave exactly as before.
  const player = useContractAddress();
  const ownedRead = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_V6_FUNCTIONS,
    functionName: "getCosmeticsOwned",
    args: player ? [player, COSMETICS_CATALOG.map((c) => BigInt(c.id))] : undefined,
    query: { enabled: !!player && CONTRACT_DEPLOYED },
  });
  const owned = (id: number): boolean => {
    const i = COSMETICS_CATALOG.findIndex((c) => c.id === id);
    const data = ownedRead.data as readonly boolean[] | undefined;
    return !!data && i >= 0 && data[i] === true;
  };
  // A finished cosmetic purchase changes ownership: read it again.
  const prevPending = useRef(pendingAction);
  useEffect(() => {
    if (prevPending.current === "cosmetic" && pendingAction === null) ownedRead.refetch();
    prevPending.current = pendingAction;
  }, [pendingAction, ownedRead]);

  if (!isConnected) return null;

  // Shown only when the contract reports its rate (i.e. after the UBI
  // contribution upgrade). Before that, nothing is claimed.
  const ubiNote = ubi.status === "ready" ? (
    <p className="shop__ubi-note">
      {formatBps(ubi.bps)} of every paid purchase supports GoodDollar UBI.{" "}
      <a href={`${CELOSCAN}/address/${ubi.recipient}`} target="_blank" rel="noopener noreferrer">
        Where it goes ↗
      </a>
    </p>
  ) : null;

  // Only what the confirmed receipt's UbiContribution event says.
  const ubiConfirmed = lastUbiContribution ? (
    <Notice tone="success" className="shop__ubi-confirmed">
      {fmtGExact(lastUbiContribution.amount)} of this purchase went to GoodDollar UBI ·{" "}
      <a href={`${CELOSCAN}/tx/${lastUbiContribution.txHash}`} target="_blank" rel="noopener noreferrer">
        View transaction ↗
      </a>
    </Notice>
  ) : null;

  /** "incl. 1.25 G$ for UBI" from the on-chain price, or nothing if unknown. */
  const ubiShare = (price: bigint | undefined) =>
    ubi.status === "ready" && price !== undefined && price > 0n ? (
      <span className="shop-card__ubi">incl. {fmtGExact(ubiContributionFor(price, ubi.bps))} for UBI</span>
    ) : null;

  /** The existing purchase rules, now as a card button state (see lib/shopState). */
  const button = (priceRead: PriceRead, pendingKey: NonNullable<typeof pendingAction>, o: { quantity?: bigint; listed?: boolean; owned?: boolean } = {}) => {
    const blocked = priceBlockReason(priceRead, o.listed ?? true);
    const total = blocked ? 0n : (priceRead.value as bigint) * (o.quantity ?? 1n);
    return buyButtonState({
      blocked, owned: o.owned, affordable: blocked ? true : canAfford(total), approved: blocked ? true : isApproved(total),
      pending: pendingAction === pendingKey, approvePending: pendingAction === "approve", anyPending: !!pendingAction,
    });
  };
  const act = (buy: () => void) => (a: "approve" | "buy") => (a === "approve" ? approve() : buy());
  const countBadge = (n: bigint, one: string, many: string): ShopBadge | null =>
    n > 0n ? { label: `${Number(n)} ${n === 1n ? one : many}`, tone: "info" } : null;

  return (
    <section className="shop2" aria-label="Shop">
      <header className="shop2__hero">
        <div>
          <h1 className="page__title">The Shop</h1>
          <p className="page__lede page__lede--wide">Customize your gaming experience with premium themes, skins, and boosters.</p>
        </div>
        <div className="shop2__balance" aria-label="Your G$ balance">
          <CoinMark />
          <span>{formatG(gdBalance)}</span>
        </div>
      </header>

      <div className="shop2__bar">
        <div className="seg-tabs" role="tablist" aria-label="Shop category">
          {(["power-ups", "cosmetics"] as const).map((c) => (
            <button key={c} role="tab" aria-selected={activeCategory === c}
              className={`seg-tabs__tab ${activeCategory === c ? "seg-tabs__tab--active" : ""}`} onClick={() => selectCategory(c)}>
              {c === "power-ups" ? "Power-Ups" : "Cosmetics"}
            </button>
          ))}
        </div>
        {activeCategory === "power-ups" && (
          <div className="shop2__chips">
            <span className="shop2__chip">XP <strong>{Number(playerXp).toLocaleString()}</strong></span>
            <span className="shop2__chip">Streak <strong>{Number(streakCount)} day{streakCount !== 1n ? "s" : ""}</strong></span>
          </div>
        )}
      </div>

      {ubiNote}

      {activeCategory === "power-ups" ? (
        <div className="shop2__grid shop2__grid--3">
          <ShopCard
            name="Undo Step"
            image={<ShopIcon type="undo" size={120} />}
            art={ART.undo}
            badge={countBadge(undoCredits, "credit", "credits")}
            price={priceLabel(prices.undo)}
            priceNote={ubiShare(prices.undo.value !== undefined ? prices.undo.value * BigInt(undoQuantity) : undefined)}
            description={undo.available
              ? "Take back your last move — tap Undo under the board. One credit per undo, charged when you submit the score."
              : undoUnavailableMessage(undo.reason)}
            extra={
              <label className="shop-card__qty">
                <span>Qty</span>
                <input type="number" min="1" max="10" value={undoQuantity} aria-label="Undo credits to buy"
                  onChange={(e) => setUndoQuantity(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  disabled={!!pendingAction || !undo.available} />
              </label>
            }
            // Don't sell credits that can't be used yet.
            button={undo.available ? button(prices.undo, "undo", { quantity: BigInt(undoQuantity) })
              : { label: "Unavailable", variant: "disabled", disabled: true, action: null, busy: false }}
            onAction={act(() => buyUndoMove(undoQuantity))}
          />
          <ShopCard
            name="Streak Shield"
            image={<ShopIcon type="shield" size={120} />}
            art={ART.shield}
            badge={countBadge(shieldCount, "shield", "shields")}
            price={priceLabel(prices.shield)}
            priceNote={ubiShare(prices.shield.value)}
            description="Protects your streak for one missed day."
            button={button(prices.shield, "shield")}
            onAction={act(buyShield)}
          />
          <ShopCard
            name="XP Boost 2x"
            image={<ShopIcon type="boost2" size={120} />}
            art={ART.boost}
            badge={boostActive && xpBoost?.multiplier === 2 ? { label: "Active", tone: "active" } : null}
            price={priceLabel(prices.boost2x)}
            priceNote={ubiShare(prices.boost2x.value)}
            description="Double all XP earned from games for 5 hours."
            status={boostActive && xpBoost?.multiplier === 2 ? fmtTimeLeft(xpBoost.expiry) : undefined}
            button={button(prices.boost2x, "boost2")}
            onAction={act(() => buyBoost(2))}
          />
          <ShopCard
            name="XP Boost 5x"
            image={<ShopIcon type="boost5" size={120} />}
            art={ART.boost5}
            badge={boostActive && xpBoost?.multiplier === 5 ? { label: "Active", tone: "active" } : null}
            price={priceLabel(prices.boost5x)}
            priceNote={ubiShare(prices.boost5x.value)}
            description="Multiply all XP earned from games by 5 for 5 hours."
            status={boostActive && xpBoost?.multiplier === 5 ? fmtTimeLeft(xpBoost.expiry) : undefined}
            button={button(prices.boost5x, "boost5")}
            onAction={act(() => buyBoost(5))}
          />
        </div>
      ) : (
        <div className="shop2__grid shop2__grid--4">
          {COSMETICS_CATALOG.map((cosmetic) => {
            const onChain = cosmeticPrices[cosmetic.id];
            const isOwned = owned(cosmetic.id);
            return (
              <ShopCard
                key={cosmetic.id}
                size="sm"
                name={cosmetic.name}
                image={<ShopIcon type={COSMETIC_ICON[cosmetic.id]} size={104} />}
                art={COSMETIC_ART[cosmetic.id]}
                badge={isOwned ? { label: "Owned", tone: "owned" } : null}
                price={onChain.listed ? priceLabel(onChain.price) : "Unavailable"}
                description={COSMETIC_DESC[cosmetic.category] ?? ""}
                button={button(onChain.price, "cosmetic", { listed: onChain.listed, owned: isOwned })}
                onAction={act(() => buyCosmetic(cosmetic.id))}
              />
            );
          })}
        </div>
      )}

      {ubiConfirmed}
      {error && <Notice tone="error" className="shop__error" role="alert">{error}</Notice>}
    </section>
  );
}
