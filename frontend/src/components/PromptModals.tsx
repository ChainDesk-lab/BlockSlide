import { useGoodDollarIdentity } from "../hooks/useGoodDollarIdentity";
import { IdCardIcon } from "./icons";

export const TELEGRAM_URL = "https://t.me/blockslide_xyz";

/** "Get verified" pop-up for players whose wallet can't submit scores yet. */
export function VerifyPromptModal({ onClose, onStarted, verifiedElsewhere = false }: { onClose: () => void; onStarted: () => void; verifiedElsewhere?: boolean }) {
  const { startVerification, isVerifying, error } = useGoodDollarIdentity();

  const handleVerify = async () => {
    onStarted();
    await startVerification();
  };

  return (
    <div className="htp-backdrop" role="dialog" aria-modal="true" aria-label="Get verified" onClick={onClose}>
      <div className="htp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="htp-close" onClick={onClose} aria-label="Close">✕</button>
        <p className="htp-label"><IdCardIcon size={14} className="htp-label__icon" /> One quick step</p>
        <h2 className="username-modal__title">Get verified to earn</h2>
        <p className="username-modal__desc">
          Verify with GoodDollar to save your scores on-chain, climb the leaderboard and win G$ rewards.
          It takes a quick face scan and you only do it once.
        </p>
        {verifiedElsewhere && (
          <p className="username-modal__desc">
            Already verified on another wallet? GoodDollar allows one face per wallet, so sign in with that wallet to play and earn.
          </p>
        )}
        {error && <p className="identity-gate__error">{error}</p>}
        <div className="username-modal__actions">
          <button className="btn btn--primary" onClick={handleVerify} disabled={isVerifying}>
            {isVerifying ? "Opening GoodDollar…" : "Verify now →"}
          </button>
          <button className="btn btn--secondary" onClick={onClose}>Later</button>
        </div>
      </div>
    </div>
  );
}

/** "Join our Telegram" pop-up, shown until the player taps Join. */
export function TelegramPromptModal({ onJoin, onClose, onDismissWeek }: { onJoin: () => void; onClose: () => void; onDismissWeek: () => void }) {
  const handleJoin = () => {
    window.open(TELEGRAM_URL, "_blank", "noopener,noreferrer");
    onJoin();
  };

  return (
    <div className="htp-backdrop" role="dialog" aria-modal="true" aria-label="Join the BlockSlide Telegram" onClick={onClose}>
      <div className="htp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="htp-close" onClick={onClose} aria-label="Close">✕</button>
        <p className="htp-label">Community</p>
        <h2 className="username-modal__title">Join the BlockSlide Telegram</h2>
        <p className="username-modal__desc">
          Get bounty announcements, winners, new shop items and help from the team and other players.
        </p>
        <div className="username-modal__actions">
          <button className="btn btn--primary" onClick={handleJoin}>Join Telegram →</button>
          <button className="btn btn--secondary" onClick={onDismissWeek}>Don&apos;t show this week</button>
        </div>
      </div>
    </div>
  );
}
