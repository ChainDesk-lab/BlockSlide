import dynamic from "next/dynamic";

// The app is a wallet-based client SPA that needs client-side execution for browser/wallet
// APIs (localStorage, window, WalletConnect). However, SSR is enabled to allow search
// engines to crawl the page and see metadata. The actual interactive content still
// renders client-side once the page loads.
// Providers are now at the root layout level via ClientLayout, so we only render App.
const App = dynamic(() => import("../src/App"), { ssr: true });

export default function Page() {
  return <App />;
}
