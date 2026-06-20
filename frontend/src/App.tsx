import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import Board from "./components/Board";
import GameControls from "./components/GameControls";
import Home from "./components/Home";
import HowToPlay from "./components/HowToPlay";
import IdentityGate from "./components/IdentityGate";
import Leaderboard from "./components/Leaderboard";
import Shop from "./components/Shop";
import ScorePanel from "./components/ScorePanel";
import UsernameEditor from "./components/UsernameEditor";
import UsernameModal from "./components/UsernameModal";
import WalletButton from "./components/WalletButton";
import { SoundOnIcon, SoundOffIcon, HomeIcon, GamepadIcon, TrophyIcon, CartIcon, HelpIcon, VerifiedIcon } from "./components/icons";
import { useGame } from "./hooks/useGame";
import { useGameSession } from "./hooks/useGameSession";
import { useIdentity } from "./hooks/useIdentity";
import { useUsername } from "./hooks/useUsername";
import { sounds } from "./lib/sounds";

type View = "home" | "game" | "leaderboard" | "shop";

export default function App() {
  const { address } = useAccount();
  const { status: identityStatus, refetch: refetchIdentity, markPending: markIdentityPending } = useIdentity();

  // Which screen is showing. Game state/hooks live at this level so navigating
  // away and back never resets an in-progress game.
  const [view, setView] = useState<View>("home");

  const [showHowToPlay, setShowHowToPlay] = useState<boolean>(() =>
    !localStorage.getItem("blockslide_seen_htp")
  );
  const openHowToPlay  = () => setShowHowToPlay(true);
  const closeHowToPlay = () => {
    localStorage.setItem("blockslide_seen_htp", "1");
    setShowHowToPlay(false);
  };
  const { state, seed, startNewGame, clearGame } = useGame(address, view === "game");
  const {
    phase,
    isPending,
    isSwitchPending,
    isWrongChain,
    error,
    startSession,
    submitScore,
    reset,
    sessionExpiresAt,
    sessionExpired,
    switchToTargetChain,
  } = useGameSession();

  // ── Username ────────────────────────────────────────────────────────────────
  // On connect we read the username from the contract. If it's empty, prompt the
  // user to choose one via a modal; if they already have one it loads silently
  // and shows in the header. Dismissed-per-wallet so we don't nag on every read.
  const { username, isLoading: usernameLoading } = useUsername();
  const [usernameModalDismissed, setUsernameModalDismissed] = useState(false);

  useEffect(() => {
    // Reset the dismiss flag whenever the connected wallet changes.
    setUsernameModalDismissed(false);
  }, [address]);

  const showUsernameModal =
    !!address && !isWrongChain && !usernameLoading && !username && !usernameModalDismissed;

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
  // New Game always works — no wallet required. Blockchain features (on-chain
  // score submission) activate only when wallet is connected + contract deployed.
  const handleNewGame = () => {
    sounds.newGame();
    reset();
    // clearGame is called inside the callback so it only runs after all
    // pre-flight checks pass — prevents wiping localStorage when startSession
    // returns early (e.g. active session on-chain), which would cause a seed
    // mismatch when the user later tries to submit their existing game.
    startSession((newSeed) => {
      clearGame();
      startNewGame(newSeed);
    });
  };

  const handleSubmit = () => {
    if (!state || !seed) return;
    submitScore(state, seed as `0x${string}`);
  };

  // Auto-clear stale error messages when the session expires so the user
  // isn't stuck seeing "Your session expired" with no way to dismiss it.
  useEffect(() => {
    if (sessionExpired) reset();
  }, [sessionExpired, reset]);

  const gameEnded = state && (state.over || state.won);
  const stuckActive = phase === "active" && !state;

  return (
    <div className="app">
      {showHowToPlay && <HowToPlay onClose={closeHowToPlay} />}
      {showUsernameModal && (
        <UsernameModal onClose={() => setUsernameModalDismissed(true)} />
      )}
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="header">
        <div
          className="header__left"
          onClick={() => setView("home")}
          role="button"
          tabIndex={0}
          title="Home"
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setView("home"); }}
        >
          <h1 className="header__logo">BlockSlide</h1>
          <span className="header__sub">2048 on Celo</span>
        </div>
        <div className="header__right">
          <span className="tooltip" data-tip="Home">
            <button
              className={`icon-btn ${view === "home" ? "icon-btn--active" : ""}`}
              onClick={() => setView("home")}
              aria-label="Home"
            >
              <HomeIcon />
            </button>
          </span>
          <span className="tooltip" data-tip="Play">
            <button
              className={`icon-btn ${view === "game" ? "icon-btn--active" : ""}`}
              onClick={() => setView("game")}
              aria-label="Play"
            >
              <GamepadIcon />
            </button>
          </span>
          <span className="tooltip" data-tip="Leaderboard">
            <button
              className={`icon-btn ${view === "leaderboard" ? "icon-btn--active" : ""}`}
              onClick={() => setView("leaderboard")}
              aria-label="Leaderboard"
            >
              <TrophyIcon />
            </button>
          </span>
          <span className="tooltip" data-tip="Shop">
            <button
              className={`icon-btn ${view === "shop" ? "icon-btn--active" : ""}`}
              onClick={() => setView("shop")}
              aria-label="Shop"
            >
              <CartIcon />
            </button>
          </span>
          <span className="tooltip" data-tip="How to play">
            <button
              className="icon-btn"
              onClick={openHowToPlay}
              aria-label="How to play"
            >
              <HelpIcon />
            </button>
          </span>
          <span className="tooltip" data-tip={soundEnabled ? "Sound on" : "Sound off"}>
            <button
              className="icon-btn"
              onClick={toggleSound}
              aria-label={soundEnabled ? "Mute sounds" : "Enable sounds"}
            >
              {soundEnabled ? <SoundOnIcon /> : <SoundOffIcon />}
            </button>
          </span>
          {username ? (
            <span className="header__username" title="Your username">
              <span className="header__username-name">{username}</span>
              {identityStatus === "verified" && (
                <VerifiedIcon size={15} className="header__verified" />
              )}
            </span>
          ) : identityStatus === "verified" ? (
            <span className="header__username header__username--badge-only" title="Verified with GoodDollar">
              <VerifiedIcon size={15} className="header__verified" /> Verified
            </span>
          ) : null}
          <WalletButton />
        </div>
      </header>

      <main className="main">
        {/* GoodDollar identity gate — shown when connected but not verified */}
        <IdentityGate status={identityStatus} onRefresh={refetchIdentity} onStarted={markIdentityPending} />

        {/* Wrong-chain only — this actually blocks onchain play */}
        {isWrongChain && (
          <div className="chain-banner" role="alert">
            <span>⚠ Wrong network — switch to Celo to submit scores on-chain.</span>
            <button
              className="btn btn--xs"
              onClick={switchToTargetChain}
              disabled={isSwitchPending}
            >
              {isSwitchPending ? "Switching…" : "Switch"}
            </button>
          </div>
        )}

        {/* ── Home screen ───────────────────────────────────────────────── */}
        {view === "home" && (
          <Home
            onPlay={() => setView("game")}
            onLeaderboard={() => setView("leaderboard")}
          />
        )}

        {/* ── Play screen ───────────────────────────────────────────────── */}
        {view === "game" && (
          <>
            <ScorePanel state={state} />

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
                      sessionExpired ? (
                        <>
                          <p>Previous session expired</p>
                          <p className="board-placeholder__sub">Hit New Game — it will clear automatically.</p>
                        </>
                      ) : (
                        <>
                          <p>Session active on-chain</p>
                          <SessionCountdown expiresAt={sessionExpiresAt!} />
                          <p className="board-placeholder__sub">
                            Game state was lost (page refresh?).{" "}
                            <button
                              className="btn btn--xs"
                              onClick={() => { clearGame(); startNewGame(); }}
                              style={{ marginTop: "0.5rem" }}
                            >
                              Play locally (off-chain)
                            </button>
                          </p>
                        </>
                      )
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

            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}

            <GameControls
              state={state}
              phase={
                // stuckActive: on-chain session exists but local game state is gone
                (stuckActive && !sessionExpired) ? "active" :
                // session expired → unlock New Game regardless of phase/stuckActive
                (stuckActive || sessionExpired) ? "idle" :
                phase
              }
              isPending={isPending}
              isWrongChain={isWrongChain}
              onNewGame={handleNewGame}
              onSubmit={handleSubmit}
            />
          </>
        )}

        {/* ── Leaderboard screen ────────────────────────────────────────── */}
        {view === "leaderboard" && (
          <div className="screen">
            <h2 className="screen__title">
              <TrophyIcon size={26} /> Leaderboard
            </h2>
            <UsernameEditor />
            <Leaderboard />
          </div>
        )}

        {/* ── Shop screen ───────────────────────────────────────────────── */}
        {view === "shop" && (
          <div className="screen">
            <h2 className="screen__title">
              <CartIcon size={26} /> Shop
            </h2>
            <Shop />
          </div>
        )}
      </main>
    </div>
  );
}

function SessionCountdown({ expiresAt }: { expiresAt: number }) {
  const [secsLeft, setSecsLeft] = useState(() =>
    Math.max(0, Math.ceil(expiresAt - Date.now() / 1000))
  );

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil(expiresAt - Date.now() / 1000));
      setSecsLeft(left);
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const m = Math.floor(secsLeft / 60);
  const s = secsLeft % 60;

  return (
    <p className="board-placeholder__sub">
      Expires in {m}:{String(s).padStart(2, "0")} — you can start a new game after.
    </p>
  );
}
