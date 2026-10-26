import { useReadContract } from "wagmi";
import { GAME2048_MERGED_ABI } from "../lib/abiMerged";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";
import { undoModeFrom, type UndoMode } from "../lib/undoHistory";

/**
 * Which way the live contract spends undo credits. supportsUndoAtSubmit()
 * exists only after the undo-at-submit upgrade; on the current implementation
 * the call reverts, so the app keeps the one-transaction-per-undo flow. No app
 * redeploy is needed when the upgrade ships — this read flips by itself.
 */
export function useUndoMode(): UndoMode {
  const read = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_MERGED_ABI,
    functionName: "supportsUndoAtSubmit",
    query: { enabled: CONTRACT_DEPLOYED, retry: false, staleTime: 5 * 60_000 },
  });
  return undoModeFrom({ status: read.status, data: read.data });
}
