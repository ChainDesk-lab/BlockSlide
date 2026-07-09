"use client";

import dynamic from "next/dynamic";

// Disable SSR — the page uses wallet hooks and browser-only APIs (localStorage,
// WalletConnect, Magic.link), same pattern as the main app page.
const LeaderboardPageRoot = dynamic(
  () => import("../../src/components/LeaderboardPageRoot"),
  { ssr: false },
);

export default function LeaderboardPage() {
  return <LeaderboardPageRoot />;
}
