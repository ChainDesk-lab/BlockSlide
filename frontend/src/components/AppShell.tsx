"use client";

import { ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
  const { address } = useAuth();
  const { username } = useUsername();
  const { status: identityStatus } = useIdentity();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [tab, setTab] = useState<string>("home");

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
            <Link href={address ? `/profile/${address}` : "/"} aria-label="Profile">
              <button className={`icon-btn ${isProfile ? "icon-btn--active" : ""}`} aria-label="Profile">
                <UserIcon />
              </button>
            </Link>
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
    </div>
  );
}
