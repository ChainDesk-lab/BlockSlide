import { useAccount, useReadContract } from "wagmi";
import { GAME2048_ABI } from "../lib/abi";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";
import { GameState } from "../lib/gameLogic";

interface ScorePanelProps {
  state: GameState | null;
}

export default function ScorePanel({ state }: ScorePanelProps) {
  const { address } = useAccount();
  const canRead = !!address && CONTRACT_DEPLOYED;

  const { data: bestScore } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "bestScore",
    args: address ? [address] : undefined,
    query: { enabled: canRead, retry: 2, retryDelay: 3000 },
  });

  const { data: playerXp } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "xp",
    args: address ? [address] : undefined,
    query: { enabled: canRead, retry: 2, retryDelay: 3000 },
  });

  return (
    <div className="score-panel">
      <div className="score-box">
        <span className="score-label">SCORE</span>
        <span className="score-value">{(state?.score ?? 0).toLocaleString()}</span>
      </div>

      <div className="score-box">
        <span className="score-label">BEST</span>
        <span className="score-value">
          {bestScore !== undefined
            ? Math.max(Number(bestScore), state?.score ?? 0).toLocaleString()
            : (state?.score ?? 0).toLocaleString()}
        </span>
      </div>

      {playerXp !== undefined && (
        <div className="score-box">
          <span className="score-label">XP</span>
          <span className="score-value">{Number(playerXp).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
