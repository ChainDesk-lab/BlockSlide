import { useReadContract } from "wagmi";
import { GAME2048_MERGED_ABI } from "../lib/abiMerged";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";

/**
 * The player's on-chain undo credits. Shares wagmi's query cache with the
 * shop's read of the same value, so a refetch here updates both.
 */
export function useUndoCredits(address: `0x${string}` | undefined) {
  const { data, refetch } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_MERGED_ABI,
    functionName: "undoCredits",
    args: address ? [address] : undefined,
    query: { enabled: !!address && CONTRACT_DEPLOYED },
  });
  return { undoCredits: (data as bigint | undefined) ?? 0n, refetchUndoCredits: refetch };
}
