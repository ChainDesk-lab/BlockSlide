"use client";

import { ReactNode, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useAccount, useConnections } from "wagmi";
import { useWalletChainId } from "../hooks/useWalletChainId";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";
import { useIdentity } from "../hooks/useIdentity";
import BlockSlideMark from "./BlockSlideMark";
import WalletButton from "./WalletButton";
import ThemeToggle from "./ThemeToggle";
import { SoundOnIcon, SoundOffIcon, VerifiedIcon } from "./icons";
import { DIAGNOSTICS_STORAGE_KEY, diagnosticsEnabled, diagnosticsPreference } from "../lib/diagnostics";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { address, isConnected } = useAuth();
  const { username } = useUsername();
  const { status: identityStatus } = useIdentity();
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Read straight from the URL: held in state, the first render always said "home", so the
  // wrong link was highlighted until an effect caught up.
  const tab = searchParams.get("tab") || "home";

  // Handle "My Profile" click: always navigate to the CURRENT address, live
  const handleMyProfileClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (address) {
        // Always use the current address at click time, never a cached/stale value
        router.push(`/profile/${address}`);
      }
    },
    [address, router]
  );

  useEffect(() => {
    // Sound preference lives in localStorage, so it can only be read after mount.
    try {
      const stored = localStorage.getItem("sound-enabled");
      if (stored !== null) setSoundEnabled(stored === "true");
    } catch {}
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try {
      localStorage.setItem("sound-enabled", String(next));
    } catch {}
  };
  const isHome = pathname === "/" && (!tab || tab === "home");
  const isGame = pathname === "/" && tab === "game";
  const isLeaderboard = pathname === "/" && tab === "leaderboard";
  const isShop = pathname === "/" && tab === "shop";
  const isBounty = pathname === "/bounty";
  const isProfile = pathname.startsWith("/profile");
  const isHowToPlay = pathname === "/how-to-play";
  const isStats = pathname === "/analytics" || pathname === "/stats";

  return (
    <div className="app">
      {/* Persistent header */}
      <header className="header">
        <Link href="/" className="header__brand" aria-label="BlockSlide home">
          <BlockSlideMark size={30} variant="color" />
          <span className="header__wordmark">BlockSlide</span>
        </Link>
        <nav className="header__nav" aria-label="Main">
          {([
            ["Home", "/", isHome],
            ["Play", "/?tab=game", isGame],
            ["Leaderboard", "/?tab=leaderboard", isLeaderboard],
            ["Bounties", "/bounty", isBounty],
            ["Shop", "/?tab=shop", isShop],
            ["Stats", "/stats", isStats],
            ["How to Play", "/how-to-play", isHowToPlay],
          ] as const).map(([label, href, active]) => (
            <Link key={label} href={href} className={`nav-link ${active ? "nav-link--active" : ""}`} aria-current={active ? "page" : undefined}>
              {label}
            </Link>
          ))}
          <button
            className={`nav-link ${isProfile ? "nav-link--active" : ""}`}
            onClick={handleMyProfileClick}
            disabled={!address}
            aria-current={isProfile ? "page" : undefined}
            title={address ? "View your profile" : "Connect wallet to view profile"}
          >
            Profile
          </button>
        </nav>
        <div className="header__actions">
          <ThemeToggle />
          <button
            className="icon-btn icon-btn--ghost"
            onClick={toggleSound}
            aria-label={soundEnabled ? "Mute sounds" : "Enable sounds"}
            title={soundEnabled ? "Sound on" : "Sound off"}
          >
            {soundEnabled ? <SoundOnIcon /> : <SoundOffIcon />}
          </button>
          {username ? (
            <span className="header__username" title={`Your username: ${username}`}>
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
          {/* Signed out: the way in, as designed. It opens the existing sign-in screen; while a
              sign-in is completing (connected, address pending) nothing is shown, so it can't re-trigger it. */}
          {!isConnected && !address && (
            <Link href="/?tab=game" className="header__connect">Connect Wallet</Link>
          )}
        </div>
      </header>

      {/* Route content */}
      {children}

      <footer className="site-footer">
        <span>© {new Date().getFullYear()} BlockSlide. All rights reserved.</span>
        <nav className="site-footer__links" aria-label="Footer">
          <Link href="/how-to-play">How to Play</Link>
          <Link href="/stats">Stats</Link>
          <a href="https://t.me/blockslide_xyz" target="_blank" rel="noopener noreferrer">Telegram</a>
        </nav>
      </footer>

      {/* Diagnostic footer for support/debugging */}
      <DiagnosticFooter />
    </div>
  );
}

function DiagnosticFooter() {
  // wagmi's own useAccount()/useConnections() only reflect a connected
  // browser-wallet connector — a Magic.link session has neither, so this
  // must read the unified auth address (what the rest of the app treats as
  // "connected"), not wagmi's, or Magic users always show as disconnected here.
  const { address: wagmiAddress } = useAccount();
  const { address: authAddress, authType } = useAuth();
  // The wallet's real chain, not wagmi's config chain — otherwise this debug
  // readout claims 42220 even while the wallet sits on Ethereum.
  const chainId = useWalletChainId();
  const connections = useConnections();
  const address = authAddress ?? wagmiAddress;

  // Wallet connection state (localStorage-backed) isn't known during SSR, so
  // the server always renders "not connected". Gate on mount to keep the
  // first client render identical to the server render and avoid a
  // hydration mismatch, then swap in the real values right after.
  const [mounted, setMounted] = useState(false);
  // Development always; production only on request (?debug=1, remembered on this device).
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setMounted(true);
    let stored: string | null = null;
    try {
      const pref = diagnosticsPreference(window.location.search);
      if (pref === "1") localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, "1");
      if (pref === "0") localStorage.removeItem(DIAGNOSTICS_STORAGE_KEY);
      stored = localStorage.getItem(DIAGNOSTICS_STORAGE_KEY);
    } catch { /* no storage: fall back to the URL and build mode */ }
    setEnabled(diagnosticsEnabled(process.env.NODE_ENV, window.location.search, stored));
  }, []);

  // Get the currently active connector name
  const activeConnector = connections.find(c => c.accounts.length > 0);
  const connectorName = authType === "magic" ? "magic" : activeConnector?.connector?.name || "unknown";

  // Format address (show first 6 and last 4 chars)
  const displayAddress = mounted && address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "not connected";

  if (!enabled) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      right: 0,
      padding: "4px 8px",
      fontSize: "11px",
      color: "var(--text-muted)",
      fontFamily: "monospace",
      zIndex: 1000,
      cursor: "pointer",
      opacity: 0.6,
    }}
    title="Debug info: address | connector | chainId"
    >
      {mounted ? `${displayAddress} | ${connectorName} | ${chainId}` : "not connected"}
    </div>
  );
}
