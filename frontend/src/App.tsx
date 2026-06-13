import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import Board from "./components/Board";
import GameControls from "./components/GameControls";
import HowToPlay from "./components/HowToPlay";
import IdentityGate from "./components/IdentityGate";
import Leaderboard from "./components/Leaderboard";
import Shop from "./components/Shop";
import ScorePanel from "./components/ScorePanel";
import WalletButton from "./components/WalletButton";
import { SoundOnIcon, SoundOffIcon } from "./components/icons";
import { useGame } from "./hooks/useGame";
import { useGameSession } from "./hooks/useGameSession";
import { useIdentity } from "./hooks/useIdentity";
import { sounds } from "./lib/sounds";

export default function App() {
  const { address } = useAccount();
  const { status: identityStatus, refetch: refetchIdentity } = useIdentity();

  const [showHowToPlay, setShowHowToPlay] = useState<boolean>(() =>
    !localStorage.getItem("blockslide_seen_htp")
  );
  const openHowToPlay  = () => setShowHowToPlay(true);
  const closeHowToPlay = () => {
    localStorage.setItem("blockslide_seen_htp", "1");
    setShowHowToPlay(false);
  };
  const { state, seed, startNewGame, clearGame } = useGame(address);
  const {
    phase,
    isPending,
    isSwitchPending,
    isWrongChain,
    error,
    startSession,
    submitScore,
    reset,
    switchToTargetChain,
  } = useGameSession();

  // ── Sound toggle ───────────────────────────────────────────────────────────
  const [soundEnabled, setSoundEnabled] = useState(sounds.enabled);
  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    sounds.setEnabled(next);
  };

  // ── Sound effects ──────────────────────────────────────────────────────────
  const prevStateRef = useRef(state);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!state || !prev) return;
    if (state.won && !prev.won)              sounds.win();
    else if (state.over && !prev.over)       sounds.gameOver();
    else if (state.score > prev.score)       sounds.merge(state.highestTile);
    else if (state.moveCount > prev.moveCount) sounds.slide();
    if (state.newTiles.length > 0 && state.moveCount > 0) sounds.spawn();
  }, [state]);

  // ── Game actions ───────────────────────────────────────────────────────────
  // New Game always works — no wallet required. Blockchain features (submit
  // score, earn G$) activate only when wallet is connected + contract deployed.
  const handleNewGame = () => {
    sounds.newGame();
    reset();
    clearGame();
    const newSeed = startNewGame();
    startSession(newSeed as `0x${string}`);
  };

  const handleSubmit = () => {
    if (!state || !seed) return;
    submitScore(state, seed as `0x${string}`);
  };

  const gameEnded = state && (state.over || state.won);
  const stuckActive = phase === "active" && !state;

  return (
    <div className="app">
      {showHowToPlay && <HowToPlay onClose={closeHowToPlay} />}
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header__left">
          <h1 className="header__logo">BlockSlide</h1>
          <span className="header__sub">2048 on Celo</span>
        </div>
        <div className="header__right">
          <button
            className="icon-btn"
            onClick={openHowToPlay}
            aria-label="How to play"
            title="How to play"
          >
            ?
          </button>
          <button
            className="icon-btn"
            onClick={toggleSound}
            aria-label={soundEnabled ? "Mute sounds" : "Enable sounds"}
            title={soundEnabled ? "Sound on" : "Sound off"}
          >
            {soundEnabled ? <SoundOnIcon /> : <SoundOffIcon />}
          </button>
          <WalletButton />
        </div>
      </header>

      <main className="main">
        {/* GoodDollar identity gate — shown when connected but not verified */}
        <IdentityGate status={identityStatus} onRefresh={refetchIdentity} />

        {/* Wrong-chain only — this actually blocks onchain play */}
        {isWrongChain && (
          <div className="chain-banner" role="alert">
            <span>⚠ Wrong network — switch to Celo Alfajores to earn G$.</span>
            <button
              className="btn btn--xs"
              onClick={switchToTargetChain}
              disabled={isSwitchPending}
            >
              {isSwitchPending ? "Switching…" : "Switch"}
            </button>
          </div>
        )}

        {/* ── Scores ────────────────────────────────────────────────────── */}
        <ScorePanel state={state} />

        {/* ── Board ─────────────────────────────────────────────────────── */}
        <div className="board-wrapper">
          {state ? (
            <>
              <Board state={state} />
              {gameEnded && (
                <div className="game-overlay">
                  <div className="game-overlay__content">
                    <p className="game-overlay__title">
                      {state.won ? "🎉 You reached 2048!" : "Game Over"}
                    </p>
                    <p className="game-overlay__score">Score: {state.score.toLocaleString()}</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="board board--empty">
              <div className="board-placeholder">
                {stuckActive ? (
                  <>
                    <p>Session active on-chain</p>
                    <p className="board-placeholder__sub">Start a new game to continue.</p>
                  </>
                ) : (
                  <>
                    <p>Ready to slide?</p>
                    <p className="board-placeholder__sub">Hit New Game to start</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Error / info messages (only shown when relevant) */}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {/* ── Controls ──────────────────────────────────────────────────── */}
        <GameControls
          state={state}
          phase={stuckActive ? "idle" : phase}
          isPending={isPending}
          isWrongChain={isWrongChain}
          onNewGame={handleNewGame}
          onSubmit={handleSubmit}
        />

        {/* ── Shop ──────────────────────────────────────────────────────── */}
        <Shop />

        {/* ── Leaderboard ───────────────────────────────────────────────── */}
        <Leaderboard />
      </main>
    </div>
  );
}
