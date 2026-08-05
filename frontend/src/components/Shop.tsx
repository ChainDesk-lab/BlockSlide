import { useState } from "react";
import { useAccount } from "wagmi";
import { useShop } from "../hooks/useShop";
import { ShieldIcon, BoltIcon, FlameIcon } from "./icons";
import { IconBadge } from "./IconBadge";
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

export default function Shop() {
  const { isConnected } = useAccount();
  const [undoQuantity, setUndoQuantity] = useState(1);
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

    // Block purchases if price is not set (0 or undefined)
    if (price === undefined || price === 0n) {
      return (
        <button className="shop-btn shop-btn--disabled" disabled>
          Price not set
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

  return (
    <section className="shop">
      {/* Header */}
      <div className="shop__header">
        <div>
          <h2 className="shop__title">Shop</h2>
          <p className="shop__subtitle">Boost your game with power-ups</p>
        </div>
        <div className="shop__balance">
          <div className="shop__balance-label">Balance</div>
          <div className="shop__balance-value">{fmtG(gdBalance)}</div>
        </div>
      </div>

      {/* Player stats row */}
      <div className="shop__stats">
        <div className="shop__stat">
          <span className="shop__stat-label">XP</span>
          <span className="shop__stat-value">{Number(playerXp).toLocaleString()}</span>
        </div>
        <div className="shop__stat">
          <span className="shop__stat-label">Streak</span>
          <span className="shop__stat-value">{Number(streakCount)} day{streakCount !== 1n ? "s" : ""}</span>
        </div>
        <div className="shop__stat">
          <span className="shop__stat-label">Shields</span>
          <span className="shop__stat-value">{Number(shieldCount)}</span>
        </div>
      </div>

      {/* Items Grid */}
      <div className="shop__items">

        {/* Streak Shield */}
        <div className="shop-item">
          <div className="shop-item__top">
            <IconBadge icon={<ShieldIcon size={32} />} size="lg" />
            <p className="shop-item__name">Streak Shield</p>
          </div>
          <p className="shop-item__desc">
            Protects your streak for one missed day. Shields stack in your inventory.
          </p>
          <p className="shop-item__status">
            {Number(shieldCount) > 0
              ? `${Number(shieldCount)} shield${shieldCount !== 1n ? "s" : ""} in inventory`
              : "No shields"}
          </p>
          <div className="shop-item__price-section">
            <span className="shop-item__price">{fmtG(shieldPrice)}</span>
          </div>
          <ItemButton price={shieldPrice} buyAction={buyShield} pendingKey="shield" />
        </div>

        {/* 2x XP Boost */}
        <div className="shop-item">
          <div className="shop-item__top">
            <IconBadge icon={<BoltIcon size={32} />} size="lg" />
            <p className="shop-item__name">2x XP Boost</p>
          </div>
          <p className="shop-item__desc">
            Doubles all XP earned from games for 5 hours.
          </p>
          <p className="shop-item__status">
            {boostActive && xpBoost?.multiplier === 2
              ? fmtTimeLeft(xpBoost.expiry)
              : "Not active"}
          </p>
          <div className="shop-item__price-section">
            <span className="shop-item__price">{fmtG(boost2xPrice)}</span>
          </div>
          <ItemButton price={boost2xPrice} buyAction={() => buyBoost(2)} pendingKey="boost2" />
        </div>

        {/* 5x XP Boost */}
        <div className="shop-item">
          <div className="shop-item__top">
            <IconBadge icon={<FlameIcon size={32} />} size="lg" />
            <p className="shop-item__name">5x XP Boost</p>
          </div>
          <p className="shop-item__desc">
            Multiplies all XP earned from games by 5 for 5 hours.
          </p>
          <p className="shop-item__status">
            {boostActive && xpBoost?.multiplier === 5
              ? fmtTimeLeft(xpBoost.expiry)
              : "Not active"}
          </p>
          <div className="shop-item__price-section">
            <span className="shop-item__price-label">Price:</span>
            <span className="shop-item__price">{fmtG(boost5xPrice)}</span>
          </div>
          <ItemButton price={boost5xPrice} buyAction={() => buyBoost(5)} pendingKey="boost5" />
        </div>

        {/* Undo Move (V6) */}
        <div className="shop-item">
          <div className="shop-item__top">
            <IconBadge icon={<span style={{ fontSize: '32px' }}>↶</span>} size="lg" />
            <p className="shop-item__name">Undo Move</p>
          </div>
          <p className="shop-item__desc">
            Revert your last move during gameplay. Consumable — use within a game session.
          </p>
          <p className="shop-item__status">
            {Number(undoCredits) > 0
              ? `${Number(undoCredits)} credit${undoCredits !== 1n ? "s" : ""} available`
              : "No credits"}
          </p>
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

        {/* Cosmetics Section Header */}
        <div style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
          <h3 className="shop__section-title">Cosmetics</h3>
          <p className="shop__section-subtitle">Customize your avatar and gameplay</p>
        </div>

        {/* Avatar Accessories */}
        {COSMETICS_CATALOG.avatarAccessories.map((cosmetic) => (
          <div key={cosmetic.id} className="shop-item">
            <div className="shop-item__top">
              <IconBadge icon={<span style={{ fontSize: '32px' }}>{cosmetic.emoji}</span>} size="lg" />
              <p className="shop-item__name">{cosmetic.name}</p>
            </div>
            <p className="shop-item__desc">Avatar accessory. Equip from your profile.</p>
            <p className="shop-item__status">
              {Math.random() < 0.3 ? '✓ Owned' : 'Available'}
            </p>
            <div className="shop-item__price-section">
              <span className="shop-item__price">{fmtG(cosmetic.price)}</span>
            </div>
            <ItemButton
              price={cosmetic.price}
              buyAction={() => buyCosmetic(cosmetic.id)}
              pendingKey="cosmetic"
            />
          </div>
        ))}

      </div>

      {error && <p className="shop__error">{error}</p>}
    </section>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
