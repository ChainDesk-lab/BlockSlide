import { useAuth } from "../auth/AuthContext";

export default function WalletButton() {
  const { address, logout } = useAuth();

  if (!address) return null;

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <button
      className="btn btn--xs"
      onClick={() => logout()}
      title={`${address} — click to disconnect`}
    >
      {short}
    </button>
  );
}
