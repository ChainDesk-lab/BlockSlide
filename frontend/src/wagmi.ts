import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { celoSepolia, celo as celoBase } from "viem/chains";
import { http, fallback } from "wagmi";

const env = (import.meta as unknown as { env: Record<string, string> }).env;

const projectId =
  env.VITE_WALLETCONNECT_PROJECT_ID?.trim() || "blockslide-placeholder";

// Override Celo's default RPC so RainbowKit's "Add Network" dialog configures
// MetaMask with ankr instead of forno. Forno rate-limits aggressively and
// returns "resource not available" for eth_estimateGas/eth_sendTransaction,
// which blocks the wallet signing prompt from ever appearing.
const celo = {
  ...celoBase,
  rpcUrls: {
    ...celoBase.rpcUrls,
    default: { http: ["https://rpc.ankr.com/celo"] },
  },
};

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
