import { useAccount } from "wagmi";
import { useShop } from "../hooks/useShop";
import { ShieldIcon, BoltIcon, FlameIcon } from "./icons";
import { IconBadge } from "./IconBadge";

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
  const {
    shieldPrice, boost2xPrice, boost5xPrice,
    shieldCount, xpBoost, boostActive,
    playerXp, streakCount,
    gdBalance,
    pendingAction,
    approve, buyShield, buyBoost,
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
    pendingKey: "shield" | "boost2" | "boost5";
  }) {
    const pending = isPending(pendingKey);
    const approvePending = isPending("approve");

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
            Doubles all XP earned from games for 24 hours.
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
            Multiplies all XP earned from games by 5 for 24 hours.
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

      </div>

      {error && <p className="shop__error">{error}</p>}
    </section>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
