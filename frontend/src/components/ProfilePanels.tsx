import type { ReactNode } from "react";
import { formatAddress, getAddressInitial, getAvatarGradient } from "../lib/profileUtils";
import { shortLink, type ProfileStatView } from "../lib/profileState";

/**
 * Profile screen (Figma frame 7). Presentational only: ProfileView owns the data, the
 * referral link and every handler, so these render and test without a wallet or network.
 */

// ── Header ───────────────────────────────────────────────────────────────

export function ProfileHeader({ address, username, verified, isOwn, copied, onCopyAddress, onEdit }: {
  address: string;
  username: string | null;
  verified: boolean;
  isOwn: boolean;
  copied: boolean;
  onCopyAddress: () => void;
  onEdit?: () => void;
}) {
  return (
    <header className="profile2__head">
      <div className="profile2__who">
        <div className="profile2__avatar" style={{ background: getAvatarGradient(address) }} aria-hidden="true">
          {getAddressInitial(address)}
        </div>
        <div className="profile2__id">
          <h1 className="profile2__name">
            {username ?? formatAddress(address)}
            {verified && <span className="profile2__verified">✓ Verified</span>}
          </h1>
          <p className="profile2__wallet">
            Wallet: <span className="profile2__addr">{formatAddress(address, 6)}</span>
            <button type="button" className="profile2__copy" onClick={onCopyAddress} aria-label="Copy wallet address">
              {copied ? "Copied" : "Copy"}
            </button>
          </p>
        </div>
      </div>
      {isOwn && onEdit && (
        <button type="button" className="profile2__edit" onClick={onEdit}>Edit Profile</button>
      )}
    </header>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────

/** `stat` null = still loading. */
export function ProfileStat({ label, stat }: { label: string; stat: ProfileStatView | null }) {
  return (
    <div className="profile2__stat card" aria-label={label}>
      <p className="kicker">{label}</p>
      <p className={`profile2__stat-value profile2__stat-value--${stat?.tone ?? "default"}`}>
        {stat ? stat.value : <span className="skeleton" aria-label={`Loading ${label.toLowerCase()}`} />}
      </p>
      <p className="profile2__stat-note">{stat ? stat.note : " "}</p>
    </div>
  );
}

// ── Recent run history ───────────────────────────────────────────────────

const RUN_COLUMNS = ["Date", "Result", "Score", "Time", "Moves"] as const;

/**
 * The table the design shows, with the honest state: no source the app reads records
 * individual runs (the subgraph keeps career totals only; public RPC log scans drop logs),
 * so no rows are shown rather than reconstructed or estimated ones.
 */
export function RunHistoryCard() {
  return (
    <section className="card profile2__runs" aria-label="Recent run history">
      <h2 className="card__title profile2__runs-title">Recent Run History</h2>
      <div className="profile2__table-wrap">
        <table className="profile2__table">
          <thead>
            <tr>{RUN_COLUMNS.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={RUN_COLUMNS.length} className="profile2__runs-empty">
                <strong>Run history isn&apos;t recorded yet.</strong>{" "}
                Individual runs, their times and results aren&apos;t indexed, so only career totals are shown above.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Invite friends ───────────────────────────────────────────────────────

export interface InviteeView { address: string; username: string | null; joinedAt: string; played: boolean | null }
export type InviteListView =
  | { status: "idle" } | { status: "signing" } | { status: "loading" }
  | { status: "shown"; invitees: InviteeView[] } | { status: "error"; message: string };

const joinedDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function InviteCard({ refLink, copied, referral, onCopy, onShare, canList = false, list = { status: "idle" }, onShowList, onHideList }: {
  refLink: string;
  copied: boolean;
  /** The invite count line, or null while it is still loading. */
  referral: string | null;
  onCopy: () => void;
  onShare: () => void;
  /** Whether anyone has joined through the link, so there is a list to show. */
  canList?: boolean;
  list?: InviteListView;
  onShowList?: () => void;
  onHideList?: () => void;
}) {
  return (
    <section className="card profile2__invite" aria-label="Invite friends">
      <h2 className="card__title">Invite Friends</h2>
      <p className="profile2__invite-copy">Share your link and grow the BlockSlide community.</p>
      <div className="profile2__link">
        <span className="profile2__link-text" title={refLink}>{shortLink(refLink)}</span>
        <button type="button" className="profile2__link-copy" onClick={onCopy} aria-label="Copy invite link">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button type="button" className="profile2__share" onClick={onShare}>Share Invite</button>
      {referral && <p className="profile2__referrals">{referral}</p>}

      {canList && list.status === "idle" && (
        <button type="button" className="profile2__invitees-btn" onClick={onShowList}>See who you invited</button>
      )}
      {list.status === "signing" && <p className="profile2__invitees-note" role="status">Confirm the signature in your wallet. It&apos;s free and sends nothing.</p>}
      {list.status === "loading" && <p className="profile2__invitees-note" role="status">Loading your invited players…</p>}
      {list.status === "error" && (
        <p className="profile2__invitees-note" role="alert">
          {list.message} <button type="button" className="profile2__invitees-link" onClick={onShowList}>Try again</button>
        </p>
      )}
      {list.status === "shown" && (
        <div className="profile2__invitees">
          <div className="profile2__invitees-head">
            <h3 className="profile2__invitees-title">Players you invited</h3>
            <button type="button" className="profile2__invitees-link" onClick={onHideList}>Hide</button>
          </div>
          {list.invitees.length === 0 ? (
            <p className="profile2__invitees-note">No one has joined through your link yet.</p>
          ) : (
            <ul className="profile2__invitees-list">
              {list.invitees.map((p) => (
                <li key={p.address} className="profile2__invitee">
                  <span className="profile2__invitee-who">
                    <a href={`/profile/${p.address}`} className="profile2__invitee-name">{p.username ?? formatAddress(p.address)}</a>
                    <span className="profile2__invitee-date">Joined {joinedDate(p.joinedAt)}</span>
                  </span>
                  {p.played !== null && (
                    <span className={`profile2__invitee-badge ${p.played ? "profile2__invitee-badge--played" : ""}`}>
                      {p.played ? "Played" : "Not played yet"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="profile2__invitees-note">Only you can see this list.</p>
        </div>
      )}
    </section>
  );
}

export function ProfileLayout({ children }: { children: ReactNode }) {
  // AppShell renders routes bare (the home screen brings its own <main>), so the profile does too.
  return <main className="main"><div className="page profile2">{children}</div></main>;
}
