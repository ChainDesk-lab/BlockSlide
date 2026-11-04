import { useReadContracts } from "wagmi";
import { GAME2048_UBI_ABI } from "../lib/abiUbi";
import { CONTRACT_DEPLOYED, GAME2048_ADDRESS } from "../lib/constants";

export type UbiContributionInfo =
  | { status: "ready"; bps: bigint; recipient: `0x${string}` }
  | { status: "loading" }
  /** The live contract has no contribution (pre-upgrade), or the read failed. */
  | { status: "unavailable" };

/** The on-chain UBI contribution rate and recipient. Wallet not required. */
export function useUbiContribution(): UbiContributionInfo {
  const { data, status } = useReadContracts({
    contracts: [
      { address: GAME2048_ADDRESS, abi: GAME2048_UBI_ABI, functionName: "UBI_CONTRIBUTION_BPS" },
      { address: GAME2048_ADDRESS, abi: GAME2048_UBI_ABI, functionName: "ubiRecipient" },
    ],
    query: { enabled: CONTRACT_DEPLOYED, staleTime: 5 * 60_000, retry: false },
  });
  if (status === "pending") return { status: "loading" };
  const [rate, recipient] = data ?? [];
  if (rate?.status === "success" && recipient?.status === "success") {
    return { status: "ready", bps: rate.result as bigint, recipient: recipient.result as `0x${string}` };
  }
  return { status: "unavailable" };
}
