import { http, createConfig, fallback } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { celo } from "wagmi/chains";

// Celo mainnet read RPCs (no API keys)
const transport = fallback([
  http("https://forno.celo.org"),
  http("https://rpc.ankr.com/celo"),
]);

// Canonical origin advertised in the WalletConnect session metadata. The wallet
// app shows this on its approval screen and uses it to send the user back here
// after they approve, so it must match the deployed origin. Override per
// environment with NEXT_PUBLIC_APP_URL (e.g. a preview deployment).
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "https://blockslide.app";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// True when WalletConnect is usable. When false, mobile browsers have no
// deep-link connect path and the UI falls back to opening BlockSlide inside the
// MetaMask app's own browser.
export const hasWalletConnect = Boolean(walletConnectProjectId);

if (!walletConnectProjectId) {
  console.warn(
    "⚠️ NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set — mobile wallet connect " +
      "(WalletConnect) is disabled. Set it in the deployment env from a project " +
      "at https://cloud.reown.com to enable the deep-link connect flow.",
  );
}

// wagmi's walletConnect connector runs an eager `setup()` that constructs the
// underlying @walletconnect / @reown/appkit provider, which touches `indexedDB`.
// That call fires the first time `config.connectors` is read — during Next's
// static generation of `/` (the wagmi tree is server-rendered) — where
// `indexedDB` doesn't exist, throwing `ReferenceError` into the build logs.
// Wallet connections only ever happen in the browser, and this module is
// evaluated once per bundle (server vs client), so instantiating the connector
// only when `window` exists keeps it entirely out of the server/SSG path.
const isBrowser = typeof window !== "undefined";

const walletConnectConnector =
  walletConnectProjectId && isBrowser
    ? walletConnect({
        projectId: walletConnectProjectId,
        relayUrl: "wss://relay.walletconnect.org",
        // We handle the pairing URI ourselves (WalletSelector deep-links it into
        // the wallet app on mobile). WalletConnect's own modal is unreliable at
        // opening inside a mobile browser, and routing around it keeps the flow
        // a single redirect: tap MetaMask -> approve in MetaMask -> back here.
        showQrModal: false,
        metadata: {
          name: "BlockSlide",
          description: "Play 2048 onchain and earn G$ on Celo",
          url: APP_URL,
          icons: [`${APP_URL}/android-chrome-512x512.png`],
        },
      })
    : null;

export const wagmiConfig = createConfig({
  chains: [celo],
  connectors: [
    // Generic injected connector with multiInjectedProviderDiscovery (wagmi v2
    // default / EIP-6963). Each browser-extension wallet announces itself, so we
    // don't have to assume a specific target — more robust with several wallet
    // extensions installed than a targeted metaMask() connector.
    injected(),
    // WalletConnect v2 — the connect path for mobile browsers and desktop
    // browsers with no extension. Omitted entirely when no project id is set.
    ...(walletConnectConnector ? [walletConnectConnector] : []),
  ],
  transports: { [celo.id]: transport },
});
