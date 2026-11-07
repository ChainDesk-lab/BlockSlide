import type { ReactNode } from "react";
import type { BuyButtonState } from "../lib/shopState";

/** A status chip in the card's image corner. Only real state is shown (owned, active, credits). */
export interface ShopBadge {
  label: string;
  tone: "active" | "owned" | "info" | "muted";
}

/**
 * Original product artwork from the BlockSlide Figma design (public/shop-art). Shown full-bleed
 * like the design: scaled to fill the image band without distortion (object-fit: cover), with
 * `position` choosing which part stays in view when the band crops it.
 */
export interface ShopArt {
  src: string;
  /** Focus point for cropping, as CSS object-position (default "center"). */
  position?: string;
  /** "contain" shows the whole artwork (letterboxed on black) when filling the band would cut it. */
  fit?: "cover" | "contain";
}

export interface ShopCardProps {
  name: string;
  /** Fallback illustration, used when the product has no original artwork. */
  image: ReactNode;
  art?: ShopArt;
  /** The price as the chain reports it (e.g. "25 G$", "Loading…", "Unavailable"). */
  price: string;
  priceNote?: ReactNode;
  description: string;
  status?: string;
  badge?: ShopBadge | null;
  /** Anything that sits above the button (e.g. the undo quantity selector). */
  extra?: ReactNode;
  button: BuyButtonState;
  onAction?: (action: "approve" | "buy") => void;
  size?: "lg" | "sm";
}

export function CoinMark() {
  return (
    <svg className="shop-card__coin" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export default function ShopCard({ name, image, art, price, priceNote, description, status, badge, extra, button, onAction, size = "lg" }: ShopCardProps) {
  return (
    <article className={`shop-card shop-card--${size}`} aria-label={name}>
      <div className={`shop-card__media${art ? ` shop-card__media--art${art.fit === "contain" ? " shop-card__media--contain" : ""}` : ""}`}>
        {badge && <span className={`shop-card__badge shop-card__badge--${badge.tone}`}>{badge.label}</span>}
        {art ? (
          <img className={`shop-card__art${art.fit === "contain" ? " shop-card__art--contain" : ""}`} src={art.src} alt="" loading="lazy" decoding="async" style={art.position ? { objectPosition: art.position } : undefined} />
        ) : image}
      </div>
      <div className="shop-card__body">
        <h3 className="shop-card__name">{name}</h3>
        <p className="shop-card__price"><CoinMark />{price}</p>
        {priceNote}
        <p className="shop-card__desc">{description}</p>
        {status && <p className="shop-card__status">{status}</p>}
        <div className="shop-card__actions">
          {extra}
          <button
            className={`shop-card__btn shop-card__btn--${button.variant}`}
            disabled={button.disabled}
            onClick={button.action && onAction ? () => onAction(button.action!) : undefined}
            aria-busy={button.busy || undefined}
          >
            {button.busy ? <span className="spinner" aria-label="Waiting for the wallet" /> : button.label}
          </button>
        </div>
      </div>
    </article>
  );
}
