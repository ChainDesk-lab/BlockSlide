import { http, createConfig, fallback } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
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
    // Use only generic injected connector with multiInjectedProviderDiscovery (wagmi v2 default).
    // With 7+ wallet extensions installed, the targeted metaMask connector fails with
    // "Provider not found" after logout+reload because its discovery mechanism doesn't
    // reinitialize properly when multiple wallets are present and fighting over window.ethereum.
    // Generic injected() uses EIP-6963 which is more robust: each wallet announces itself,
    // and we let wagmi handle the discovery without assuming a specific target.
    injected(),
    ...(walletConnectConnector ? [walletConnectConnector] : []), // WalletConnect v2
  ],
  transports: { [celo.id]: transport },
});
