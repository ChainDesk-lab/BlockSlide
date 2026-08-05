import { useState } from "react";

type CategoryType = "power-ups" | "cosmetics";

const CATEGORY_MAP: Record<CategoryType, { svg: string; fallback: string }> = {
  "power-ups": { svg: "/shop-icons/category-power-ups.svg", fallback: "⚡" },
  "cosmetics": { svg: "/shop-icons/category-cosmetics.svg", fallback: "✨" },
};

interface CategoryIconProps {
  type: CategoryType;
  size?: number;
}

export function CategoryIcon({ type, size = 110 }: CategoryIconProps) {
  const [failed, setFailed] = useState(false);
  const { svg, fallback } = CATEGORY_MAP[type];

  if (failed) {
    return (
      <div
        className="category-icon category-icon--fallback"
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
      className="category-icon"
      style={{ width: `${size}px`, height: `${size}px` }}
      onError={() => setFailed(true)}
    />
  );
}
