import { http, createConfig, fallback } from "wagmi";
import { injected, walletConnect, metaMask } from "wagmi/connectors";
import { celo } from "wagmi/chains";

// ── MiniPay wagmi config ─────────────────────────────────────────────────────
// Ported from FocusPet (the sibling Celo Mini App). Inside MiniPay, the wallet
// is the injected `window.ethereum` provider, so we use a plain wagmi config
// with a single injected connector and auto-connect.

// Wipe any stale wagmi connector sessions before createConfig runs, so they
// can't load and override the MiniPay injected connector. Mirrors FocusPet.
// Only runs inside MiniPay.
if (typeof window !== "undefined" && (window.ethereum as { isMiniPay?: boolean } | undefined)?.isMiniPay) {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("wagmi"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* localStorage unavailable — nothing to wipe */
  }
}

export const miniPayConnector = injected({
  target() {
    return {
      id: "injected",
      name: "MiniPay",
      // Function form is resolved lazily at connect time (SSR-safe) and may
      // return undefined before MiniPay injects its provider.
      provider(w) {
        const win = (w ?? (typeof window !== "undefined" ? window : undefined)) as
          | (Window & { ethereum?: import("viem").EIP1193Provider })
          | undefined;
        return win?.ethereum;
      },
    };
  },
});

// Celo mainnet read RPCs (no API keys). Same hosts the rest of the app uses.
const transport = fallback([
  http("https://forno.celo.org"),
  http("https://rpc.ankr.com/celo"),
]);

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!walletConnectProjectId) {
  console.warn("⚠️ NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set — WalletConnect will not work");
}

// WalletConnect connector with fallback relays for better connectivity
const walletConnectConnector = walletConnectProjectId
  ? walletConnect({
      projectId: walletConnectProjectId,
      // Try multiple relays in case primary fails
      relayUrl: "wss://relay.walletconnect.org",
    })
  : null;

export const miniPayWagmiConfig = createConfig({
  chains: [celo],
  connectors: [
    miniPayConnector,
    injected(), // MetaMask and other browser wallets
    metaMask(),
    ...(walletConnectConnector ? [walletConnectConnector] : []), // WalletConnect v2
  ],
  transports: { [celo.id]: transport },
});
