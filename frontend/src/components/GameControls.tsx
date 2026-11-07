import { useAuth } from "../auth/AuthContext";
import { SessionPhase } from "../hooks/useGameSession";
import { IdentityStatus } from "../hooks/useIdentity";
import { GameState } from "../lib/gameLogic";

interface GameControlsProps {
  state: GameState | null;
  phase: SessionPhase;
  isPending: boolean;
  isWrongChain: boolean;
  identityStatus: IdentityStatus;
  /** True only if THIS wallet passes the contract's isWhitelisted check — the
   * actual on-chain gate for submitScore. identityStatus === "verified" is
   * broader (it also covers wallets merely linked to a verified identity,
   * which can claim but can't submit), so it can't be used for this hint. */
  canSubmitScore: boolean;
  onNewGame: () => void;
  onSubmit: () => void;
  /** Undo is available this session (operator switch on AND upgraded contract). */
  undoAvailable?: boolean;
  /** Credits usable this game; null while the balance is still loading. */
  undoCredits?: bigint | null;
  /** There is a move to take back (and the game wasn't won). */
  canUndo?: boolean;
  onUndo?: () => void;
  /** Which controls to render: the board's (new game, undo, move hints), the submit card's
   * (submit, submitting, finalizing and their hints), or both (default, unchanged). */
  part?: "all" | "board" | "submit";
}

export default function GameControls({
  state,
  phase,
  isPending,
  identityStatus,
  canSubmitScore,
  onNewGame,
  onSubmit,
  undoAvailable,
  undoCredits,
  canUndo,
  onUndo,
  part = "all",
}: GameControlsProps) {
  const { isConnected } = useAuth();
  const gameEnded = state && (state.over || state.won);
  const board = part !== "submit", submit = part !== "board";

  return (
    <div className={`controls controls--${part}`}>
      {/* New Game — always available, no wallet required */}
      {board && (phase === "idle" || phase === "done") && (
        <button
          className="btn btn--primary"
          onClick={onNewGame}
          disabled={isPending}
        >
          {isPending ? <Spinner /> : phase === "done" ? "Play Again" : "New Game"}
        </button>
      )}

      {board && phase === "starting" && (
        <button className="btn btn--primary" disabled>
          <Spinner /> Starting…
        </button>
      )}

      {/* Submit Score button is always shown once the game ends — the contract
          itself rejects the tx if this wallet isn't whitelisted, and that
          revert is caught and surfaced via the error banner / hint below. */}
      {submit && phase === "active" && gameEnded && (
        <button
          className="btn btn--secondary"
          onClick={onSubmit}
          disabled={isPending}
        >
          {isPending ? <Spinner /> : "Submit Score"}
        </button>
      )}

      {submit && phase === "submitting" && (
        <button className="btn btn--secondary" disabled>
          <Spinner /> Submitting…
        </button>
      )}

      {submit && phase === "finalizing" && (
        <button className="btn btn--secondary" disabled>
          <Spinner /> Finalizing your game…
        </button>
      )}

      {/* Undo — during play and after a game-over (take back the losing move), not after a win.
          Instant and local; the credits used are deducted when the score is submitted. */}
      {board && undoAvailable && phase === "active" && !state?.won && onUndo && (
        <button
          className="btn btn--tertiary undo-btn"
          onClick={onUndo}
          disabled={!canUndo || undoCredits === null || undoCredits === undefined || undoCredits === 0n || isPending}
          title={
            undoCredits === null || undoCredits === undefined
              ? "Checking your Undo credits…"
              : undoCredits === 0n
                ? "No undo credits left for this game — get some in the shop"
                : !canUndo
                  ? "Make a move first — Undo takes back your last move"
                  : `Take back your last move (${Number(undoCredits)} credit${undoCredits === 1n ? "" : "s"} left; charged when you submit)`
          }
        >
          {`↶ Undo (${undoCredits === null || undoCredits === undefined ? "…" : Number(undoCredits)})`}
        </button>
      )}

      {/* Contextual hints */}
      {board && !isConnected && phase === "active" && !gameEnded && (
        <p className="controls__hint">Arrow keys · WASD · swipe to move</p>
      )}
      {submit && !isConnected && phase === "active" && gameEnded && (
        <p className="controls__hint">Connect your wallet to submit your score on-chain</p>
      )}
      {board && !isConnected && (phase === "idle" || phase === "done") && !state && (
        <p className="controls__hint">Connect your wallet to save your scores on-chain</p>
      )}
      {board && isConnected && !gameEnded && phase === "active" && (
        <p className="controls__hint">Arrow keys · WASD · swipe to move</p>
      )}
      {submit && isConnected && !canSubmitScore && phase === "active" && gameEnded && (
        <p className="controls__hint">
          {identityStatus === "verified"
            ? "Your GoodDollar verification is on a different wallet — switch to it to submit your score on-chain."
            : "Verify your identity to submit your score on-chain"}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
