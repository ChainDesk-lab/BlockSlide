import { useState } from "react";

type IconType = "shield" | "boost2" | "boost5" | "undo" | "tile" | "fits" | "flair" | "goggles" | "caps";

const ICON_MAP: Record<IconType, { svg: string; fallback: string }> = {
  shield: { svg: "/shop-icons/streak-shield.svg", fallback: "🛡️" },
  boost2: { svg: "/shop-icons/xp-boost-2x.svg", fallback: "⚡" },
  boost5: { svg: "/shop-icons/xp-boost-5x.svg", fallback: "⚡" },
  undo: { svg: "/shop-icons/undo-step.svg", fallback: "↶" },
  tile: { svg: "/shop-icons/tile-skin.svg", fallback: "🎨" },
  fits: { svg: "/shop-icons/fits.svg", fallback: "👔" },
  flair: { svg: "/shop-icons/leaderboard-flair.svg", fallback: "⭐" },
  goggles: { svg: "/shop-icons/goggles.svg", fallback: "🥽" },
  caps: { svg: "/shop-icons/caps.svg", fallback: "🧢" },
};

interface ShopIconProps {
  type: IconType;
  size?: number;
}

export function ShopIcon({ type, size = 110 }: ShopIconProps) {
  const [failed, setFailed] = useState(false);
  const { svg, fallback } = ICON_MAP[type];

  if (failed) {
    return (
      <div
        className="shop-icon shop-icon--fallback"
        style={{ fontSize: `${size * 0.7}px` }}
      >
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={svg}
      alt={type}
      className="shop-icon"
      style={{ width: `${size}px`, height: `${size}px` }}
      onError={() => setFailed(true)}
    />
  );
}
