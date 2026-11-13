"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  BountyIcon, CartIcon, CloseIcon, GamepadIcon, GridIcon, HelpIcon, HomeIcon, StatsIcon, TrophyIcon, UserIcon,
} from "./icons";

/**
 * Phone navigation: a bar fixed to the bottom of the screen with the four most used pages and a
 * More tab, which opens a panel listing every page. Shown only on phones held upright (index.css,
 * "Phone navigation"); everywhere else the header's link row is the navigation.
 */

export type PageId = "home" | "game" | "leaderboard" | "bounty" | "shop" | "stats" | "howtoplay" | "profile";

interface NavPage { id: PageId; label: string; short?: string; href: string; Icon: typeof HomeIcon }

const PAGES: NavPage[] = [
  { id: "home", label: "Home", href: "/", Icon: HomeIcon },
  { id: "game", label: "Play", href: "/?tab=game", Icon: GamepadIcon },
  { id: "leaderboard", label: "Leaderboard", short: "Ranks", href: "/?tab=leaderboard", Icon: TrophyIcon },
  { id: "bounty", label: "Bounties", href: "/bounty", Icon: BountyIcon },
  { id: "shop", label: "Shop", href: "/?tab=shop", Icon: CartIcon },
  { id: "stats", label: "Stats", href: "/stats", Icon: StatsIcon },
  { id: "howtoplay", label: "How to Play", href: "/how-to-play", Icon: HelpIcon },
];

const IN_BAR: readonly PageId[] = ["game", "leaderboard", "bounty", "shop"];

export default function BottomNav({ current, address }: { current: PageId | null; address?: string | null }) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const sheetId = useId();

  // Navigating anywhere closes the panel.
  useEffect(() => { setOpen(false); }, [current]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); moreRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);
  // Signed out, Profile leads to the game tab, which shows the sign-in screen.
  const profileHref = address ? `/profile/${address}` : "/?tab=game";
  const moreActive = open || (current !== null && !IN_BAR.includes(current));

  return (
    <>
      {open && (
        <>
          <div className="more-backdrop" onClick={close} aria-hidden="true" />
          <div className="more-sheet" id={sheetId} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="more-sheet__head">
              <p className="more-sheet__title" id={titleId}>All pages</p>
              <button ref={closeRef} type="button" className="more-sheet__close" onClick={() => { close(); moreRef.current?.focus(); }} aria-label="Close menu">
                <CloseIcon size={18} />
              </button>
            </div>
            <ul className="more-sheet__grid">
              {PAGES.map(({ id, label, href, Icon }) => (
                <li key={id}>
                  <Link
                    href={href}
                    className={`more-sheet__item ${current === id ? "more-sheet__item--active" : ""}`}
                    aria-current={current === id ? "page" : undefined}
                    onClick={close}
                  >
                    <Icon size={22} />
                    <span className="more-sheet__label">{label}</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={profileHref}
                  className={`more-sheet__item ${current === "profile" ? "more-sheet__item--active" : ""}`}
                  aria-current={current === "profile" ? "page" : undefined}
                  onClick={close}
                >
                  <UserIcon size={22} />
                  <span className="more-sheet__label">
                    Profile
                    {!address && <span className="more-sheet__hint">Sign in to view</span>}
                  </span>
                </Link>
              </li>
            </ul>
          </div>
        </>
      )}

      <nav className="bottom-nav" aria-label="Main">
        {PAGES.filter((p) => IN_BAR.includes(p.id)).map(({ id, label, short, href, Icon }) => (
          <Link
            key={id}
            href={href}
            className={`bottom-nav__item ${current === id && !open ? "bottom-nav__item--active" : ""}`}
            aria-current={current === id ? "page" : undefined}
            aria-label={label}
          >
            <Icon size={22} />
            {/* The shorter label replaces the full one only where the full one can't fit (index.css). */}
            <span className="bottom-nav__label">{label}</span>
            {short && <span className="bottom-nav__label bottom-nav__label--short" aria-hidden="true">{short}</span>}
          </Link>
        ))}
        <button
          ref={moreRef}
          type="button"
          className={`bottom-nav__item ${moreActive ? "bottom-nav__item--active" : ""}`}
          aria-expanded={open}
          aria-controls={open ? sheetId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <GridIcon size={22} />
          <span className="bottom-nav__label">More</span>
        </button>
      </nav>
    </>
  );
}
