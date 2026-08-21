import { useAccount } from "wagmi";
import { SessionPhase } from "../hooks/useGameSession";
import { IdentityStatus } from "../hooks/useIdentity";
import { GameState } from "../lib/gameLogic";

interface GameControlsProps {
  state: GameState | null;
  phase: SessionPhase;
  isPending: boolean;
  isWrongChain: boolean;
  identityStatus: IdentityStatus;
  onNewGame: () => void;
  onSubmit: () => void;
  undoCredits?: bigint;
  onUndo?: () => void;
  undoPending?: boolean;
}

export default function GameControls({
  state,
  phase,
  isPending,
  identityStatus,
  onNewGame,
  onSubmit,
  undoCredits,
  onUndo,
  undoPending,
}: GameControlsProps) {
  const { isConnected } = useAccount();
  const gameEnded = state && (state.over || state.won);

  return (
    <div className="controls">
      {/* New Game — always available, no wallet required */}
      {(phase === "idle" || phase === "done") && (
        <button
          className="btn btn--primary"
          onClick={onNewGame}
          disabled={isPending}
        >
          {isPending ? <Spinner /> : phase === "done" ? "Play Again" : "New Game"}
        </button>
      )}

      {phase === "starting" && (
        <button className="btn btn--primary" disabled>
          <Spinner /> Starting…
        </button>
      )}

      {/* Submit Score — anyone can submit; only claiming rewards requires verification */}
      {phase === "active" && gameEnded && (
        <button
          className="btn btn--secondary"
          onClick={onSubmit}
          disabled={isPending}
        >
          {isPending ? <Spinner /> : "Submit Score"}
        </button>
      )}

      {phase === "submitting" && (
        <button className="btn btn--secondary" disabled>
          <Spinner /> Submitting…
        </button>
      )}

      {phase === "finalizing" && (
        <button className="btn btn--secondary" disabled>
          <Spinner /> Finalizing your game…
        </button>
      )}

      {/* Undo button — shown during active gameplay */}
      {phase === "active" && !gameEnded && onUndo && (
        <button
          className="btn btn--tertiary undo-btn"
          onClick={onUndo}
          disabled={!undoCredits || undoCredits === 0n || undoPending || isPending}
          title={
            !undoCredits || undoCredits === 0n
              ? "No undo credits available"
              : `Undo move (${Number(undoCredits || 0)} credits left)`
          }
        >
          {undoPending ? <Spinner /> : `↶ Undo (${Number(undoCredits || 0)})`}
        </button>
      )}

      {/* Contextual hints */}
      {!isConnected && phase === "active" && !gameEnded && (
        <p className="controls__hint">Arrow keys · WASD · swipe to move</p>
      )}
      {!isConnected && phase === "active" && gameEnded && (
        <p className="controls__hint">Connect your wallet to submit your score on-chain</p>
      )}
      {!isConnected && (phase === "idle" || phase === "done") && !state && (
        <p className="controls__hint">Connect your wallet to save your scores on-chain</p>
      )}
      {isConnected && !gameEnded && phase === "active" && (
        <p className="controls__hint">Arrow keys · WASD · swipe to move</p>
      )}
      {isConnected && identityStatus !== "verified" && phase === "active" && gameEnded && (
        <p className="controls__hint">Verify your identity to submit your score on-chain</p>
      )}
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
