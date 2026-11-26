"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { encodeFunctionData, erc20Abi, toHex } from "viem";
import { useWriteContract } from "wagmi";
import { useAuth } from "../../../src/auth/AuthContext";
import { useSigner } from "../../../src/hooks/useSigner";
import { useContractPublicClient } from "../../../src/hooks/useContractData";
import { isAdminWallet } from "../../../src/config/admins";
import { G_DOLLAR_ADDRESS } from "../../../src/lib/constants";
import { adminLoginMessage } from "../../../src/lib/referrals";
import { isUserRejection } from "../../../src/hooks/useReferrals";
import "../../../src/styles/admin.css";

/**
 * Referral payment review, for BlockSlide admins only (config/admins.ts).
 *
 * Shown only to a signed-in admin wallet, which proves itself once with a free signature
 * (/api/admin/session) for a 12-hour session kept in this tab. While open, the page checks for new
 * requests every POLL_MS and alerts on new ones (banner, chime, tab title, desktop notification if
 * allowed); Telegram covers the admins when it's closed.
 *
 * Paying: the admin sends the exact G$ amount to the player's payout wallet from their own wallet,
 * or pastes a payment made elsewhere. Either way the server checks the transaction on Celo before
 * the request is marked paid (lib/payoutVerify.ts).
 */

interface AdminRequest {
  id: string;
  inviter: string;
  inviterUsername: string | null;
  payTo: string;
  invitees: { address: string; username: string | null }[];
  count: number;
  amountG: number;
  rewardPerReferralG: number;
  status: "pending" | "paid" | "rejected";
  createdAt: number;
  decidedAt?: number;
  decidedBy?: string;
  txHash?: string;
  paidWei?: string;
  note?: string;
  snapshot: { joined: number; played: number; verified: number; eligible: number };
}
interface Session { token: string; address: string; expiresAt: number }

const SESSION_STORE = "bs_admin_session";
const SEEN_STORE = "bs_admin_seen_requests";
const POLL_MS = 15_000;
const TITLE = "Referral payments · BlockSlide";
const g = (n: number) => n.toLocaleString("en-US");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const CELOSCAN = "https://celoscan.io";

