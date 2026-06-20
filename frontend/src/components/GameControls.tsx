import { useAccount } from "wagmi";
import { SessionPhase } from "../hooks/useGameSession";
import { GameState } from "../lib/gameLogic";

interface GameControlsProps {
  state: GameState | null;
  phase: SessionPhase;
  isPending: boolean;
  isWrongChain: boolean;
  onNewGame: () => void;
  onSubmit: () => void;
}

export default function GameControls({
  state,
  phase,
  isPending,
  onNewGame,
  onSubmit,
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

      {/* Submit Score — only when game has ended */}
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
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
