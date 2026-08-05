import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useSearchParams } from "next/navigation";
import { useShop } from "../hooks/useShop";
import { ShopIcon } from "./ShopIcon";
import { CategoryIcon } from "./CategoryIcon";
import { COSMETICS_CATALOG } from "../lib/avatarSystem";

function fmtG(val: bigint | undefined): string {
  if (val === undefined) return "…";
  return (Number(val) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 0 }) + " G$";
}

function fmtTimeLeft(expiry: bigint): string {
  const secsLeft = Number(expiry) - Math.floor(Date.now() / 1000);
  if (secsLeft <= 0) return "Expired";
  const h = Math.floor(secsLeft / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

type View = "landing" | "powerups" | "cosmetics";
type Category = "power-ups" | "cosmetics";

export default function Shop() {
  const { isConnected } = useAccount();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("landing");
  const [activeCategory, setActiveCategory] = useState<Category>("power-ups");
  const [undoQuantity, setUndoQuantity] = useState(1);

  useEffect(() => {
    const category = searchParams.get("category") as Category | null;
    const tab = searchParams.get("tab");
    if (tab === "shop" && category) {
      setView(category as View);
      setActiveCategory(category);
    }
  }, [searchParams]);

  const updateView = (newView: View, newCategory?: Category) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newView === "landing") {
      params.delete("category");
      window.history.pushState({}, "", `?${params.toString()}`);
    } else {
      const cat = newCategory || activeCategory;
      params.set("tab", "shop");
      params.set("category", cat);
      window.history.pushState({}, "", `?${params.toString()}`);
      setActiveCategory(cat);
    }
    setView(newView);
  };

  const {
    shieldPrice, boost2xPrice, boost5xPrice,
    shieldCount, xpBoost, boostActive,
    playerXp, streakCount,
    gdBalance,
    undoPrice, undoCredits,
    pendingAction,
    approve, buyShield, buyBoost, buyUndoMove, buyCosmetic,
    isApproved, canAfford,
    error,
  } = useShop();

  if (!isConnected) return null;

  const isPending = (a: typeof pendingAction) => pendingAction === a;

  function ItemButton({
    price,
    buyAction,
    pendingKey,
  }: {
    price: bigint | undefined;
    buyAction: () => void;
    pendingKey: "shield" | "boost2" | "boost5" | "undo" | "cosmetic";
  }) {
    const pending = isPending(pendingKey);
    const approvePending = isPending("approve");

    if (price === undefined || price === 0n) {
      return (
        <button className="shop-btn shop-btn--disabled" disabled>
          Coming soon
        </button>
      );
    }

    if (!canAfford(price)) {
      return (
        <button className="shop-btn shop-btn--disabled" disabled>
          Insufficient G$
        </button>
      );
    }

    if (!isApproved(price)) {
      return (
        <button
          className="shop-btn shop-btn--approve"
          onClick={approve}
          disabled={!!pendingAction}
        >
          {approvePending ? <Spinner /> : "Buy"}
        </button>
      );
    }

    return (
      <button
        className="shop-btn shop-btn--buy"
        onClick={buyAction}
        disabled={!!pendingAction}
      >
        {pending ? <Spinner /> : "Buy"}
      </button>
    );
  }

  // Landing Page: Category Cards
  if (view === "landing") {
    return (
      <section className="shop">
        <div className="shop__header">
          <div>
            <h2 className="shop__title">Game Shop</h2>
            <p className="shop__subtitle">Enhance your gameplay</p>
          </div>
          <div className="shop__balance">
            <div className="shop__balance-label">Balance</div>
            <div className="shop__balance-value">{fmtG(gdBalance)}</div>
          </div>
        </div>

        <div className="shop__categories">
          <div
            className="shop__category-card"
            onClick={() => updateView("powerups", "power-ups")}
          >
            <div className="shop__category-icon-wrapper">
              <CategoryIcon type="power-ups" size={110} />
            </div>
            <h3 className="shop__category-name">Power-Ups</h3>
            <p className="shop__category-desc">Shields, XP boosts, and undo moves</p>
          </div>

          <div
            className="shop__category-card"
            onClick={() => updateView("cosmetics", "cosmetics")}
          >
            <div className="shop__category-icon-wrapper">
              <CategoryIcon type="cosmetics" size={110} />
            </div>
            <h3 className="shop__category-name">Cosmetics</h3>
            <p className="shop__category-desc">Customize your look and leaderboard presence</p>
          </div>
        </div>

        {error && <p className="shop__error">{error}</p>}
      </section>
    );
  }

  // Power-Ups Category
  if (view === "powerups") {
    return (
      <section className="shop">
        <div className="shop__header">
          <button
            className="shop__back-btn"
            onClick={() => updateView("landing")}
          >
            ← Back
          </button>
          <div>
            <h2 className="shop__title">Power-Ups</h2>
            <p className="shop__subtitle">Strengthen your game</p>
          </div>
          <div className="shop__balance">
            <div className="shop__balance-label">Balance</div>
            <div className="shop__balance-value">{fmtG(gdBalance)}</div>
          </div>
        </div>

        <div className="shop__category-tabs">
          <button
            className={`shop__category-tab ${activeCategory === "power-ups" ? "shop__category-tab--active" : ""}`}
            onClick={() => updateView("powerups", "power-ups")}
          >
            Power-Ups
          </button>
          <button
            className={`shop__category-tab ${activeCategory === "cosmetics" ? "shop__category-tab--active" : ""}`}
            onClick={() => updateView("cosmetics", "cosmetics")}
          >
            Cosmetics
          </button>
        </div>

        <div className="shop__stats">
          <div className="shop__stat">
            <span className="shop__stat-label">XP</span>
            <span className="shop__stat-value">{Number(playerXp).toLocaleString()}</span>
          </div>
          <div className="shop__stat">
            <span className="shop__stat-label">Streak</span>
            <span className="shop__stat-value">{Number(streakCount)} day{streakCount !== 1n ? "s" : ""}</span>
          </div>
        </div>

        <div className="shop__items shop__items--powerups">
          {/* Streak Shield */}
          <div className="shop-item">
            <div className="shop-item__icon-wrapper">
              <ShopIcon type="shield" size={110} />
            </div>
            <div className="shop-item__top">
              <p className="shop-item__name">Streak Shield</p>
            </div>
            <div className="shop-item__content">
              <p className="shop-item__desc">
                Protects your streak for one missed day.
              </p>
              <p className="shop-item__status">
                {Number(shieldCount) > 0
                  ? `${Number(shieldCount)} shield${shieldCount !== 1n ? "s" : ""}`
                  : "No shields"}
              </p>
            </div>
            <div className="shop-item__footer">
              <div className="shop-item__price-section">
                <span className="shop-item__price">{fmtG(shieldPrice)}</span>
              </div>
              <ItemButton price={shieldPrice} buyAction={buyShield} pendingKey="shield" />
            </div>
          </div>

          {/* 2x XP Boost */}
          <div className="shop-item">
            <div className="shop-item__icon-wrapper">
              <ShopIcon type="boost2" size={110} />
            </div>
            <div className="shop-item__top">
              <p className="shop-item__name">XP Boost 2x</p>
            </div>
            <div className="shop-item__content">
              <p className="shop-item__desc">
                Double all XP earned from games for 5 hours.
              </p>
              <p className="shop-item__status">
                {boostActive && xpBoost?.multiplier === 2
                  ? fmtTimeLeft(xpBoost.expiry)
                  : "Not active"}
              </p>
            </div>
            <div className="shop-item__footer">
              <div className="shop-item__price-section">
                <span className="shop-item__price">{fmtG(boost2xPrice)}</span>
              </div>
              <ItemButton price={boost2xPrice} buyAction={() => buyBoost(2)} pendingKey="boost2" />
            </div>
          </div>

          {/* 5x XP Boost */}
          <div className="shop-item">
            <div className="shop-item__icon-wrapper">
              <ShopIcon type="boost5" size={110} />
            </div>
            <div className="shop-item__top">
              <p className="shop-item__name">XP Boost 5x</p>
            </div>
            <div className="shop-item__content">
              <p className="shop-item__desc">
                Multiply all XP earned from games by 5 for 5 hours.
              </p>
              <p className="shop-item__status">
                {boostActive && xpBoost?.multiplier === 5
                  ? fmtTimeLeft(xpBoost.expiry)
                  : "Not active"}
              </p>
            </div>
            <div className="shop-item__footer">
              <div className="shop-item__price-section">
                <span className="shop-item__price">{fmtG(boost5xPrice)}</span>
              </div>
              <ItemButton price={boost5xPrice} buyAction={() => buyBoost(5)} pendingKey="boost5" />
            </div>
          </div>

          {/* Undo Step */}
          <div className="shop-item">
            <div className="shop-item__icon-wrapper">
              <ShopIcon type="undo" size={110} />
            </div>
            <div className="shop-item__top">
              <p className="shop-item__name">Undo Step</p>
            </div>
            <div className="shop-item__content">
              <p className="shop-item__desc">
                Revert your last move during gameplay.
              </p>
              <p className="shop-item__status">
                {Number(undoCredits) > 0
                  ? `${Number(undoCredits)} credit${undoCredits !== 1n ? "s" : ""}`
                  : "No credits"}
              </p>
            </div>
            <div className="shop-item__footer">
              <div className="shop-item__price-section">
                <span className="shop-item__price">{fmtG(undoPrice)}</span>
              </div>
              <div className="shop-item__quantity-selector">
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={undoQuantity}
                  onChange={(e) => setUndoQuantity(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  className="shop-item__quantity-input"
                  disabled={!!pendingAction}
                />
              </div>
              <ItemButton
                price={undoPrice ? undoPrice * BigInt(undoQuantity) : undefined}
                buyAction={() => buyUndoMove(undoQuantity)}
                pendingKey="undo"
              />
            </div>
          </div>
        </div>

        {error && <p className="shop__error">{error}</p>}
      </section>
    );
  }

  // Cosmetics Category
  if (view === "cosmetics") {
    return (
      <section className="shop">
        <div className="shop__header">
          <button
            className="shop__back-btn"
            onClick={() => updateView("landing")}
          >
            ← Back
          </button>
          <div>
            <h2 className="shop__title">Cosmetics</h2>
            <p className="shop__subtitle">Personalize your game</p>
          </div>
          <div className="shop__balance">
            <div className="shop__balance-label">Balance</div>
            <div className="shop__balance-value">{fmtG(gdBalance)}</div>
          </div>
        </div>

        <div className="shop__category-tabs">
          <button
            className={`shop__category-tab ${activeCategory === "power-ups" ? "shop__category-tab--active" : ""}`}
            onClick={() => updateView("powerups", "power-ups")}
          >
            Power-Ups
          </button>
          <button
            className={`shop__category-tab ${activeCategory === "cosmetics" ? "shop__category-tab--active" : ""}`}
            onClick={() => updateView("cosmetics", "cosmetics")}
          >
            Cosmetics
          </button>
        </div>

        <div className="shop__items shop__items--cosmetics">
          {COSMETICS_CATALOG.map((cosmetic) => {
            const iconMap: Record<number, any> = {
              1: "tile",
              2: "fits",
              3: "flair",
              4: "goggles",
              5: "caps",
            };
            return (
            <div key={cosmetic.id} className="shop-item">
              <div className="shop-item__icon-wrapper">
                <ShopIcon type={iconMap[cosmetic.id]} size={110} />
              </div>
              <div className="shop-item__top">
                <p className="shop-item__name">{cosmetic.name}</p>
              </div>
              <div className="shop-item__content">
                <p className="shop-item__desc">
                  {cosmetic.category === 'tile' && 'Applies to the game board when equipped.'}
                  {cosmetic.category === 'avatar' && 'Avatar accessory.'}
                  {cosmetic.category === 'flair' && 'Renders next to your name on leaderboards.'}
                </p>
              </div>
              <div className="shop-item__footer">
                <div className="shop-item__price-section">
                  <span className="shop-item__price">{fmtG(cosmetic.price)}</span>
                </div>
                <ItemButton
                  price={cosmetic.price}
                  buyAction={() => buyCosmetic(cosmetic.id)}
                  pendingKey="cosmetic"
                />
              </div>
            </div>
            );
          })}
        </div>

        {error && <p className="shop__error">{error}</p>}
      </section>
    );
  }

  return null;
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
