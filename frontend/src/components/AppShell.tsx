"use client";

import { ReactNode, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useAccount, useChainId, useConnections } from "wagmi";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";
import { useIdentity } from "../hooks/useIdentity";
import BlockSlideMark from "./BlockSlideMark";
import WalletButton from "./WalletButton";
import ThemeToggle from "./ThemeToggle";
import {
  SoundOnIcon,
  SoundOffIcon,
  HomeIcon,
  GamepadIcon,
  TrophyIcon,
  CartIcon,
  HelpIcon,
  VerifiedIcon,
  UserIcon,
  BountyIcon,
} from "./icons";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { address } = useAuth();
  const { username } = useUsername();
  const { status: identityStatus } = useIdentity();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [tab, setTab] = useState<string>("home");

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
    // Hydration: read tab from search params and sound preference from localStorage
    try {
      setTab(searchParams.get("tab") || "home");
      const stored = localStorage.getItem("sound-enabled");
      if (stored !== null) setSoundEnabled(stored === "true");
    } catch {}
  }, [searchParams]);

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

  return (
    <div className="app">
      {/* Persistent header */}
      <header className="header">
        <div
          className="header__left"
          role="button"
          tabIndex={0}
          title="Home"
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") window.location.href = "/"; }}
        >
          <Link href="/">
            <div className="header__logo">
              <BlockSlideMark size={36} variant="color" />
              <span className="header__logo-text">BlockSlide</span>
            </div>
          </Link>
        </div>
        <div className="header__right">
          <span className="tooltip" data-tip="Home">
            <Link href="/">
              <button className={`icon-btn ${isHome ? "icon-btn--active" : ""}`} aria-label="Home">
                <HomeIcon />
              </button>
            </Link>
          </span>
          <span className="tooltip" data-tip="Play">
            <Link href="/?tab=game">
              <button className={`icon-btn ${isGame ? "icon-btn--active" : ""}`} aria-label="Play">
                <GamepadIcon />
              </button>
            </Link>
          </span>
          <span className="tooltip" data-tip="Leaderboard">
            <Link href="/?tab=leaderboard">
              <button className={`icon-btn ${isLeaderboard ? "icon-btn--active" : ""}`} aria-label="Leaderboard">
                <TrophyIcon />
              </button>
            </Link>
          </span>
          <span className="tooltip" data-tip="Profile">
            <button
              className={`icon-btn ${isProfile ? "icon-btn--active" : ""}`}
              aria-label="Profile"
              onClick={handleMyProfileClick}
              disabled={!address}
              title={address ? "View your profile" : "Connect wallet to view profile"}
            >
              <UserIcon />
            </button>
          </span>
          <span className="tooltip" data-tip="Bounties">
            <Link href="/bounty" aria-label="Bounties">
              <button className={`icon-btn ${isBounty ? "icon-btn--active" : ""}`} aria-label="Bounties">
                <BountyIcon />
              </button>
            </Link>
          </span>
          <span className="tooltip" data-tip="Shop">
            <Link href="/?tab=shop">
              <button className={`icon-btn ${isShop ? "icon-btn--active" : ""}`} aria-label="Shop">
                <CartIcon />
              </button>
            </Link>
          </span>
          <span className="tooltip" data-tip="How to play">
            <Link href="/how-to-play" aria-label="How to play">
              <button className={`icon-btn ${isHowToPlay ? "icon-btn--active" : ""}`} aria-label="How to play">
                <HelpIcon />
              </button>
            </Link>
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
          <ThemeToggle />
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

      {/* Route content */}
      {children}

      {/* Diagnostic footer for support/debugging */}
      <DiagnosticFooter />
    </div>
  );
}

function DiagnosticFooter() {
  const { address } = useAccount();
  const chainId = useChainId();
  const connections = useConnections();

  // Get the currently active connector name
  const activeConnector = connections.find(c => c.accounts.length > 0);
  const connectorName = activeConnector?.connector?.name || "unknown";

  // Format address (show first 6 and last 4 chars)
  const displayAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "not connected";

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
      {displayAddress} | {connectorName} | {chainId}
    </div>
  );
}
