"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAuth } from "../auth/AuthContext";
import { useSendGDollar } from "../hooks/useSendGDollar";
import { celoscanTx, checkSend, parseGAmount, shortAddress, G_DECIMALS } from "../lib/sendGDollar";

/**
 * "Send G$": move G$ from the player's BlockSlide wallet to any Celo address. Two steps (enter,
 * then confirm) because a transfer can't be undone. Works for email (Magic) and browser wallets.
 */
export default function SendGDollarModal({ balance, onClose }: { balance: string; onClose: () => void }) {
  const { address } = useAuth();
  const { send, status, reset } = useSendGDollar();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [touched, setTouched] = useState(false);

  // The balance comes from formatUnits, so it parses back to the exact wei amount.
  const balanceWei = parseGAmount(balance);
  const check = checkSend({ to, amount, from: address ?? undefined, balanceWei });
  const busy = status.phase === "signing" || status.phase === "confirming";
  const done = status.phase === "done";
  const fmt = (wei: bigint) => Number(formatUnits(wei, G_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 4 });

  const close = () => { if (!busy) { reset(); onClose(); } };

  return (
    <div className="htp-backdrop" role="dialog" aria-modal="true" aria-label="Send G$" onClick={close}>
      <div className="htp-modal send-g" onClick={(e) => e.stopPropagation()}>
        <button className="htp-close" onClick={close} aria-label="Close" disabled={busy}>✕</button>
        <p className="htp-label">Wallet</p>
        <h2 className="username-modal__title">Send G$</h2>

        {done ? (
          <>
            <p className="rewards__notice rewards__notice--ok">
              Sent! The G$ is on its way to {check.ok ? shortAddress(check.to) : "the address you entered"}.
            </p>
            <p className="rewards__help"><a href={celoscanTx(status.hash)} target="_blank" rel="noopener noreferrer">View the transaction on Celoscan ↗</a></p>
            <div className="rewards__actions"><button className="btn btn--primary" onClick={close}>Done</button></div>
          </>
        ) : step === "form" || !check.ok ? (
          <>
            <p className="username-modal__desc">Send G$ from your BlockSlide wallet to any wallet on Celo, such as MiniPay, MetaMask or the GoodDollar wallet.</p>
            <label className="send-g__label" htmlFor="send-g-to">Recipient address (Celo)</label>
            <input
              id="send-g-to" className="rewards__input" placeholder="0x…" value={to} autoComplete="off" spellCheck={false}
              onChange={(e) => setTo(e.target.value)} onBlur={() => setTouched(true)}
              aria-invalid={touched && !check.ok && check.field === "to"}
            />
            <label className="send-g__label" htmlFor="send-g-amount">
              Amount <span className="send-g__balance">Balance: {Number(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} G$</span>
            </label>
            <div className="send-g__amount">
              <input
                id="send-g-amount" className="rewards__input" inputMode="decimal" placeholder="0.00" value={amount}
                onChange={(e) => setAmount(e.target.value)} onBlur={() => setTouched(true)}
                aria-invalid={touched && !check.ok && check.field === "amount"}
              />
              <button type="button" className="rewards__link" onClick={() => setAmount(balance)}>Max</button>
            </div>
            {touched && !check.ok && <p className="send-g__error" role="alert">{check.message}</p>}
            <p className="rewards__help">You&apos;ll pay a small network fee in CELO. Only send to an address on the Celo network.</p>
            <div className="rewards__actions">
              <button className="btn btn--primary" disabled={!check.ok} onClick={() => { setTouched(true); if (check.ok) setStep("confirm"); }}>Review</button>
            </div>
          </>
        ) : (
          <>
            <div className="send-g__summary">
              <p><span>You send</span><strong>{fmt(check.amountWei)} G$</strong></p>
              <p><span>To</span><code>{check.to}</code></p>
              <p><span>Network</span><strong>Celo</strong></p>
            </div>
            <p className="rewards__notice">Check the address carefully. Transfers can&apos;t be reversed, and BlockSlide can&apos;t recover G$ sent to a wrong address.</p>
            {status.phase === "error" && (
              <p className="send-g__error" role="alert">
                {status.message}{" "}
                {status.hash && <a href={celoscanTx(status.hash)} target="_blank" rel="noopener noreferrer">Celoscan ↗</a>}
              </p>
            )}
            <div className="rewards__actions">
              <button
                className="btn btn--primary"
                disabled={busy || (status.phase === "error" && !!status.hash)}
                onClick={() => void send(check.to, check.amountWei)}
              >
                {status.phase === "signing" ? "Confirm in your wallet…" : status.phase === "confirming" ? "Sending…" : "Send G$"}
              </button>
              <button className="rewards__link" disabled={busy} onClick={() => { reset(); setStep("form"); }}>Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
