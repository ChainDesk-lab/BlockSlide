import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { celoSepolia, celo } from "viem/chains";
import { http } from "wagmi";

const env = (import.meta as unknown as { env: Record<string, string> }).env;

// RainbowKit requires a non-empty projectId or it throws at startup and
// the whole app shows a blank screen. Injected wallets (MetaMask, etc.)
// work fine with the placeholder. WalletConnect QR-code login requires a
// real ID from https://cloud.walletconnect.com — add it to .env.local as
// VITE_WALLETCONNECT_PROJECT_ID.
const projectId =
  env.VITE_WALLETCONNECT_PROJECT_ID?.trim() || "blockslide-placeholder";

export const wagmiConfig = getDefaultConfig({
  appName: "BlockSlide",
  projectId,
  chains: [celoSepolia, celo],
  transports: {
    [celoSepolia.id]: http("https://forno.celo-sepolia.celo-testnet.org"),
    [celo.id]: http("https://forno.celo.org"),
  },
  ssr: false,
});
