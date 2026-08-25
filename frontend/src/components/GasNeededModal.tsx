import { useState } from "react";
import { useAuth } from "../auth/AuthContext";

interface Props {
  onClose: () => void;
}

// BlockSlide's Telegram group hands out small CELO top-ups for gas when the
// sponsored-gas flow doesn't cover a wallet automatically.
const TELEGRAM_GAS_URL = "https://t.me/blockslide_xyz/394";

// Shown when an on-chain action fails because the wallet has no CELO for gas.
// New email/social-login wallets start empty, so we surface the address with a
// one-tap copy and tell the user to top up — clearer than a failed transaction.
export default function GasNeededModal({ onClose }: Props) {
  const { address } = useAuth();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the address is still visible to copy manually */
    }
  };

  const openTelegram = () => {
    void copy();
    window.open(TELEGRAM_GAS_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="htp-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Gas needed"
      onClick={onClose}
    >
      <div className="htp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="htp-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <p className="htp-label">⛽ Gas needed</p>
        <h2 className="username-modal__title">Add a little CELO</h2>
        <p className="username-modal__desc">
          Copy your address, paste it in our Telegram group to get CELO, then
          come back and tap "I've topped up."
        </p>

        <p className="gas-modal__addr-label">Your wallet address</p>
        <button className="gas-modal__addr" onClick={copy} disabled={!address}>
          <span className="gas-modal__addr-text">{address ?? "Not connected"}</span>
          <span className="gas-modal__addr-copy">{copied ? "Copied ✓" : "Copy"}</span>
        </button>

        <div className="username-modal__actions username-modal__actions--stack">
          <button className="btn btn--secondary" onClick={openTelegram} disabled={!address}>
            Get gas in Telegram ↗
          </button>
          <button className="btn btn--primary" onClick={onClose}>
            I've topped up
          </button>
        </div>
      </div>
    </div>
  );
}
