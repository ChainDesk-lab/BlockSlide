interface Props {
  onClose: () => void;
  onDismissWeek: () => void;
  voteUrl: string;
}

export default function FlowstateVotingModal({ onClose, onDismissWeek, voteUrl }: Props) {
  const handleVote = () => {
    window.open(voteUrl, "_blank", "noopener,noreferrer");
    onClose();
  };

  const handleDismiss = () => {
    onDismissWeek();
    onClose();
  };

  return (
    <div
      className="htp-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Vote for BlockSlide"
      onClick={onClose}
    >
      <div className="htp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="htp-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <p className="htp-label">🗳️ Help us grow</p>
        <h2 className="username-modal__title">Vote for BlockSlide</h2>
        <p className="username-modal__desc">
          Enjoying BlockSlide? Help us win this week's Flowstate voting round! Your vote
          supports our development and helps us build better features.
        </p>

        <div className="username-modal__actions">
          <button className="btn btn--primary" onClick={handleVote}>
            Vote Now →
          </button>
          <button className="btn btn--secondary" onClick={handleDismiss}>
            Don't show this week
          </button>
        </div>
      </div>
    </div>
  );
}
