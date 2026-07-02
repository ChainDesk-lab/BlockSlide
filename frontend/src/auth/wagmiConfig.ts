import { http, createConfig, fallback } from "wagmi";
import { injected, walletConnect, metaMask } from "wagmi/connectors";
import { celo } from "wagmi/chains";

// Celo mainnet read RPCs (no API keys)
const transport = fallback([
  http("https://forno.celo.org"),
  http("https://rpc.ankr.com/celo"),
]);

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!walletConnectProjectId) {
  console.warn("⚠️ NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set — WalletConnect will not work");
}

const walletConnectConnector = walletConnectProjectId
  ? walletConnect({
      projectId: walletConnectProjectId,
      relayUrl: "wss://relay.walletconnect.org",
    })
  : null;

export const wagmiConfig = createConfig({
  chains: [celo],
  connectors: [
    injected(), // MetaMask and other browser wallets
    metaMask(),
    ...(walletConnectConnector ? [walletConnectConnector] : []), // WalletConnect v2
  ],
  transports: { [celo.id]: transport },
});