const readJson = <T,>(store: Storage | undefined, key: string): T | null => {
  try { const v = store?.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
};
const writeJson = (store: Storage | undefined, key: string, value: unknown) => {
  try { if (value === null) store?.removeItem(key); else store?.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
};

/** A short two-note chime, generated (no audio file). Silently skipped where audio isn't allowed. */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator(), gain = ctx.createGain();
      o.frequency.value = freq; o.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      o.connect(gain).connect(ctx.destination); o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch { /* no audio */ }
}

export default function AdminPayoutsPage() {
  const { address, isReady, loading } = useAuth();
  const { signer } = useSigner();
  const isAdmin = isAdminWallet(address);
  // A returning admin's wallet reconnects a moment after the page loads: wait before refusing.
  const [settled, setSettled] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSettled(true), 2500); return () => clearTimeout(t); }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [signing, setSigning] = useState(false);
  const [requests, setRequests] = useState<AdminRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [fresh, setFresh] = useState<AdminRequest[]>([]);
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | "unsupported">("default");
  const seen = useRef<Set<string> | null>(null);

  // A stored session counts only for the wallet that's connected now.
  useEffect(() => {
    const s = readJson<Session>(typeof window !== "undefined" ? sessionStorage : undefined, SESSION_STORE);
    setSession(s && address && s.address === address.toLowerCase() && s.expiresAt > Date.now() ? s : null);
    setNotifyPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, [address]);

  const signOut = useCallback(() => {
    writeJson(sessionStorage, SESSION_STORE, null);
    setSession(null); setRequests(null);
  }, []);

  const signIn = async () => {
    if (!address || !signer?.account) { setError("Your wallet isn't ready yet. Try again in a moment."); return; }
    setError(null); setSigning(true);
    try {
      const issuedAt = new Date().toISOString();
      let signature: string;
      try {
        signature = await signer.signMessage({ account: signer.account, message: adminLoginMessage(address, issuedAt) });
      } catch (e) {
        setSigning(false);
        if (!isUserRejection(e)) setError("Your wallet couldn't sign. Check it's unlocked and connected, then try again.");
        return;
      }
      const res = await fetch("/api/admin/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, issuedAt, signature }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Session> & { message?: string };
      if (!res.ok || !json.token) throw new Error(json.message ?? "Sign-in was refused.");
      const s = { token: json.token, address: address.toLowerCase(), expiresAt: json.expiresAt as number };
      writeJson(sessionStorage, SESSION_STORE, s);
      setSession(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setSigning(false);
    }
  };

  const load = useCallback(async (s: Session) => {
    const res = await fetch("/api/referrals/payouts", { headers: { Authorization: `Bearer ${s.token}` }, cache: "no-store" }).catch(() => null);
    if (!res) { setError("Couldn't reach the server. Retrying…"); return; }
    if (res.status === 401) { signOut(); setError("Your admin session ended. Sign in again."); return; }
    if (!res.ok) { setError(`Couldn't load requests (${res.status}). Retrying…`); return; }
    setError(null);
    const json = (await res.json()) as { requests: AdminRequest[] };
    setRequests(json.requests);

    // Alerts for pending requests this browser hasn't seen before.
    const pending = json.requests.filter((r) => r.status === "pending");
    if (!seen.current) {
      const stored = readJson<string[]>(localStorage, SEEN_STORE);
      // First visit on this browser: what's already there is known, not new.
      seen.current = new Set(stored ?? pending.map((r) => r.id));
      if (!stored) writeJson(localStorage, SEEN_STORE, [...seen.current]);
    }
    const newOnes = pending.filter((r) => !seen.current!.has(r.id));
    if (newOnes.length) {
      newOnes.forEach((r) => seen.current!.add(r.id));
      writeJson(localStorage, SEEN_STORE, [...seen.current].slice(-500));
      setFresh((f) => [...newOnes, ...f]);
      chime();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const r of newOnes) {
          try {
            new Notification("New referral payment request", {
              body: `${r.inviterUsername ?? short(r.inviter)} requested ${g(r.amountG)} G$ for ${r.count} referrals.`,
              tag: r.id,
            });
          } catch { /* notifications unavailable */ }
        }
      }
    }
  }, [signOut]);

  useEffect(() => {
    if (!session) return;
    load(session);
    const t = setInterval(() => load(session), POLL_MS);
    return () => clearInterval(t);
  }, [session, load]);

  const pendingCount = (requests ?? []).filter((r) => r.status === "pending").length;
  useEffect(() => {
    document.title = pendingCount ? `(${pendingCount}) ${TITLE}` : TITLE;
    return () => { document.title = "BlockSlide"; };
  }, [pendingCount]);

  const enableAlerts = async () => {
    if (typeof Notification === "undefined") return;
    setNotifyPermission(await Notification.requestPermission());
  };

  const decide = async (id: string, status: "paid" | "rejected", txHash: string, note: string): Promise<string | null> => {
    if (!session) return "Signed out.";
    const res = await fetch("/api/referrals/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ id, status, txHash: txHash || undefined, note: note || undefined }),
    }).catch(() => null);
    if (!res) return "Couldn't reach the server.";
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) { signOut(); return "Your admin session ended. Sign in again."; }
    if (!res.ok) return json.error ?? `Failed (${res.status}).`;
    await load(session);
    return null;
  };

  // ── Not an admin: nothing to see ────────────────────────────────────────────
  if (!isAdmin && (!isReady || loading || !settled)) {
    return <main className="main"><div className="page admin"><p className="admin__hint">Loading…</p></div></main>;
  }
  if (!isAdmin) {
    return (
      <main className="main">
        <div className="page admin">
          <div className="card admin__empty">
            <p>This page isn&apos;t available.</p>
            <p className="admin__hint"><Link href="/">Back to BlockSlide</Link></p>
          </div>
        </div>
      </main>
    );
  }

  const shown = (requests ?? []).filter((r) => filter === "all" || r.status === "pending");

  return (
    <main className="main">
      <div className="page admin">
        <header className="admin__head">
          <div>
            <p className="kicker">Admin</p>
            <h1 className="admin__title">Referral payments</h1>
            <p className="admin__sub">
              Requests from players with 10 or more referrals who have played and are verified. Pay from your wallet; the payment is
              checked on Celo before the request is marked paid.
            </p>
          </div>
          {session && <button type="button" className="admin__ghost" onClick={signOut}>Sign out</button>}
        </header>

        {!session ? (
          <div className="card admin__unlock">
            <p className="admin__label">Admin sign-in</p>
            <p className="admin__hint">
              Connected as <code>{address}</code>. Sign a message with this wallet to open the admin tools for {12} hours. It&apos;s free and sends nothing.
            </p>
            <button type="button" className="admin__btn" onClick={signIn} disabled={signing}>{signing ? "Confirm in your wallet…" : "Sign in as admin"}</button>
            {error && <p className="admin__error" role="alert">{error}</p>}
          </div>
        ) : (
          <>
            <div className="admin__alerts">
              <span className="admin__live" aria-live="polite"><span className="admin__dot" aria-hidden="true" /> Live · checks every 15 seconds</span>
              {notifyPermission === "default" && <button type="button" className="admin__ghost admin__ghost--sm" onClick={enableAlerts}>Turn on desktop alerts</button>}
              {notifyPermission === "granted" && <span className="admin__muted">Desktop alerts on</span>}
              {notifyPermission === "denied" && <span className="admin__muted">Desktop alerts are blocked in this browser&apos;s settings</span>}
            </div>

            {fresh.length > 0 && (
              <div className="admin__banner" role="status">
                <strong>{fresh.length === 1 ? "New payment request" : `${fresh.length} new payment requests`}</strong>
                <ul>{fresh.slice(0, 5).map((r) => <li key={r.id}>{r.inviterUsername ?? short(r.inviter)}: {g(r.amountG)} G$ for {r.count} referrals</li>)}</ul>
                <button type="button" className="admin__link" onClick={() => setFresh([])}>Got it</button>
              </div>
            )}

            <div className="admin__toolbar">
              <div className="admin__tabs" role="group" aria-label="Show">
                <button type="button" className={`admin__tab ${filter === "pending" ? "admin__tab--on" : ""}`} aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>Pending ({pendingCount})</button>
                <button type="button" className={`admin__tab ${filter === "all" ? "admin__tab--on" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All ({requests?.length ?? 0})</button>
              </div>
              <button type="button" className="admin__ghost" onClick={() => session && load(session)}>Refresh</button>
            </div>
            {error && <p className="admin__error" role="alert">{error}</p>}
            {requests === null && !error && <p className="admin__hint">Loading…</p>}
            {requests !== null && shown.length === 0 && <p className="card admin__empty">{filter === "pending" ? "No requests waiting for review." : "No requests yet."}</p>}
            <ul className="admin__list">
              {shown.map((r) => <RequestCard key={r.id} r={r} admin={address as string} onDecide={decide} />)}
            </ul>
          </>
        )}
        <p className="admin__hint"><Link href="/stats">Back to Stats</Link></p>
      </div>
    </main>
  );
}

type PayState =
  | { step: "idle" } | { step: "confirm" } | { step: "wallet" }
  | { step: "mining"; hash: string } | { step: "checking"; hash: string }
  | { step: "error"; message: string; hash?: string };

function RequestCard({ r, admin, onDecide }: {
  r: AdminRequest;
  admin: string;
  onDecide: (id: string, s: "paid" | "rejected", tx: string, note: string) => Promise<string | null>;
}) {
  const publicClient = useContractPublicClient();
  const { writeContractAsync } = useWriteContract();
  const { authType } = useAuth();
  const { signer } = useSigner();
  const [pay, setPay] = useState<PayState>({ step: "idle" });
  const [balance, setBalance] = useState<bigint | null>(null);
  const [mode, setMode] = useState<null | "paste" | "reject">(null);
  const [tx, setTx] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showInvitees, setShowInvitees] = useState(false);
  const amountWei = BigInt(r.amountG) * 10n ** 18n;
  const txOk = /^0x[0-9a-fA-F]{64}$/.test(tx.trim());
  const s = r.snapshot;

  useEffect(() => {
    if (r.status !== "pending" || !publicClient) return;
    publicClient.readContract({ address: G_DOLLAR_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [admin as `0x${string}`] })
      .then(setBalance).catch(() => setBalance(null));
  }, [r.status, publicClient, admin, pay.step]);

  const enough = balance === null || balance >= amountWei;

  /** Records the payment, retrying briefly if Celo's nodes haven't all seen the transaction yet. */
  const record = async (hash: string) => {
    setPay({ step: "checking", hash });
    for (let attempt = 0; attempt < 4; attempt++) {
      const e = await onDecide(r.id, "paid", hash, "");
      if (!e) { setPay({ step: "idle" }); return; }
      if (!/isn't on Celo yet/.test(e) || attempt === 3) { setPay({ step: "error", message: e, hash }); return; }
      await new Promise((res) => setTimeout(res, 4000));
    }
  };

  const sendPayment = async () => {
    setPay({ step: "wallet" });
    let hash: `0x${string}`;
    try {
      const req = { address: G_DOLLAR_ADDRESS, abi: erc20Abi, functionName: "transfer" as const, args: [r.payTo as `0x${string}`, amountWei] as const };
      if (authType !== "magic") {
        hash = await writeContractAsync(req);
      } else {
        if (!signer || !publicClient) throw new Error("Your wallet is still connecting. Try again in a moment.");
        const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: req.args });
        const [gas, gasPrice] = await Promise.all([
          publicClient.estimateGas({ account: admin as `0x${string}`, to: G_DOLLAR_ADDRESS, data }),
          publicClient.getGasPrice(),
        ]);
        hash = (await (signer as unknown as { request: (a: unknown) => Promise<string> }).request({
          method: "eth_sendTransaction",
          params: [{ from: admin, to: G_DOLLAR_ADDRESS, data, gas: toHex((gas * 12n) / 10n), gasPrice: toHex((gasPrice * 12n) / 10n) }],
        })) as `0x${string}`;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPay(isUserRejection(e) ? { step: "idle" } : { step: "error", message: /insufficient/i.test(msg) ? "Your wallet doesn't have enough G$ or CELO for gas." : "The payment couldn't be sent from your wallet." });
      return;
    }
    setPay({ step: "mining", hash });
    try {
      const receipt = await publicClient!.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success") { setPay({ step: "error", message: "The payment transaction failed on Celo; no G$ was sent.", hash }); return; }
    } catch {
      setPay({ step: "error", message: "Celo hasn't confirmed the payment yet. Use 'Check again' in a moment.", hash });
      return;
    }
    await record(hash);
  };

  const submitOther = async () => {
    setBusy(true); setErr(null);
    const e = await onDecide(r.id, mode === "paste" ? "paid" : "rejected", mode === "paste" ? tx.trim() : "", mode === "reject" ? note.trim() : "");
    setBusy(false);
    if (e) setErr(e); else setMode(null);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(r.payTo); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  const paying = pay.step === "wallet" || pay.step === "mining" || pay.step === "checking";

  return (
    <li className={`card admin__req admin__req--${r.status}`}>
      <div className="admin__req-top">
        <div className="admin__who">
          <Link href={`/profile/${r.inviter}`} className="admin__name">{r.inviterUsername ?? short(r.inviter)}</Link>
          <span className="admin__muted"><code>{r.inviter}</code> · requested {when(r.createdAt)}</span>
        </div>
        <span className={`admin__status admin__status--${r.status}`}>{r.status === "pending" ? "Pending" : r.status === "paid" ? "Paid" : "Rejected"}</span>
      </div>

      <div className="admin__amount">
        <strong>{g(r.amountG)} G$</strong>
        <span className="admin__muted">{r.count} referrals × {g(r.rewardPerReferralG)} G$</span>
      </div>

      <div className="admin__payto">
        <span className="admin__label">Pay to</span>
        <code className="admin__addr">{r.payTo}</code>
        <button type="button" className="admin__ghost admin__ghost--sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <span className={`admin__tag ${r.payTo === r.inviter ? "" : "admin__tag--warn"}`}>{r.payTo === r.inviter ? "their own wallet" : "a different wallet"}</span>
      </div>

      <dl className="admin__counts">
        <div><dt>Joined</dt><dd>{g(s.joined)}</dd></div>
        <div><dt>Played</dt><dd>{g(s.played)}</dd></div>
        <div><dt>Verified</dt><dd>{g(s.verified)}</dd></div>
        <div><dt>Played + verified</dt><dd>{g(s.eligible)}</dd></div>
      </dl>

      <button type="button" className="admin__link" aria-expanded={showInvitees} onClick={() => setShowInvitees((v) => !v)}>
        {showInvitees ? "Hide" : "Show"} the {r.count} referrals in this request
      </button>
      {showInvitees && (
        <ol className="admin__invitees">
          {r.invitees.map((i) => <li key={i.address}><Link href={`/profile/${i.address}`} title={i.address}>{i.username ?? short(i.address)}</Link></li>)}
        </ol>
      )}

      {r.status !== "pending" && (
        <p className="admin__muted">
          {r.status === "paid" ? "Paid and confirmed on Celo" : "Rejected"}
          {r.decidedBy && <> by {r.decidedBy === "owner key" ? "the owner key" : short(r.decidedBy)}</>}
          {r.decidedAt ? ` · ${when(r.decidedAt)}` : ""}
          {r.txHash && <> · <a href={`${CELOSCAN}/tx/${r.txHash}`} target="_blank" rel="noopener noreferrer">transaction ↗</a></>}
          {r.note && <> · {r.note}</>}
        </p>
      )}

      {r.status === "pending" && (
        <div className="admin__pay">
          {pay.step === "idle" && !mode && (
            <>
              <div className="admin__actions">
                <button type="button" className="admin__btn admin__btn--pay" onClick={() => setPay({ step: "confirm" })} disabled={!enough}>
                  Pay {g(r.amountG)} G$ with my wallet
                </button>
                <button type="button" className="admin__ghost" onClick={() => setMode("paste")}>Paid another way</button>
                <button type="button" className="admin__ghost" onClick={() => setMode("reject")}>Reject</button>
              </div>
              {balance !== null && (
                <p className={enough ? "admin__hint" : "admin__error"}>
                  Your wallet has {g(Number(balance / 10n ** 18n))} G${enough ? "." : `: not enough for this payment.`}
                </p>
              )}
            </>
          )}
          {pay.step === "confirm" && (
            <div className="admin__decide">
              <p className="admin__confirm">
                Send <strong>{g(r.amountG)} G$</strong> from your wallet <code>{short(admin)}</code> to <code>{r.payTo}</code>?
                Payments on Celo can&apos;t be reversed.
              </p>
              <div className="admin__actions">
                <button type="button" className="admin__btn admin__btn--pay" onClick={sendPayment}>Send payment</button>
                <button type="button" className="admin__ghost" onClick={() => setPay({ step: "idle" })}>Cancel</button>
              </div>
            </div>
          )}
          {paying && (
            <p className="admin__progress" role="status">
              {pay.step === "wallet" && "Confirm the payment in your wallet…"}
              {pay.step === "mining" && <>Payment sent. Waiting for Celo to confirm… <a href={`${CELOSCAN}/tx/${pay.hash}`} target="_blank" rel="noopener noreferrer">view ↗</a></>}
              {pay.step === "checking" && "Checking the payment on Celo…"}
            </p>
          )}
          {pay.step === "error" && (
            <div className="admin__decide">
              <p className="admin__error" role="alert">{pay.message}</p>
              <div className="admin__actions">
                {pay.hash && <button type="button" className="admin__btn" onClick={() => record(pay.hash as string)}>Check again</button>}
                {pay.hash && <a className="admin__ghost" href={`${CELOSCAN}/tx/${pay.hash}`} target="_blank" rel="noopener noreferrer">View transaction</a>}
                <button type="button" className="admin__ghost" onClick={() => setPay({ step: "idle" })}>Back</button>
              </div>
            </div>
          )}
          {mode && pay.step === "idle" && (
            <div className="admin__decide">
              {mode === "paste" ? (
                <>
                  <label className="admin__label" htmlFor={`tx-${r.id}`}>Payment transaction</label>
                  <input id={`tx-${r.id}`} className="admin__input" placeholder="0x… transaction hash" value={tx} onChange={(e) => setTx(e.target.value)} aria-invalid={tx !== "" && !txOk} />
                  <p className="admin__hint">It&apos;s checked on Celo: it must have sent at least {g(r.amountG)} G$ to {short(r.payTo)}.</p>
                </>
              ) : (
                <>
                  <label className="admin__label" htmlFor={`note-${r.id}`}>Reason (optional, shown to the player)</label>
                  <input id={`note-${r.id}`} className="admin__input" placeholder="e.g. referrals look like duplicate wallets" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                  <p className="admin__hint">Rejecting releases these referrals, so the player can request them again.</p>
                </>
              )}
              {err && <p className="admin__error" role="alert">{err}</p>}
              <div className="admin__actions">
                <button type="button" className={mode === "paste" ? "admin__btn" : "admin__btn admin__btn--danger"} disabled={busy || (mode === "paste" && !txOk)} onClick={submitOther}>
                  {busy ? (mode === "paste" ? "Checking on Celo…" : "Saving…") : mode === "paste" ? "Check and mark paid" : "Confirm reject"}
                </button>
                <button type="button" className="admin__ghost" disabled={busy} onClick={() => { setMode(null); setErr(null); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
