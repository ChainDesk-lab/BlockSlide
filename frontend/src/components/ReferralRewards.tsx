import { useId, useState } from "react";
import { isAddress } from "viem";
import type { PayoutDetails, PayoutRequestState, PayoutSummary } from "../hooks/useReferrals";

/**
 * Referral rewards on the player's own profile (rules in lib/referrals.ts): how many referrals count,
 * progress toward the minimum, and the payment request. Presentational: the caller supplies the
 * counts and the request action. The form state here is only what the player is typing.
 */

const g = (n: number) => n.toLocaleString("en-US");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const CELOSCAN = "https://celoscan.io";

export interface ReferralCountsView { joined: number; played: number | null; verified: number | null; eligible: number | null }

export default function ReferralRewards({ counts, payout, connected, request, onRequest, onDone, details = null, onShowDetails }: {
  counts: ReferralCountsView | null;
  payout: PayoutSummary | null;
  /** The signed-in wallet, the default payout wallet. */
  connected: string;
  request: PayoutRequestState;
  onRequest: (payTo: string) => void;
  onDone: () => void;
  /** Private details of the latest decision (transaction, reason), once the player has signed to see them. */
  details?: PayoutDetails | null;
  /** Asks the wallet to sign so the private details (and the invitee list) can be shown. */
  onShowDetails?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [tooFew, setTooFew] = useState(false);
  const [useOther, setUseOther] = useState(false);
  const [other, setOther] = useState("");
  const [touched, setTouched] = useState(false);

  if (!payout || !counts) return null;
  const { minReferrals, rewardPerReferralG, minAmountG, available, availableAmountG, pending, paid, lastDecision } = payout;
  // Played or verified can't be read right now (e.g. the chain data is catching up): don't claim 0.
  const unknown = counts.played === null || counts.verified === null;
  const enough = !unknown && available >= minReferrals;
  const progress = Math.min(available, minReferrals);
  const otherValid = isAddress(other.trim()) && !/^0x0{40}$/i.test(other.trim());
  const payTo = useOther ? other.trim() : connected;
  const busy = request.status === "signing" || request.status === "sending";

  const onRequestClick = () => {
    if (!enough) { setTooFew(true); setOpen(false); return; }
    setTooFew(false);
    setOpen(true);
  };
  const submit = () => {
    setTouched(true);
    if (useOther && !otherValid) return;
    onRequest(payTo);
  };
  const stat = (n: number | null) => (n === null ? "—" : g(n));

  return (
    <div className="rewards" aria-labelledby={`${id}-title`}>
      <div className="rewards__head">
        <h3 className="rewards__title" id={`${id}-title`}>Referral rewards</h3>
        <span className="rewards__rate">{g(rewardPerReferralG)} G$ per referral</span>
      </div>
      <p className="rewards__rule">
        A referral counts once the player you invited has <strong>played a game</strong> and is <strong>verified with GoodDollar</strong>.
        Request a payment from {minReferrals} referrals ({g(minAmountG)} G$).
      </p>

      <dl className="rewards__stats">
        <div><dt>Joined</dt><dd>{stat(counts.joined)}</dd></div>
        <div><dt>Played</dt><dd>{stat(counts.played)}</dd></div>
        <div><dt>Verified</dt><dd>{stat(counts.verified)}</dd></div>
        <div className="rewards__stat--count" title="Played and verified: these count toward payment"><dt>Eligible</dt><dd>{stat(counts.eligible)}</dd></div>
      </dl>

      {request.status === "sent" ? (
        <div className="rewards__notice rewards__notice--ok" role="status">
          <p><strong>Request sent:</strong> {g(request.amountG)} G$ for {request.count} referrals, to {short(request.payTo)}.</p>
          <p>We review every request before paying. You&apos;ll see it marked paid here.</p>
          <button type="button" className="rewards__link" onClick={onDone}>Done</button>
        </div>
      ) : pending ? (
        <div className="rewards__notice" role="status">
          <p><strong>Payment requested</strong> on {day(pending.createdAt)}: {g(pending.amountG)} G$ for {pending.count} referrals.</p>
          <p>Waiting for review. You can request again once it&apos;s decided.</p>
        </div>
      ) : (
        <>
          <div className="rewards__progress">
            <div
              className="rewards__bar" role="progressbar" aria-valuemin={0} aria-valuemax={minReferrals} aria-valuenow={progress}
              aria-label={`${available} of ${minReferrals} referrals ready to request`}
            >
              <span style={{ width: `${(progress / minReferrals) * 100}%` }} />
            </div>
            <p className="rewards__progress-text">
              {unknown
                ? <>Checking your referrals…</>
                : enough
                  ? <><strong>{available}</strong> referrals ready: <strong>{g(availableAmountG)} G$</strong></>
                  : <><strong>{available}</strong> of {minReferrals} ready to request</>}
            </p>
          </div>

          {!open && (
            <button type="button" className="rewards__btn" onClick={onRequestClick} aria-describedby={tooFew ? `${id}-few` : undefined}>
              Request payment
            </button>
          )}
          {tooFew && !open && (
            <p className="rewards__notice rewards__notice--warn" id={`${id}-few`} role="alert">
              {unknown ? (
                <>Your referrals can&apos;t be checked right now. Please try again in a few minutes.</>
              ) : (
                <>
                  You need at least <strong>{minReferrals} referrals</strong> who have played and are verified before you can request a
                  payment ({g(minAmountG)} G$). You have {available}, so {minReferrals - available} more to go.
                </>
              )}
            </p>
          )}

          {open && (
            <form className="rewards__form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
              <p className="rewards__summary">
                You&apos;re requesting <strong>{g(availableAmountG)} G$</strong> for {available} referrals.
              </p>
              <fieldset className="rewards__fieldset" disabled={busy}>
                <legend>Where should we send your G$?</legend>
                <label className="rewards__choice">
                  <input type="radio" name={`${id}-payto`} checked={!useOther} onChange={() => setUseOther(false)} />
                  <span>My connected wallet <code>{short(connected)}</code></span>
                </label>
                <label className="rewards__choice">
                  <input type="radio" name={`${id}-payto`} checked={useOther} onChange={() => setUseOther(true)} />
                  <span>Another wallet</span>
                </label>
                {useOther && (
                  <div className="rewards__field">
                    <label htmlFor={`${id}-addr`} className="rewards__sr">Wallet address to be paid</label>
                    <input
                      id={`${id}-addr`} className="rewards__input" inputMode="text" autoComplete="off" spellCheck={false}
                      placeholder="0x… wallet address on Celo" value={other}
                      onChange={(e) => setOther(e.target.value)} onBlur={() => setTouched(true)}
                      aria-invalid={touched && !otherValid} aria-describedby={`${id}-addr-help`}
                    />
                    <p className="rewards__help" id={`${id}-addr-help`}>
                      {touched && !otherValid ? "Enter a valid Celo wallet address (0x followed by 40 characters)." : "G$ is sent on Celo. Check the address carefully: payments can't be reversed."}
                    </p>
                  </div>
                )}
              </fieldset>
              {request.status === "error" && <p className="rewards__notice rewards__notice--warn" role="alert">{request.message}</p>}
              <div className="rewards__actions">
                <button type="submit" className="rewards__btn" disabled={busy || (useOther && touched && !otherValid)}>
                  {request.status === "signing" ? "Confirm in your wallet…" : request.status === "sending" ? "Sending…" : "Sign and send request"}
                </button>
                <button type="button" className="rewards__link" onClick={() => { setOpen(false); onDone(); }} disabled={busy}>Cancel</button>
              </div>
              <p className="rewards__help">Signing is free and sends nothing. It proves the request comes from you.</p>
            </form>
          )}
        </>
      )}

      {(paid.count > 0 || lastDecision?.status === "rejected") && (
        <div className="rewards__history">
          {paid.count > 0 && <p>Paid so far: <strong>{g(paid.amountG)} G$</strong> for {paid.count} referrals.</p>}
          {lastDecision?.status === "paid" && (
            details?.status === "paid" && details.txHash
              ? <p>Last payment: <a href={`${CELOSCAN}/tx/${details.txHash}`} target="_blank" rel="noopener noreferrer">view on Celoscan ↗</a></p>
              : onShowDetails && <p><button type="button" className="rewards__link" onClick={onShowDetails}>Show payment details</button></p>
          )}
          {lastDecision?.status === "rejected" && !pending && (
            <p>
              Your last request{lastDecision.decidedAt ? ` (${day(lastDecision.decidedAt)})` : ""} wasn&apos;t approved
              {details?.status === "rejected" ? (details.note ? `: ${details.note}` : ".") : "."} Its referrals can be requested again.
              {details?.status !== "rejected" && onShowDetails && <> <button type="button" className="rewards__link" onClick={onShowDetails}>See why</button></>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
