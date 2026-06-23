import { useReadContract, useWatchContractEvent } from "wagmi";
import { GAME2048_ABI } from "../lib/abi";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";

export default function Leaderboard() {
  // The full registered player set paired with cumulative XP, in one call.
  // Requires the V5 contract (getPlayersWithXp); deploy that upgrade before
  // shipping this frontend.
  const { data, isLoading, isError, refetch } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "getPlayersWithXp",
    query: { enabled: CONTRACT_DEPLOYED, retry: 2, retryDelay: 3000 },
  });

  // Rank every player by XP (highest first), top 10.
  const entries = (() => {
    if (!data) return [];
    const [addrs, xps] = data;
    return addrs
      .map((player, i) => ({ player, xp: xps[i] ?? 0n }))
      .sort((a, b) => (b.xp > a.xp ? 1 : b.xp < a.xp ? -1 : 0))
      .slice(0, 10);
  })();

  // Resolve on-chain display names for everyone on the board in one call.
  const { data: namesData, refetch: refetchNames } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "getUsernames",
    args: [entries.map((e) => e.player)],
    query: { enabled: CONTRACT_DEPLOYED && entries.length > 0 },
  });

  // Refresh automatically whenever a player ends a session (submits a score),
  // which is also when XP is awarded.
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
                  {entry.xp.toLocaleString()} XP
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
