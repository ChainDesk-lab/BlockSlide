"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "./auth/AuthContext";
import { getDeviceStorage, setDeviceStorage, getUserStorage, setUserStorage } from "./lib/unifiedStorage";
import { migrateStorageKeys } from "./lib/storageMigration";
import Board from "./components/Board";
import GameControls from "./components/GameControls";
import Home from "./components/Home";
import HowToPlay from "./components/HowToPlay";
import IdentityGate from "./components/IdentityGate";
import Leaderboard from "./components/Leaderboard";
import SignInModal from "./components/SignInModal";
import Shop from "./components/Shop";
import ScorePanel from "./components/ScorePanel";
import UsernameEditor from "./components/UsernameEditor";
import UsernameModal from "./components/UsernameModal";
import FeatureNotification from "./components/FeatureNotification";
import { TrophyIcon, CartIcon } from "./components/icons";
import { useGame } from "./hooks/useGame";
import { useGameSession } from "./hooks/useGameSession";
import { useIdentity } from "./hooks/useIdentity";
import { useUsername } from "./hooks/useUsername";
import { useReferrerRegistration } from "./hooks/useReferrerRegistration";
import { useShop } from "./hooks/useShop";
import { useFeatureNotifications } from "./hooks/useFeatureNotifications";
import { useFlowstateVotingContext } from "./contexts/FlowstateVotingContext";
import { sounds } from "./lib/sounds";

type View = "home" | "game" | "leaderboard" | "shop";

export default function App() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { address, isConnected, isFundingWallet } = useAuth();
  const { status: identityStatus, refetch: refetchIdentity, markPending: markIdentityPending } = useIdentity();

  // Migrate old storage keys to new unified format (run once per address)
  useEffect(() => {
    migrateStorageKeys(address);
  }, [address]);

  // Log auth state changes for debugging wallet connection issues
  useEffect(() => {
    if (isConnected || address) {
      console.log("[App] Auth state:", {
        isConnected,
        address: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "none",
        timestamp: new Date().toISOString(),
      });
    }
  }, [isConnected, address]);

  // Trigger Flowstate voting reminder after a successful score submission
  const { triggerVotingReminder } = useFlowstateVotingContext();
  useEffect(() => {
    const handleScoreSubmitted = () => {
      // Small delay to let the success toast show first
      setTimeout(() => {
        triggerVotingReminder();
      }, 500);
    };

    window.addEventListener("scoreSubmitted", handleScoreSubmitted);
    return () => window.removeEventListener("scoreSubmitted", handleScoreSubmitted);
  }, [triggerVotingReminder]);

  // Which screen is showing. Game state/hooks live at this level so navigating
  // away and back never resets an in-progress game.
  // View is DERIVED from the tab URL param only; no internal state mirror.
  // Router.replace() is the ONLY mechanism that changes the tab.
  const tabParam = searchParams.get("tab") || "home";
  const view = (tabParam === "game" || tabParam === "leaderboard" || tabParam === "shop" ? tabParam : "home") as View;

  const [showHowToPlay, setShowHowToPlay] = useState<boolean>(() =>
    !getDeviceStorage("seen_htp")
  );
  const closeHowToPlay = () => {
    setDeviceStorage("seen_htp", "1");
    setShowHowToPlay(false);
  };
  const boardWrapperRef = useRef<HTMLDivElement>(null);
  const { state, seed, startNewGame, clearGame, isInitialized } = useGame(address, view === "game", boardWrapperRef);
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
  // and shows in the header. Dismissed-per-wallet and persisted to storage.
  const { username, isLoading: usernameLoading } = useUsername();
  const DISMISSED_KEY = "username_modal_dismissed";
  const [usernameModalDismissed, setUsernameModalDismissed] = useState(false);

  // Register referrer after connect (Phase 3)
  useReferrerRegistration();

  // Shop state for undo button
  const { undoCredits, consumeUndo, pendingAction: shopPending } = useShop();
  const [undoLocalPending, setUndoLocalPending] = useState(false);

  const handleUndo = async () => {
    setUndoLocalPending(true);
    try {
      await consumeUndo();
      // TODO: Revert the last move in the game state
      // This would require integrating with the game logic
    } finally {
      setUndoLocalPending(false);
    }
  };

  useEffect(() => {
    // On wallet change, read the dismiss state from storage.
    if (!address) {
      setUsernameModalDismissed(false);
      return;
    }
    const dismissed = getUserStorage(address, DISMISSED_KEY) === "true";
    setUsernameModalDismissed(dismissed);
  }, [address]);

  const showUsernameModal =
    !!address && !isWrongChain && !usernameLoading && !username && !usernameModalDismissed && !isFundingWallet;

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

  // ── Session count & Feature notifications ──────────────────────────────────
  const [sessionCount, setSessionCount] = useState(0);
  useEffect(() => {
    if (!address) return;
    const key = `session_count_${address}`;
    const stored = getUserStorage(address, key);
    const count = parseInt(stored || "0", 10);
    setSessionCount(count);
  }, [address]);

  // Track when a new game starts to increment session count
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (prevPhaseRef.current === "idle" && phase === "starting" && address) {
      const key = `session_count_${address}`;
      setSessionCount((prev) => {
        const newCount = prev + 1;
        setUserStorage(address, key, newCount.toString());
        return newCount;
      });
    }
    prevPhaseRef.current = phase;
  }, [phase, address]);

  // Feature notifications
  const isGameActive = !!(view === "game" && state && !state.over && !state.won);
  const { activeNotifications, dismissNotification } = useFeatureNotifications(
    address,
    sessionCount,
    state?.moveCount ?? 0,
    isGameActive,
    identityStatus === "verified",
    username
  );

  // Don't show notifications if a modal is open (modals block gameplay)
  const hasOpenModal = showHowToPlay || showUsernameModal || isFundingWallet || (view === "game" && gameEnded && identityStatus !== "verified");
  const visibleNotifications = hasOpenModal ? [] : activeNotifications;

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
    return <SignInModal />;
  }
  if (!address) {
    return <FinishingSignIn />;
  }

  return (
    <>
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
            if (address) setUserStorage(address, DISMISSED_KEY, "true");
          }}
        />
      )}

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
            onPlay={() => router.replace("/?tab=game", { scroll: false })}
            onLeaderboard={() => router.replace("/?tab=leaderboard", { scroll: false })}
          />
        )}

        {/* ── Play screen ───────────────────────────────────────────────── */}
        {view === "game" && (
          <div className="game-view">
            <ScorePanel state={state} />

            <div className="board-wrapper" ref={boardWrapperRef}>
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
              ) : isInitialized ? (
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
              ) : null}
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
              undoCredits={undoCredits}
              onUndo={handleUndo}
              undoPending={undoLocalPending || shopPending === "undo"}
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

      {/* Feature Notifications — render active notifications */}
      {visibleNotifications.map((notif) => (
        <FeatureNotificationRenderer
          key={notif.id}
          type={notif.type}
          onDismiss={() => dismissNotification(notif.id)}
          bountyId={notif.bountyId}
          placement={notif.placement}
          week={notif.week}
          prizeAmount={notif.prizeAmount}
        />
      ))}
    </>
  );
}

