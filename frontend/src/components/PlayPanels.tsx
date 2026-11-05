import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReadContract } from "wagmi";
import { useAuth } from "../auth/AuthContext";
import { GAME2048_ABI } from "../lib/abi";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";
import type { GameState } from "../lib/gameLogic";
import { useLeaderboardTop } from "../hooks/useLeaderboardTop";
import { generatedName } from "./Leaderboard";
import Avatar from "./Avatar";

// ── Run timer ────────────────────────────────────────────────────────────
// Display only: never submitted, never used for scoring. Starts at the first move of a game
// (identified by its seed), stops when the game ends, and survives a reload of the same game.

const timerKey = (seed: string) => `bs_run_timer_${seed.slice(0, 18)}`;

export function useRunTimer(state: GameState | null, seed: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  const span = useRef<{ seed: string; start: number | null; end: number | null } | null>(null);

  if (seed && span.current?.seed !== seed) {
    let saved: { start: number | null; end: number | null } = { start: null, end: null };
    try { saved = JSON.parse(sessionStorage.getItem(timerKey(seed)) ?? "null") ?? saved; } catch { /* no storage */ }
    span.current = { seed, ...saved };
  }
  const s = seed ? span.current : null;
  const moved = (state?.moveCount ?? 0) > 0, ended = !!state && (state.over || state.won);
  if (s && moved && s.start === null) s.start = Date.now();
  if (s && ended && s.start !== null && s.end === null) s.end = Date.now();

  useEffect(() => {
    if (!s) return;
    try { sessionStorage.setItem(timerKey(s.seed), JSON.stringify({ start: s.start, end: s.end })); } catch { /* no storage */ }
  });
  const running = !!s && s.start !== null && s.end === null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 47);
    return () => clearInterval(id);
  }, [running]);

  if (!s || s.start === null) return 0;
  return (s.end ?? now) - s.start;
}

export function formatRunTime(ms: number): string {
  const cs = Math.floor(ms / 10) % 100, sec = Math.floor(ms / 1000) % 60, min = Math.floor(ms / 60_000);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// ── Stats bar ────────────────────────────────────────────────────────────

export function RunStatsBar({ state, elapsedMs }: { state: GameState | null; elapsedMs: number }) {
  return (
    <div className="run-stats card" aria-label="Current run">
      <div className="run-stats__item">
        <span className="run-stats__label">Moves:</span>
        <span className="run-stats__value run-stats__value--moves">{(state?.moveCount ?? 0).toLocaleString()}</span>
      </div>
      <div className="run-stats__item run-stats__item--center">
        <span className="run-stats__label">Time:</span>
        <span className="run-stats__value run-stats__value--time">{formatRunTime(elapsedMs)}</span>
      </div>
      <div className="run-stats__item run-stats__item--end">
        <span className="run-stats__label">Score:</span>
        <span className="run-stats__value">{(state?.score ?? 0).toLocaleString()}</span>
      </div>
    </div>
  );
}

// ── Combo meter ──────────────────────────────────────────────────────────
// Sits below the board, never on it. The contract multiplies a game's XP by 5 when its longest
// run of consecutive merging moves (maxCombo) reaches COMBO_THRESHOLD, so once that happens the
// bonus is earned for the whole game, whatever the current streak does afterwards.

export const COMBO_THRESHOLD = 5;

export function ComboMeter({ currentCombo = 0, maxCombo = 0 }: { currentCombo?: number; maxCombo?: number }) {
  const earned = maxCombo >= COMBO_THRESHOLD;
  const filled = earned ? COMBO_THRESHOLD : Math.min(currentCombo, COMBO_THRESHOLD);
  const text = earned
    ? "5× XP earned this game"
    : currentCombo >= 2
      ? `Combo ${currentCombo} · ${COMBO_THRESHOLD - currentCombo} more for 5× XP`
      : `${COMBO_THRESHOLD} merges in a row = 5× XP`;
  return (
    <div className={`combo-meter${earned ? " combo-meter--earned" : currentCombo >= 2 ? " combo-meter--building" : ""}`}>
      <span className="combo-meter__pips" aria-hidden="true">
        {Array.from({ length: COMBO_THRESHOLD }, (_, i) => (
          <span key={i} className={`combo-meter__pip${i < filled ? " combo-meter__pip--on" : ""}`} />
        ))}
      </span>
      <span className="combo-meter__text">{text}</span>
    </div>
  );
}

// ── Live standing ────────────────────────────────────────────────────────

export function LiveStanding({ state, active }: { state: GameState | null; active: boolean }) {
  const { address } = useAuth();
  const { rank, isLoading, isError, pageSize } = useLeaderboardTop(address);
  const { data: bestScore, isError: bestError } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "bestScore",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && CONTRACT_DEPLOYED, retry: 2, retryDelay: 3000 },
  });
  const best = bestScore !== undefined ? Math.max(Number(bestScore), state?.score ?? 0) : null;

  return (
    <section className="card standing" aria-label="Live standing">
      <header className="card__head">
        <h3 className="card__title">Live Standing</h3>
        <span className={`status-dot ${active ? "status-dot--on" : "status-dot--off"}`}>{active ? "Active" : "Idle"}</span>
      </header>
      <div className="standing__grid">
        <div>
          <p className="kicker">Current rank</p>
          <p className="standing__value standing__value--rank">
            {isLoading ? <span className="skeleton" aria-label="Loading rank" /> : rank ? `#${rank}` : "—"}
          </p>
          {!isLoading && !rank && (
            <p className="standing__note">{isError ? "Leaderboard unavailable" : `Not in the top ${pageSize} yet`}</p>
          )}
        </div>
        <div>
          <p className="kicker">Personal best</p>
          <p className="standing__value">
            {best !== null ? best.toLocaleString() : bestError || !CONTRACT_DEPLOYED ? "—" : <span className="skeleton" aria-label="Loading best score" />}
          </p>
          {(bestError || !CONTRACT_DEPLOYED) && <p className="standing__note">Unavailable</p>}
        </div>
      </div>
    </section>
  );
}

