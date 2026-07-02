"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useContractPublicClient } from "../hooks/useContractData";
import { useGDollarBalance } from "../hooks/useGDollarBalance";
import { formatUnits } from "viem";

export default function WalletButton() {
  const { address, logout, authType } = useAuth();
  const publicClient = useContractPublicClient();
  const { balance: gDollarBalance, refetch: refetchGDollar } = useGDollarBalance();
  const [celoBalance, setCeloBalance] = useState<string>("0");
  const [isOpen, setIsOpen] = useState(false);

  // Fetch CELO balance
  useEffect(() => {
    if (!address || !publicClient) return;

    const fetchBalance = async () => {
      try {
        const balance = await publicClient.getBalance({ address: address as `0x${string}` });
        setCeloBalance(formatUnits(balance, 18));
      } catch (err) {
        console.error("Error fetching CELO balance:", err);
      }
    };

    fetchBalance();
    // Refresh balance every 10 seconds
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [address, publicClient]);

  // Listen for score submissions and refetch G$ balance
  useEffect(() => {
    const handleScoreSubmitted = async () => {
      // Wait a moment for the transaction to be fully processed
      await new Promise((r) => setTimeout(r, 1500));
      await refetchGDollar();
    };

    window.addEventListener("scoreSubmitted", handleScoreSubmitted);
    return () => window.removeEventListener("scoreSubmitted", handleScoreSubmitted);
  }, [refetchGDollar]);

  if (!address) return null;

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const balanceShort = parseFloat(celoBalance).toFixed(3);

  return (
    <div className="wallet-button-container">
      <button
        className="btn btn--xs wallet-button"
        onClick={() => setIsOpen(!isOpen)}
        title="Click to view wallet details"
      >
        <span className="wallet-button__balance" title={`${celoBalance} CELO`}>
          {balanceShort} Ⓒ
        </span>
        <span className="wallet-button__address">{short}</span>
      </button>

      {isOpen && (
        <div className="wallet-dropdown">
          <div className="wallet-dropdown__content">
            <div className="wallet-dropdown__section">
              <label className="wallet-dropdown__label">Wallet Address</label>
              <div className="wallet-dropdown__value">
                <code>{address}</code>
              </div>
            </div>

            <div className="wallet-dropdown__section">
              <label className="wallet-dropdown__label">CELO Balance</label>
              <div className="wallet-dropdown__value">
                {balanceShort} Ⓒ
              </div>
            </div>

            <div className="wallet-dropdown__section">
              <label className="wallet-dropdown__label">G$ Balance</label>
              <div className="wallet-dropdown__value">
                {gDollarBalance ? parseFloat(gDollarBalance).toFixed(2) : "0.00"} G$
              </div>
            </div>

            <div className="wallet-dropdown__section">
              <label className="wallet-dropdown__label">Auth Method</label>
              <div className="wallet-dropdown__value">
                {authType === "magic" ? "Magic.link Email" : authType === "minipay" ? "Web3 Wallet" : "Unknown"}
              </div>
            </div>

            <button
              className="btn btn--sm btn--danger"
              onClick={() => {
                setIsOpen(false);
                logout();
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
