import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { celoSepolia, celo } from "viem/chains";
import { http, fallback } from "wagmi";
import { isWeb3AuthConfigured } from "./lib/web3auth";

const env = (import.meta as unknown as { env: Record<string, string> }).env;

const projectId =
  env.VITE_WALLETCONNECT_PROJECT_ID?.trim() || "blockslide-placeholder";

// Base wagmi config with RainbowKit connectors (MetaMask, Coinbase Wallet, etc.)
// Web3Auth email login is triggered separately via useWeb3Auth hook
export const wagmiConfig = getDefaultConfig({
  appName: "BlockSlide",
  projectId,
  chains: [celoSepolia, celo],
  transports: {
    [celoSepolia.id]: fallback([
      http("https://forno.celo-sepolia.celo-testnet.org"),
      http("https://alfajores-forno.celo-testnet.org"),
    ]),
    [celo.id]: fallback([
      http("https://rpc.ankr.com/celo"),
      http("https://celo.drpc.org"),
      http("https://forno.celo.org"),
    ]),
  },
  ssr: false,
});

// Export a flag to indicate if Web3Auth is configured
export const isWeb3AuthAvailable = isWeb3AuthConfigured();