// ── Submit score ─────────────────────────────────────────────────────────

export function SubmitScoreCard({ state, ended, children }: { state: GameState | null; ended: boolean; children: ReactNode }) {
  return (
    <section className="card submit-card" aria-label="Submit score">
      <h3 className="kicker kicker--green">Submit Score</h3>
      <p className="submit-card__text">
        {ended && state
          ? <>Lock in your score of <strong>{state.score.toLocaleString()}</strong> on-chain and onto the leaderboard.</>
          : state
            ? <>Finish your run to submit it on-chain. Current score: <strong>{state.score.toLocaleString()}</strong>.</>
            : <>Start a game, then submit your final score on-chain.</>}
      </p>
      {children}
    </section>
  );
}

// ── Podium teaser ────────────────────────────────────────────────────────

export function PodiumTeaser({ onViewAll }: { onViewAll: () => void }) {
  const { topThree, isLoading, isError } = useLeaderboardTop();
  return (
    <section className="podium-teaser" aria-label="Top players">
      <header className="podium-teaser__head">
        <h2 className="section-title">Podium</h2>
        <button className="link-btn" onClick={onViewAll}>View Full Leaderboard ›</button>
      </header>
      {isLoading ? (
        <div className="podium-teaser__grid">{[0, 1, 2].map((i) => <div key={i} className="podium-card podium-card--loading"><span className="skeleton" /></div>)}</div>
      ) : isError ? (
        <p className="state-note state-note--error">The leaderboard is temporarily unavailable.</p>
      ) : topThree.length === 0 ? (
        <p className="state-note">No scores yet. Be the first on the podium.</p>
      ) : (
        <div className="podium-teaser__grid">
          {topThree.map((e, i) => (
            <div key={e.id} className="podium-card">
              <span className={`rank-chip rank-chip--${i + 1}`}>#{i + 1}</span>
              <Avatar address={e.id} size="sm" />
              <div className="podium-card__who">
                <span className="podium-card__name">{e.username?.trim() || generatedName(e.id)}</span>
                <span className="podium-card__sub">{e.isVerified === true ? "Verified player" : "Player"}</span>
              </div>
              <span className="podium-card__xp">{Number(e.xp).toLocaleString()} XP</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Your stats (leaderboard page) ────────────────────────────────────────

export function YourStats() {
  const { address } = useAuth();
  const { rank, myXp, isLoading, isError, pageSize } = useLeaderboardTop(address);
  const { data: bestScore } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "bestScore",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && CONTRACT_DEPLOYED, retry: 2, retryDelay: 3000 },
  });
  const { data: xp } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "xp",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && CONTRACT_DEPLOYED, retry: 2, retryDelay: 3000 },
  });
  const xpValue = xp !== undefined ? Number(xp) : myXp !== null ? Number(myXp) : null;
  const rows: Array<[string, ReactNode]> = [
    ["Personal rank", isLoading ? <span className="skeleton" /> : rank ? `#${rank}` : isError ? "Unavailable" : `Outside top ${pageSize}`],
    ["Personal best score", bestScore !== undefined ? Number(bestScore).toLocaleString() : "—"],
    ["Total XP", xpValue !== null ? xpValue.toLocaleString() : "—"],
  ];
  return (
    <section className="card your-stats" aria-label="Your stats">
      <header className="card__head">
        <h3 className="card__title card__title--lg">Your Stats</h3>
        <span className="status-dot status-dot--on">Live</span>
      </header>
      {rows.map(([k, v]) => (
        <div key={k} className="your-stats__row">
          <p className="kicker">{k}</p>
          <p className="your-stats__value">{v}</p>
        </div>
      ))}
    </section>
  );
}

export function ReadyToClimb({ onPlay }: { onPlay: () => void }) {
  return (
    <section className="card climb-card">
      <p className="kicker kicker--green">Ready to climb?</p>
      <h3 className="climb-card__title">Start Sliding Now</h3>
      <button className="btn btn--primary btn--block" onClick={onPlay}>Play Now</button>
    </section>
  );
}
