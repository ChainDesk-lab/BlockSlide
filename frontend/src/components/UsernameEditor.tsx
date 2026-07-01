import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useUsername, USERNAME_RE } from "../hooks/useUsername";

export default function UsernameEditor() {
  const { isConnected } = useAuth();
  const { username, isSaving, error, savedName, save, clearFeedback } = useUsername();

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  // Seed the input with the current name when opening the editor.
  useEffect(() => {
    if (editing) setValue(username);
  }, [editing, username]);

  // Close the editor once a save lands.
  useEffect(() => {
    if (savedName) setEditing(false);
  }, [savedName]);

  if (!isConnected) {
    return (
      <div className="username-card">
        <span className="username-card__label">Connect your wallet to claim a username.</span>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="username-card">
        <div className="username-card__display">
          <span className="username-card__label">Your name</span>
          <span className="username-card__name">
            {username || <em className="username-card__unset">Not set</em>}
          </span>
        </div>
        <button
          className="btn btn--xs"
          onClick={() => { clearFeedback(); setEditing(true); }}
        >
          {username ? "Change" : "Set username"}
        </button>
      </div>
    );
  }

  const valid = USERNAME_RE.test(value.trim());

  return (
    <div className="username-card username-card--editing">
      <div className="username-card__form">
        <input
          className="username-card__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="your_name"
          maxLength={20}
          autoFocus
          spellCheck={false}
          onKeyDown={(e) => { if (e.key === "Enter" && valid && !isSaving) save(value); }}
        />
        <div className="username-card__actions">
          <button
            className="btn btn--primary btn--sm"
            disabled={!valid || isSaving}
            onClick={() => save(value)}
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            disabled={isSaving}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      </div>
      <p className={`username-card__hint ${error ? "username-card__hint--error" : ""}`}>
        {error ?? "3–20 chars · letters, numbers, underscores · saved on-chain (small gas fee)"}
      </p>
    </div>
  );
}
