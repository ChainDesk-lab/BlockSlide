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
    // Targeted specifically at MetaMask via wagmi's built-in EIP-6963 / shared
    // `.providers` array discovery, which filters out every wallet known to
    // impersonate MetaMask (Brave Wallet, Rabby, OKX, TokenPocket, etc.) and
    // binds only to the real MetaMask instance. A plain injected() with no
    // target just grabs `window.ethereum` as-is — with more than one wallet
    // extension installed, that global can silently point at a *different*
    // wallet than the one the user actually authorized, which read-only calls
    // (address, balance) don't expose but every signing call does. That
    // mismatch, not a timing issue, is what caused useWalletClient() /
    // getWalletClient() to never produce a usable signer for affected users.
    injected({ target: "metaMask" }),
    // Generic fallback for any other injected wallet ("Other Wallet" option) —
    // kept separate from the MetaMask-targeted connector above so neither
    // resolution strategy interferes with the other.
    injected(),
    ...(walletConnectConnector ? [walletConnectConnector] : []), // WalletConnect v2
  ],
  transports: { [celo.id]: transport },
});
