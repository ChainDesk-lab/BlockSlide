import { useCallback, useState } from "react";
import { encodeFunctionData, erc20Abi, toHex } from "viem";
import { useWriteContract } from "wagmi";
import { useAuth } from "../auth/AuthContext";
import { useSigner } from "./useSigner";
import { useContractAddress, useContractPublicClient } from "./useContractData";
import { useNoGas } from "../contexts/NoGasContext";
import { isInsufficientGasError } from "../lib/gasError";
import { classifyTxError } from "../lib/txErrors";
import { G_DOLLAR_ADDRESS, TARGET_CHAIN } from "../lib/constants";

export type SendStatus =
  | { phase: "idle" }
  | { phase: "signing" }
  | { phase: "confirming"; hash: `0x${string}` }
  | { phase: "done"; hash: `0x${string}` }
  | { phase: "error"; message: string; hash?: `0x${string}` };

/**
 * Sends G$ from the player's wallet to another address: a plain ERC-20 transfer on Celo.
 * Email (Magic) wallets have no wagmi connection, so they send through the game's signer with
 * eth_sendTransaction (the same shape as Shop purchases); browser wallets use wagmi.
 */
export function useSendGDollar() {
  const address = useContractAddress();
  const publicClient = useContractPublicClient();
  const { authType } = useAuth();
  const { signer } = useSigner();
  const { writeContractAsync } = useWriteContract();
  const { triggerNoGas } = useNoGas();
  const [status, setStatus] = useState<SendStatus>({ phase: "idle" });

  const reset = useCallback(() => setStatus({ phase: "idle" }), []);

  const send = useCallback(
    async (to: `0x${string}`, amountWei: bigint): Promise<boolean> => {
      if (!address || !publicClient) {
        setStatus({ phase: "error", message: "Your wallet is still connecting. Please wait a moment and try again." });
        return false;
      }
      setStatus({ phase: "signing" });
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amountWei] });
      let hash: `0x${string}`;
      try {
        if (authType === "magic") {
          if (!signer) throw new Error("Your wallet is still connecting. Please wait a moment and try again.");
          // Estimating first surfaces a failure (e.g. not enough G$) before the wallet is asked.
          const [gas, gasPrice] = await Promise.all([
            publicClient.estimateGas({ account: address, to: G_DOLLAR_ADDRESS, data }),
            publicClient.getGasPrice(),
          ]);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          hash = (await (signer as any).request({
            method: "eth_sendTransaction",
            params: [{ from: address, to: G_DOLLAR_ADDRESS, data, gas: toHex((gas * 12n) / 10n), gasPrice: toHex((gasPrice * 12n) / 10n) }],
          })) as `0x${string}`;
        } else {
          hash = await writeContractAsync({
            address: G_DOLLAR_ADDRESS, abi: erc20Abi, functionName: "transfer", args: [to, amountWei], chainId: TARGET_CHAIN.id,
          });
        }
      } catch (e) {
        if (isInsufficientGasError(e)) {
          triggerNoGas();
          setStatus({ phase: "error", message: "You need a little CELO to pay the network fee. Top up, then try again." });
        } else if (classifyTxError(e) === "user_rejected") {
          setStatus({ phase: "idle" });
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setStatus({ phase: "error", message: /chain|network/i.test(msg) ? "Switch your wallet to the Celo network, then try again." : "The transfer couldn't be sent. Nothing left your wallet. Please try again." });
        }
        return false;
      }

      setStatus({ phase: "confirming", hash });
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== "success") {
          setStatus({ phase: "error", hash, message: "The transfer failed on-chain, so no G$ was sent. You can check it on Celoscan." });
          return false;
        }
      } catch {
        // Sent but not seen yet: never suggest sending again, which could pay twice.
        setStatus({ phase: "error", hash, message: "The transfer was sent but hasn't confirmed yet. Check it on Celoscan before trying again." });
        return false;
      }
      setStatus({ phase: "done", hash });
      window.dispatchEvent(new Event("gdBalanceChanged"));
      return true;
    },
    [address, publicClient, authType, signer, writeContractAsync, triggerNoGas]
  );

  return { send, status, reset };
}
