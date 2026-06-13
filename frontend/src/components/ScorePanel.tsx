import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { GAME2048_ABI } from "../lib/abi";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS, MILESTONES } from "../lib/constants";
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

  const { data: claimed } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "claimedMilestones",
    args: address ? [address] : undefined,
    query: { enabled: canRead, retry: 2, retryDelay: 3000 },
  });

  const totalEarned = calcEarned(claimed ?? 0);

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

      <div className="score-box score-box--highlight">
        <span className="score-label">G$ EARNED</span>
        <span className="score-value score-value--green">
          {formatUnits(totalEarned, 18)} G$
        </span>
      </div>

      <div className="milestone-row">
        {MILESTONES.map(({ tile, reward }) => {
          const bit = tileToBit(tile);
          const unlocked = (Number(claimed ?? 0) & bit) !== 0;
          return (
            <div
              key={tile}
              className={`milestone-badge ${unlocked ? "milestone-badge--unlocked" : ""}`}
              title={`${tile} tile — ${reward}`}
            >
              <span className="milestone-tile">{tile}</span>
              <span className="milestone-reward">{reward}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tileToBit(tile: number): number {
  if (tile === 256)  return 1;
  if (tile === 512)  return 2;
  if (tile === 1024) return 4;
  if (tile === 2048) return 8;
  return 0;
}

function calcEarned(bitmask: number): bigint {
  let total = 0n;
  if (bitmask & 1) total += 5n  * 10n ** 18n;
  if (bitmask & 2) total += 15n * 10n ** 18n;
  if (bitmask & 4) total += 40n * 10n ** 18n;
  if (bitmask & 8) total += 100n * 10n ** 18n;
  return total;
}
