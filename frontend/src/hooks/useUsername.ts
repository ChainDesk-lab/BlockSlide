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
import { useContractAddress, useContractPublicClient } from "./useContractData";
import { useAuth } from "../auth/AuthContext";
import { useWalletClient } from "wagmi";
import { getMagic, isMagicConfigured } from "../magic";

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** Read + set the connected wallet's on-chain display name. */
export function useUsername() {
  const { authType } = useAuth();
  const address = useContractAddress();
  const publicClient = useContractPublicClient();
  const { data: wagmiWalletClient } = useWalletClient({ chainId: TARGET_CHAIN.id });
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
        try {
          // For Magic.link, skip eth_signTransaction (not reliable) and go straight to eth_sendTransaction
          if (authType === "magic" && isMagicConfigured) {
            const magic = getMagic();
            const provider = magic.rpcProvider as any;

            hash = await provider.request({
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
          } else {
            // For other auth types, use viem's signTransaction
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const signed = await (signTransaction as any)(wagmiWalletClient, { ...base, type: "eip1559" });
            hash = await publicClient.sendRawTransaction({ serializedTransaction: signed as `0x${string}` });
          }
        } catch (signErr: unknown) {
          const msg = ((signErr as Error)?.message ?? "").toLowerCase();
          const code = (signErr as { code?: number })?.code;
          const name = (signErr as { name?: string })?.name ?? "";
          // See useGameSession: some providers reject eth_signTransaction;
          // fall back to eth_sendTransaction.
          const unsupported =
            name === "MethodNotSupportedRpcError" ||
            name === "UnauthorizedProviderError" ||
            code === 4100 ||
            code === -32601 ||
            msg.includes("not supported") ||
            msg.includes("authoriz") ||
            msg.includes("eth_signtransaction");
          if (!unsupported) throw signErr;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          hash = await (wagmiWalletClient as any).request({
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
    [address, wagmiWalletClient, publicClient, refetch, triggerNoGas, authType],
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
