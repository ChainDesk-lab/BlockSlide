"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReadContracts } from "wagmi";
import { GuideContent, GuideNav, type GuidePrices } from "../../src/components/HowToPlayGuide";
import { GUIDE_SECTIONS } from "../../src/config/howToPlay";
import { bounties, getBountyStatus } from "../../src/config/bounties";
import { GAME2048_ADDRESS, CONTRACT_DEPLOYED } from "../../src/lib/constants";
import { useUndoAvailability } from "../../src/hooks/useUndoAvailability";
import { GAME2048_MERGED_ABI } from "../../src/lib/abiMerged";
import { priceLabel, toPriceRead } from "../../src/lib/shopPrice";
import "../../src/styles/how-to-play.css";

const PRICE_FNS = ["shieldPrice", "boost2xPrice", "boost5xPrice", "undoPrice"] as const;

/** Live shop prices, the same reads the Shop makes (no wallet needed). Never a hard-coded number. */
function useGuidePrices(): GuidePrices {
  const { data, status } = useReadContracts({
    contracts: PRICE_FNS.map((functionName) => ({ address: GAME2048_ADDRESS, abi: GAME2048_MERGED_ABI, functionName })),
    query: { enabled: CONTRACT_DEPLOYED },
  });
  const label = (i: number) => {
    const r = data?.[i];
    return priceLabel(toPriceRead({ data: r?.status === "success" ? (r.result as bigint) : undefined, status: r ? (r.status === "success" ? "success" : "error") : status === "error" ? "error" : "pending" }));
  };
  return { shield: label(0), boost2x: label(1), boost5x: label(2), undo: label(3) };
}

export default function HowToPlayPage() {
  const prices = useGuidePrices();
  const undo = useUndoAvailability();
  const current = bounties.find((b) => getBountyStatus(b) !== "ended") ?? bounties[bounties.length - 1];
  const bountyStatus = current ? getBountyStatus(current) : "ended";
  const [activeId, setActiveId] = useState(GUIDE_SECTIONS[0].id);
  // A section picked in the sidebar stays highlighted until the reader scrolls themselves: the
  // last sections can't reach the top of the screen, so scroll position alone would mark the wrong one.
  const picked = useRef<string | null>(null);

  // Highlight the section being read: the last one whose top has passed the upper third of the screen.
  useEffect(() => {
    const release = () => { picked.current = null; };
    const onScroll = () => {
      if (picked.current) return setActiveId(picked.current);
      const line = window.innerHeight * 0.33;
      let id = GUIDE_SECTIONS[0].id;
      for (const s of GUIDE_SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) id = s.id;
      }
      // At the very bottom the last section can't reach the line: count it as read.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) id = GUIDE_SECTIONS[GUIDE_SECTIONS.length - 1].id;
      setActiveId(id);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    for (const ev of ["wheel", "touchmove", "keydown"] as const) window.addEventListener(ev, release, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const ev of ["wheel", "touchmove", "keydown"] as const) window.removeEventListener(ev, release);
    };
  }, []);

  // Smooth-scroll to a section and keep the address bar's #hash in step, so a link can be shared.
  const navigate = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    picked.current = id;
    setActiveId(id);
  }, []);

  return (
    <main className="main">
      <div className="page htp2">
        <header className="htp2__hero">
          <p className="kicker kicker--green">The player&apos;s guide</p>
          <h1 className="page__title">How to Play BlockSlide</h1>
          <p className="page__lede page__lede--wide">Master the game, earn rewards, climb the leaderboard.</p>
        </header>
        <div className="htp2__layout">
          <aside className="htp2__aside"><GuideNav activeId={activeId} onNavigate={navigate} /></aside>
          <GuideContent prices={prices} undoEnabled={undo.available} bountyStatus={bountyStatus} />
        </div>
      </div>
    </main>
  );
}
