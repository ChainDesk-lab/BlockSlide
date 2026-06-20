import { useReadContract, useWatchContractEvent } from "wagmi";
import { GAME2048_ABI } from "../lib/abi";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";

const ZERO = "0x0000000000000000000000000000000000000000";

export default function Leaderboard() {
  const { data, isLoading, isError, refetch } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "getLeaderboard",
    query: { enabled: CONTRACT_DEPLOYED, retry: 2, retryDelay: 3000 },
  });

  // Top 10 players, highest score first, padding/empty slots removed.
  const entries = data
    ? [...data]
        .filter((e) => e.player !== ZERO)
        .sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0))
        .slice(0, 10)
    : [];

  // Resolve on-chain display names for everyone on the board in one call.
  const { data: namesData, refetch: refetchNames } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "getUsernames",
    args: [entries.map((e) => e.player)],
    query: { enabled: CONTRACT_DEPLOYED && entries.length > 0 },
  });

  // Refresh automatically whenever a player ends a session (submits a score).
  useWatchContractEvent({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    eventName: "ScoreSubmitted",
    enabled: CONTRACT_DEPLOYED,
    onLogs: () => {
      refetch();
      refetchNames();
    },
  });

  const showEmpty =
    CONTRACT_DEPLOYED && !isLoading && (isError || entries.length === 0);

  return (
    <div className="leaderboard">
      <h3 className="leaderboard__title">Top Players</h3>

      {!CONTRACT_DEPLOYED && (
        <p className="leaderboard__empty">Deploy the contract to see scores.</p>
      )}
      {CONTRACT_DEPLOYED && isLoading && (
        <p className="leaderboard__empty">Loading…</p>
      )}
      {showEmpty && (
        <p className="leaderboard__empty">No scores yet. Be the first to play.</p>
      )}

      {entries.length > 0 && (
        <ol className="leaderboard__list">
          {entries.map((entry, i) => {
            const onchainName = namesData?.[i]?.trim();
            const name = onchainName || generatedName(entry.player);

            return (
              <li key={entry.player} className="leaderboard__entry">
                <span className="leaderboard__rank">{i + 1}</span>
                <div className="leaderboard__player">
                  <span className="leaderboard__name">{name}</span>
                  <span className="leaderboard__addr" title={entry.player}>
                    {shortAddr(entry.player)}
                  </span>
                </div>
                <span className="leaderboard__score">
                  {entry.score.toLocaleString()}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Deterministic friendly name from a wallet address, used when a player
// hasn't claimed an on-chain username.
function generatedName(addr: string): string {
  return `Player-${addr.slice(-4).toUpperCase()}`;
}
