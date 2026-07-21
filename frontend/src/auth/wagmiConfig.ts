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
    // injected() alone covers MetaMask and other browser-extension wallets by
    // talking directly to window.ethereum. The dedicated metaMask() connector
    // (MetaMask SDK) is built for mobile/deep-link flows and is unreliable at
    // producing a working useWalletClient() signer for a plain desktop
    // browser-extension connection — registering both caused useWalletClient()
    // to silently never resolve for a subset of wallet users, even though
    // useAccount() correctly showed them as connected.
    injected(),
    ...(walletConnectConnector ? [walletConnectConnector] : []), // WalletConnect v2
  ],
  transports: { [celo.id]: transport },
});
