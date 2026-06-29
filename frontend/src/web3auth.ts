import {
  WEB3AUTH_NETWORK,
  CHAIN_NAMESPACES,
  WALLET_CONNECTORS,
} from "@web3auth/modal";
import { type Web3AuthContextConfig } from "@web3auth/modal/react";

// Web3Auth (MetaMask Embedded Wallets) client ID — create a project at
// https://dashboard.web3auth.io and whitelist your localhost + Vercel origins.
const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID ?? "";

export const isWeb3AuthConfigured = clientId.length > 0;

if (!isWeb3AuthConfigured && typeof window !== "undefined") {
  console.warn(
    "NEXT_PUBLIC_WEB3AUTH_CLIENT_ID is not set — login will not work until it is configured."
  );
}

// Web3Auth network. Defaults to Sapphire Mainnet (production / what ships on
// GitHub). For local dev with a devnet client ID, set
// NEXT_PUBLIC_WEB3AUTH_NETWORK=sapphire_devnet in .env.local.
const web3AuthNetwork =
  process.env.NEXT_PUBLIC_WEB3AUTH_NETWORK === "sapphire_devnet"
    ? WEB3AUTH_NETWORK.SAPPHIRE_DEVNET
    : WEB3AUTH_NETWORK.SAPPHIRE_MAINNET;

// One-time diagnostic so a client-ID ↔ network mismatch is obvious in the
// console. The clientId is bound to ONE network at creation and cannot switch;
// if this `network` doesn't match the dashboard, email login silently loops.
if (typeof window !== "undefined" && isWeb3AuthConfigured) {
  console.info(
    `[Web3Auth] network=${web3AuthNetwork} clientId=${clientId.slice(0, 8)}…${clientId.slice(-4)} origin=${window.location.origin}`
  );
}

// Web3Auth config. The wagmi integration (@web3auth/modal/react/wagmi) derives
// its chains/connectors from here, so no separate wagmi createConfig is needed.
export const web3AuthContextConfig: Web3AuthContextConfig = {
  web3AuthOptions: {
    clientId,
    web3AuthNetwork,
    // The app is rendered client-only (dynamic ssr:false), so disable SSR mode.
    ssr: false,
    // Celo mainnet (chain 42220 / 0xa4ec) — the BlockSlide contract lives here.
    defaultChainId: "0xa4ec",
    chains: [
      {
        chainNamespace: CHAIN_NAMESPACES.EIP155,
        chainId: "0xa4ec",
        rpcTarget: "https://forno.celo.org",
        displayName: "Celo Mainnet",
        blockExplorerUrl: "https://celoscan.io",
        ticker: "CELO",
        tickerName: "Celo",
        logo: "https://cryptologos.cc/logos/celo-celo-logo.png",
      },
    ],
    // NOTE: do NOT add `uiConfig` here. It sets is_whitelabel=true on Web3Auth's
    // feature-access check — a PAID feature. On the free (base) plan + Sapphire
    // Mainnet that returns 403 and the login modal silently loops. (Devnet is
    // unrestricted, which is why local dev works with it.) Re-add only after
    // upgrading the Web3Auth plan.
    // Show both email passwordless login and external wallets in one modal.
    modalConfig: {
      connectors: {
        [WALLET_CONNECTORS.AUTH]: {
          label: "auth",
          showOnModal: true,
          loginMethods: {
            email_passwordless: {
              name: "email passwordless login",
              showOnModal: true,
            },
          },
        },
      },
      // false → external wallets (MetaMask, WalletConnect, injected) are listed.
      hideWalletDiscovery: false,
    },
  },
};
