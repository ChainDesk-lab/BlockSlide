import { useAccount } from "wagmi";
import { useWeb3AuthDisconnect } from "@web3auth/modal/react";

export default function WalletButton() {
  const { address } = useAccount();
  const { disconnect, loading } = useWeb3AuthDisconnect();

  if (!address) return null;

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <button
      className="btn btn--xs"
      onClick={() => disconnect()}
      disabled={loading}
      title={`${address} — click to disconnect`}
    >
      {loading ? "…" : short}
    </button>
  );
}
