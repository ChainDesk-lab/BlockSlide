import { useAccount, useReadContract } from "wagmi";
import { IDENTITY_ABI } from "../lib/abi";
import { IDENTITY_ADDRESS } from "../lib/constants";

export type IdentityStatus = "loading" | "verified" | "unverified" | "no-wallet";

export function useIdentity() {
  const { address } = useAccount();

  const { data, isLoading, refetch } = useReadContract({
    address: IDENTITY_ADDRESS,
    abi: IDENTITY_ABI,
    functionName: "isWhitelisted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  let status: IdentityStatus;
  if (!address)       status = "no-wallet";
  else if (isLoading) status = "loading";
  else if (data)      status = "verified";
  else                status = "unverified";

  return { status, isVerified: status === "verified", refetch };
}
