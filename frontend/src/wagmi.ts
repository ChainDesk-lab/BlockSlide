import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { celo } from "viem/chains";
import { http, fallback } from "wagmi";

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
  "blockslide-placeholder";

// Base wagmi config with RainbowKit connectors (MetaMask, Coinbase Wallet, etc.).
// Celo mainnet only — the game contract is deployed on chain 42220.
export const wagmiConfig = getDefaultConfig({
  appName: "BlockSlide",
  projectId,
  chains: [celo],
  transports: {
    [celo.id]: fallback([
      http("https://rpc.ankr.com/celo"),
      http("https://celo.drpc.org"),
      http("https://forno.celo.org"),
    ]),
  },
  ssr: false,
});
