import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import BlockSlideMark from "./components/BlockSlideMark";
import Board from "./components/Board";
import GameControls from "./components/GameControls";
import Home from "./components/Home";
import HowToPlay from "./components/HowToPlay";
import IdentityGate from "./components/IdentityGate";
import Leaderboard from "./components/Leaderboard";
import LoginScreen from "./components/LoginScreen";
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
  const { address, isConnected, isFundingWallet } = useAuth();
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
    sessionStuck,
    switchToTargetChain,
  } = useGameSession();

  // ── Username ────────────────────────────────────────────────────────────────
  // On connect we read the username from the contract. If it's empty, prompt the
  // user to choose one via a modal; if they already have one it loads silently
  // and shows in the header. Dismissed-per-wallet and persisted to localStorage.
  const { username, isLoading: usernameLoading } = useUsername();
  const DISMISSED_KEY = (addr: string) => `blockslide_username_dismissed_${addr.toLowerCase()}`;
  const [usernameModalDismissed, setUsernameModalDismissed] = useState(false);

  useEffect(() => {
    // On wallet change, read the dismiss state from localStorage.
    if (!address) {
      setUsernameModalDismissed(false);
      return;
    }
    const dismissed = localStorage.getItem(DISMISSED_KEY(address)) === "true";
    setUsernameModalDismissed(dismissed);
  }, [address]);

  const showUsernameModal =
    !!address && !isWrongChain && !usernameLoading && !username && !usernameModalDismissed && !isFundingWallet;

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

  // Auth gate — 3-state, to avoid a login loop. The two signals are independent
  // (see MagicBridge): `isConnected` is the SDK's auth truth; `address` is
  // the wagmi account, which the SDK syncs a tick LATER. If we collapsed this to
  // `!isConnected || !address → LoginScreen`, the address-pending window would
  // render LoginScreen, whose button re-fires login() → infinite loop.
  //   - not connected            → LoginScreen (also covers SDK still booting:
  //                                 LoginScreen shows its own "Getting ready…")
  //   - connected, address pending → FinishingSignIn (spinner, never the login
  //                                 button — so nothing can re-trigger login)
  //   - connected + address       → the app
  if (!isConnected) {
    return <LoginScreen />;
  }
  if (!address) {
    return <FinishingSignIn />;
  }

  return (
    <div className="app">
      {showHowToPlay && <HowToPlay onClose={closeHowToPlay} />}
      {isFundingWallet && (
        <div
          className="htp-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Setting up wallet"
        >
          <div className="htp-modal">
            <p className="htp-label">⚡ Setting up</p>
            <h2 className="username-modal__title">Preparing your wallet</h2>
            <p className="username-modal__desc">
              We're auto-funding your new wallet with a small amount of CELO for gas so you can save your username and play right away.
            </p>
            <div className="setup-spinner-container">
              <span className="spinner" aria-hidden="true" />
              <p className="setup-spinner-text">This usually takes a few seconds…</p>
            </div>
          </div>
        </div>
      )}
      {showUsernameModal && (
        <UsernameModal
          onClose={() => {
            setUsernameModalDismissed(true);
            if (address) localStorage.setItem(DISMISSED_KEY(address), "true");
          }}
        />
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
          <div className="header__logo">
            <BlockSlideMark size={36} variant="color" />
            <span className="header__logo-text">BlockSlide</span>
          </div>
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
        {/* Identity gate modal — shown only when trying to claim without verification */}
        {view === "game" && gameEnded && identityStatus !== "verified" && (
          <IdentityGate status={identityStatus} onRefresh={refetchIdentity} onStarted={markIdentityPending} />
        )}

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
          <div className="game-view">
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
                {sessionStuck && sessionExpiresAt && !sessionExpired && (
                  <SessionCountdown expiresAt={sessionExpiresAt} />
                )}
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
              identityStatus={identityStatus}
              onNewGame={handleNewGame}
              onSubmit={handleSubmit}
            />
          </div>
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

// Shown when auth reports connected but the wagmi address hasn't synced yet.
// Critically this renders a spinner, NOT the login button — so nothing here can
// re-trigger connect() and spin up a login loop. If the address still hasn't
// arrived after a few seconds the sync has genuinely stalled, so we surface a
// clean sign-out rather than trapping the user on a spinner forever.
function FinishingSignIn() {
  const { logout } = useAuth();
  const [showEscape, setShowEscape] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowEscape(true), 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="login-screen">
      <div className="login-container">
        <div className="login-header">
          <h1 className="login-title">BlockSlide</h1>
          <p className="login-subtitle">Finishing sign-in…</p>
        </div>
        <div className="login-options">
          <span className="spinner" aria-hidden="true" />
        </div>
        {showEscape && (
          <div className="login-footer">
            <p className="login-disclaimer">Taking longer than expected.</p>
            <button className="btn btn--xs" onClick={() => logout()}>
              Sign out and try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
