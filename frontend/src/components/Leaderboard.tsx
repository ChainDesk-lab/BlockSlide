import { useReadContract, useReadContracts } from "wagmi";
import { GAME2048_ABI } from "../lib/abi";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";

const ZERO = "0x0000000000000000000000000000000000000000";

export default function Leaderboard() {
  const { data, isLoading, isError } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "getLeaderboard",
    query: { enabled: CONTRACT_DEPLOYED, retry: 2, retryDelay: 3000 },
  });

  const entries = data
    ? [...data]
        .filter((e) => e.player !== ZERO)
        .sort((a, b) => (b.score > a.score ? 1 : -1))
    : [];

  // Batch-read XP for every player on the leaderboard
  const { data: xpData } = useReadContracts({
    contracts: entries.map((e) => ({
      address: GAME2048_ADDRESS,
      abi: GAME2048_ABI,
      functionName: "xp" as const,
      args: [e.player] as const,
    })),
    query: { enabled: entries.length > 0 },
  });

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
          {entries.map((entry, i) => {
            const xpResult = xpData?.[i];
            const xp = xpResult?.status === "success" ? (xpResult.result as bigint) : null;

            return (
              <li key={entry.player} className="leaderboard__entry">
                <span className="leaderboard__rank">{i + 1}</span>
                <span className="leaderboard__addr">{shortAddr(entry.player)}</span>
                <span className="leaderboard__tile tile-badge">{entry.highestTile}</span>
                <div className="leaderboard__right">
                  <span className="leaderboard__score">{entry.score.toLocaleString()}</span>
                  {xp !== null && (
                    <span className="leaderboard__xp">{Number(xp).toLocaleString()} XP</span>
                  )}
                </div>
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
