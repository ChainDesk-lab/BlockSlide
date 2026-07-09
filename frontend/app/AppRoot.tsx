"use client";

import App from "../src/App";

/**
 * Thin shell that loads the main SPA client-side only.
 * Providers (wagmi, auth, toast, no-gas) live in app/ClientProviders.tsx
 * which is mounted once in the root layout — they are NOT duplicated here.
 */
export default function AppRoot() {
  return <App />;
}
