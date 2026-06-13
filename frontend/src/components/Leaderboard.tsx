import { useReadContract } from "wagmi";
import { GAME2048_ABI } from "../lib/abi";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";

export default function Leaderboard() {
  const { data, isLoading, isError } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "getLeaderboard",
    query: {
      // Don't fire until the contract is actually deployed
      enabled: CONTRACT_DEPLOYED,
      retry: 2,
      retryDelay: 3000,
    },
  });

  const entries = data
    ? [...data]
        .filter((e) => e.player !== "0x0000000000000000000000000000000000000000")
        .sort((a, b) => (b.score > a.score ? 1 : -1))
    : [];

  return (
    <div className="leaderboard">
      <h3 className="leaderboard__title">Leaderboard</h3>

      {!CONTRACT_DEPLOYED && (
        <p className="leaderboard__empty">Deploy the contract to see scores.</p>
      )}

      {CONTRACT_DEPLOYED && isLoading && (
        <p className="leaderboard__empty">Loading…</p>
      )}

      {CONTRACT_DEPLOYED && isError && (
        <p className="leaderboard__empty">Could not load — check your network.</p>
      )}

      {CONTRACT_DEPLOYED && !isLoading && !isError && entries.length === 0 && (
        <p className="leaderboard__empty">No scores yet — be the first!</p>
      )}

      {entries.length > 0 && (
        <ol className="leaderboard__list">
          {entries.map((entry, i) => (
            <li key={entry.player} className="leaderboard__entry">
              <span className="leaderboard__rank">{i + 1}</span>
              <span className="leaderboard__addr">{shortAddr(entry.player)}</span>
              <span className="leaderboard__tile tile-badge">
                {entry.highestTile}
              </span>
              <span className="leaderboard__score">
                {entry.score.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
