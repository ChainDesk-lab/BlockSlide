"use client";

import dynamic from "next/dynamic";

// The app is a wallet-based client SPA (same as the original Vite build), so it
// is rendered client-only. This avoids server-side execution of browser/wallet
// APIs (localStorage, window, WalletConnect) and keeps behavior identical.
const AppRoot = dynamic(() => import("./AppRoot"), { ssr: false });

export default function Page() {
  return <AppRoot />;
}
