"use client";

import dynamic from "next/dynamic";

// The app is a wallet-based client SPA (same as the original Vite build), so it
// is rendered client-only. This avoids server-side execution of browser/wallet
// APIs (localStorage, window, WalletConnect) and keeps behavior identical.
// Providers are now at the root layout level via ClientLayout, so we only render App.
const App = dynamic(() => import("../src/App"), { ssr: false });

export default function Page() {
  return <App />;
}
