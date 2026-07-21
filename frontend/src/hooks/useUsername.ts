import { useCallback, useEffect, useState } from "react";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  toHex,
} from "viem";
import { signTransaction } from "viem/actions";
import { GAME2048_ABI } from "../lib/abi";
import { GAME2048_ADDRESS, TARGET_CHAIN } from "../lib/constants";
import { isInsufficientGasError } from "../lib/gasError";
import { useNoGas } from "../contexts/NoGasContext";
import { useContractAddress, useContractPublicClient, useContractWalletClient } from "./useContractData";
import { useAuth } from "../auth/AuthContext";
import { useWalletClient } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { wagmiConfig } from "../auth/wagmiConfig";
import { getMagic, isMagicConfigured } from "../magic";

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** Read + set the connected wallet's on-chain display name. */
export function useUsername() {
  const { authType } = useAuth();
  const address = useContractAddress();
  const publicClient = useContractPublicClient();
  const walletClient = useContractWalletClient();
  const { triggerNoGas } = useNoGas();

  const [current, setCurrent] = useState<string | undefined>();
  const [isReading, setIsReading] = useState(false);

  // Read username from contract whenever address changes
  useEffect(() => {
    if (!address || !publicClient) return;

    const readUsername = async () => {
      setIsReading(true);
      try {
        const result = await publicClient.readContract({
          address: GAME2048_ADDRESS,
          abi: GAME2048_ABI,
          functionName: "usernames",
          args: [address],
        });
        setCurrent(result as string);
      } catch (err) {
        console.error("Error reading username:", err);
        setCurrent("");
      } finally {
        setIsReading(false);
      }
    };

    readUsername();
  }, [address, publicClient]);

  const refetch = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      const result = await publicClient.readContract({
        address: GAME2048_ADDRESS,
        abi: GAME2048_ABI,
        functionName: "usernames",
        args: [address],
      });
      setCurrent(result as string);
    } catch (err) {
      console.error("Error refetching username:", err);
    }
  }, [address, publicClient]);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  // Clear transient feedback when the wallet changes
  useEffect(() => {
    setError(null);
    setSavedName(null);
  }, [address]);

  const save = useCallback(
    async (name: string) => {
      setError(null);
      setSavedName(null);

      if (!address || !publicClient) {
        setError("Connect your wallet first.");
        return;
      }
      const trimmed = name.trim();
      if (!USERNAME_RE.test(trimmed)) {
        setError("3–20 characters, letters, numbers and underscores only.");
        return;
      }

      const data = encodeFunctionData({
        abi: GAME2048_ABI,
        functionName: "setUsername",
        args: [trimmed],
      });

      setIsSaving(true);
      try {
        // Simulate first so "name taken" surfaces cleanly without a failed tx.
        try {
          await publicClient.simulateContract({
            account: address,
            address: GAME2048_ADDRESS,
            abi: GAME2048_ABI,
            functionName: "setUsername",
            args: [trimmed],
          });
        } catch (simErr) {
          if (
            simErr instanceof BaseError &&
            simErr.walk((e) => e instanceof ContractFunctionRevertedError)
          ) {
            setError(parseUsernameError(simErr as Error));
            setIsSaving(false);
            return;
          }
          // network/RPC hiccup during simulate — proceed and let the tx decide
        }

        // Fetch nonce from our public client (ankr), never the wallet's RPC.
        let nonce: number | undefined;
        try {
          nonce = await publicClient.getTransactionCount({ address, blockTag: "pending" });
        } catch { /* let the wallet manage it */ }

        const base = {
          account: address,
          to: GAME2048_ADDRESS,
          data,
          gas: 120_000n,
          maxFeePerGas: 500_000_000_000n,
          maxPriorityFeePerGas: 2_500_000_000n,
          ...(nonce !== undefined ? { nonce } : {}),
          chainId: TARGET_CHAIN.id,
        } as const;

        let hash: `0x${string}`;
        // Resolved once up-front so both the primary signTransaction path and
        // the eth_sendTransaction fallback below use the same client — wagmi's
        // reactive useWalletClient() can still be resolving right after a
        // fresh connect/reload, so fetch it imperatively if needed instead of
        // treating "not resolved yet" as unusable.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let resolvedWalletClient: any = wagmiWalletClient;
        if (!(authType === "magic" && isMagicConfigured) && !resolvedWalletClient) {
          try {
            // Cast the call itself — viem's Client generics recurse in a way
            // that trips a spurious "two different types with this name"
            // error across module-resolution boundaries; the value is used
            // as `any` throughout this file regardless.
            resolvedWalletClient = await (getWalletClient as any)(wagmiConfig, { chainId: TARGET_CHAIN.id });
          } catch (err) {
            console.error("[useUsername] getWalletClient fallback failed:", err);
          }
        }
        try {
          // For Magic.link, use sendTransaction with timeout
          if (authType === "magic" && isMagicConfigured) {
            const magic = getMagic();
            const provider = magic.rpcProvider as any;

            // Add timeout to prevent infinite hanging
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Transaction request timed out after 30 seconds. Check wallet for pending transactions or insufficient gas.")), 30000)
            );

            try {
              hash = await Promise.race([
                provider.request({
                  method: "eth_sendTransaction",
                  params: [{
                    from: address,
                    to: GAME2048_ADDRESS,
                    data,
                    gas: "0x1d4c0", // 120000 in hex
                    maxFeePerGas: "0x7428000000", // 500 Gwei in hex
                    maxPriorityFeePerGas: "0x95a0f200", // 2.5 Gwei in hex
                    chainId: "0xa4ec", // Celo mainnet
                    type: "0x2",
                    ...(nonce !== undefined ? { nonce: `0x${nonce.toString(16)}` } : {}),
                  }],
                }),
                timeoutPromise,
              ]) as `0x${string}`;

              console.log("Transaction sent:", hash);
            } catch (timeoutErr) {
              // If timeout, provide helpful message
              if ((timeoutErr as Error).message.includes("timed out")) {
                triggerNoGas(); // Show the gas modal
                setError("Transaction is taking too long. You may need CELO for gas. Please check your wallet.");
                setIsSaving(false);
                return;
              }
              throw timeoutErr;
            }
          } else {
            if (!resolvedWalletClient) {
              setError("Wallet is still connecting — please wait a moment and try again.");
              setIsSaving(false);
              return;
            }

            // For other auth types, use viem's signTransaction
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const signed = await (signTransaction as any)(resolvedWalletClient, { ...base, type: "eip1559" });
            const signed = await (signTransaction as any)(walletClient, { ...base, type: "eip1559" });
            hash = await publicClient.sendRawTransaction({ serializedTransaction: signed as `0x${string}` });
          }
        } catch (signErr: unknown) {
          const errMessage = (signErr as Error)?.message ?? String(signErr);
          const msg = errMessage.toLowerCase();
          const code = (signErr as { code?: number })?.code;
          const name = (signErr as { name?: string })?.name ?? "";

          console.error("Transaction error:", { msg, code, name, errMessage });

          // For Magic.link, provide specific error guidance
          if (authType === "magic") {
            if (msg.includes("insufficient balance") || msg.includes("insufficient funds") || msg.includes("insufficient gas")) {
              triggerNoGas();
              setError("You need CELO in your wallet to pay for gas. A small amount (0.01 CELO) is enough.");
              setIsSaving(false);
              return;
            }
            if (msg.includes("user denied") || msg.includes("user rejected") || msg.includes("cancelled")) {
              setError("Transaction was cancelled. Your username was not saved.");
              setIsSaving(false);
              return;
            }
            if (msg.includes("timed out") || msg.includes("timeout")) {
              setError("Request timed out. Please try again.");
              setIsSaving(false);
              return;
            }
            // Generic Magic.link error
            setError("Failed to save username. Please try again or check your wallet.");
            setIsSaving(false);
            return;
          }

          // For other auth types, try fallback to eth_sendTransaction
          const unsupported =
            name === "MethodNotSupportedRpcError" ||
            name === "UnauthorizedProviderError" ||
            code === 4100 ||
            code === -32601 ||
            msg.includes("not supported") ||
            msg.includes("authoriz");

          if (!unsupported) throw signErr;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          hash = await (resolvedWalletClient as any).request({
          hash = await (walletClient as any).request({
            method: "eth_sendTransaction",
            params: [{
              from: address,
              to: GAME2048_ADDRESS,
              data,
              gas: toHex(120_000n),
              maxFeePerGas: toHex(500_000_000_000n),
              maxPriorityFeePerGas: toHex(2_500_000_000n),
              chainId: toHex(TARGET_CHAIN.id),
              type: "0x2",
              ...(nonce !== undefined ? { nonce: toHex(nonce) } : {}),
            }],
          }) as `0x${string}`;
        }

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") {
          setError("Transaction reverted — that name may already be taken.");
        } else {
          setSavedName(trimmed);
          await refetch();
        }
      } catch (e) {
        if (isInsufficientGasError(e)) {
          triggerNoGas();
          setError("You need a little CELO for gas — see the pop-up.");
        } else {
          setError(parseUsernameError(e as Error));
        }
      } finally {
        setIsSaving(false);
      }
    },
    [address, walletClient, publicClient, refetch, triggerNoGas, authType],
  );

  return {
    username: (current as string | undefined)?.trim() || "",
    isLoading: isReading,
    isSaving,
    error,
    savedName,
    save,
    clearFeedback: () => { setError(null); setSavedName(null); },
  };
}

function parseUsernameError(error: Error): string {
  if (error instanceof BaseError) {
    const revert = error.walk(
      (e): e is ContractFunctionRevertedError => e instanceof ContractFunctionRevertedError,
    );
    const name = (revert as { data?: { errorName?: string } } | undefined)?.data?.errorName;
    if (name === "UsernameTaken")   return "That name is already taken — try another.";
    if (name === "InvalidUsername") return "3–20 characters, letters, numbers and underscores only.";
    if (error.walk((e) => (e as { name?: string }).name === "UserRejectedRequestError"))
      return "Transaction rejected.";
  }
  const msg = error.message ?? "";
  if (msg.includes("UsernameTaken")) return "That name is already taken — try another.";
  if (msg.includes("rejected") || msg.includes("denied")) return "Transaction rejected.";
  return "Couldn't save your name — please try again.";
}