/**
 * Renders the appropriate notification content based on type.
 */
function FeatureNotificationRenderer({
  type,
  onDismiss,
  placement,
  week,
  prizeAmount,
}: {
  type: "undoStep" | "cosmetics" | "flowStateVoting" | "bountyWinner";
  onDismiss: () => void;
  bountyId?: string;
  placement?: number;
  week?: number;
  prizeAmount?: number;
}) {
  if (type === "undoStep") {
    return (
      <FeatureNotification
        type="undoStep"
        title="✨ Undo Step"
        message="Made a mistake? The new Undo Step feature in the shop lets you take back your last move once per game. Perfect for those tricky situations!"
        actionLabel="Check it out"
        onAction={() => {
          // Could navigate to shop here if needed
          window.location.hash = "#shop";
        }}
        onDismiss={onDismiss}
      />
    );
  }

  if (type === "cosmetics") {
    return (
      <FeatureNotification
        type="cosmetics"
        title="🎨 Customize Your Look"
        message="Did you know? You can personalize your game with cosmetics — tile skins, avatars, leaderboard flair, and more from the shop. Make BlockSlide uniquely yours!"
        actionLabel="Browse cosmetics"
        onAction={() => {
          window.location.hash = "#shop";
        }}
        onDismiss={onDismiss}
      />
    );
  }

  if (type === "flowStateVoting") {
    return (
      <FeatureNotification
        type="flowStateVoting"
        title="🗳️ Vote for BlockSlide"
        message={
          <>
            Support BlockSlide by voting on{" "}
            <a
              href="https://flowstate.network/flow-councils/42220/0x582e3314d4ef56c18930acb10bb64313525e7820"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "inherit", textDecoration: "underline" }}
            >
              Flow States
            </a>
            . Your verified account can vote to help BlockSlide thrive! (Verified
            players only.)
          </>
        }
        autoHideDuration={0}
        onDismiss={onDismiss}
      />
    );
  }

  if (type === "bountyWinner") {
    return (
      <FeatureNotification
        type="bountyWinner"
        title="🎉 Bounty Winner!"
        message={`Congrats! You placed #${placement} in the Week ${week} Bounty and won $${prizeAmount}. Check Telegram/DM us to claim your reward.`}
        actionLabel="Got it"
        onAction={onDismiss}
        autoHideDuration={0}
        onDismiss={onDismiss}
      />
    );
  }

  return null;
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
