import { useEffect, useState } from "react";
import { useUsername, USERNAME_RE } from "../hooks/useUsername";

interface Props {
  onClose: () => void;
}

export default function UsernameModal({ onClose }: Props) {
  const { isSaving, error, save, savedName } = useUsername();
  const [value, setValue] = useState("");

  // Auto-close when username is successfully saved
  useEffect(() => {
    if (savedName) onClose();
  }, [savedName, onClose]);

  const trimmed = value.trim();
  const valid = USERNAME_RE.test(trimmed);

  const submit = () => {
    if (valid && !isSaving) save(trimmed);
  };

  return (
    <div
      className="htp-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a username"
    >
      <div className="htp-modal" onClick={(e) => e.stopPropagation()}>
        {/* Closeable so a connected wallet isn't trapped — they can set it
            later from the Leaderboard screen. */}
        <button className="htp-close" onClick={onClose} aria-label="Close" disabled={isSaving}>
          ✕
        </button>

        <p className="htp-label">Welcome</p>
        <h2 className="username-modal__title">Choose a username</h2>
        <p className="username-modal__desc">
          This is shown on the leaderboard instead of your wallet address. It's
          saved on-chain, so it costs a small gas fee.
        </p>

        <input
          className="username-card__input username-modal__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="your_name"
          maxLength={20}
          autoFocus
          spellCheck={false}
          disabled={isSaving}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />

        <p className={`username-card__hint ${error ? "username-card__hint--error" : ""}`}>
          {error ?? "3–20 characters · letters, numbers and underscores only"}
        </p>

        <div className="username-modal__actions">
          <button
            className="btn btn--primary"
            disabled={!valid || isSaving}
            onClick={submit}
          >
            {isSaving ? (
              <>
                <span className="spinner" aria-hidden="true" /> Signing transaction…
              </>
            ) : (
              "Save username"
            )}
          </button>
        </div>
        {isSaving && (
          <p className="username-modal__info">
            Check your wallet to approve the transaction.
          </p>
        )}
      </div>
    </div>
  );
}
