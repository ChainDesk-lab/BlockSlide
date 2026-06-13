import { useState } from "react";
import { maxUint256 } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ERC20_ABI, GAME2048_ABI } from "../lib/abi";
import { GAME2048_ADDRESS, G_DOLLAR_ADDRESS, CONTRACT_DEPLOYED } from "../lib/constants";

export type ShopAction = "approve" | "shield" | "boost2" | "boost5" | null;

export function useShop() {
  const { address } = useAccount();
  const enabled = !!address && CONTRACT_DEPLOYED;

  const { writeContractAsync } = useWriteContract();
  const [pendingAction, setPendingAction] = useState<ShopAction>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);

  const { isLoading: isTxPending } = useWaitForTransactionReceipt({ hash: txHash });

  // ── Shop prices ────────────────────────────────────────────────────────────
  const { data: shieldPrice  } = useReadContract({ address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "shieldPrice",   query: { enabled } });
  const { data: boost2xPrice } = useReadContract({ address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "boost2xPrice",  query: { enabled } });
  const { data: boost5xPrice } = useReadContract({ address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "boost5xPrice",  query: { enabled } });

  // ── Player state ───────────────────────────────────────────────────────────
  const { data: shieldCount, refetch: refetchShield } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "shieldCount",
    args: address ? [address] : undefined, query: { enabled },
  });
  const { data: xpBoostRaw, refetch: refetchBoost } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "xpBoost",
    args: address ? [address] : undefined, query: { enabled },
  });
  const { data: playerXp } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "xp",
    args: address ? [address] : undefined, query: { enabled },
  });
  const { data: streakCount } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "streakCount",
    args: address ? [address] : undefined, query: { enabled },
  });

  // ── G$ balance & allowance ─────────────────────────────────────────────────
  const { data: gdBalance, refetch: refetchBalance } = useReadContract({
    address: G_DOLLAR_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: { enabled },
  });
  const { data: gdAllowance, refetch: refetchAllowance } = useReadContract({
    address: G_DOLLAR_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
    args: address ? [address, GAME2048_ADDRESS] : undefined, query: { enabled },
  });

  const refetchAll = () => {
    refetchShield();
    refetchBoost();
    refetchBalance();
    refetchAllowance();
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  const run = async (action: ShopAction, fn: () => Promise<`0x${string}`>) => {
    setError(null);
    setPendingAction(action);
    try {
      const hash = await fn();
      setTxHash(hash);
      // Refetch after a short wait for the node to index
      setTimeout(refetchAll, 3000);
    } catch (e: any) {
      const msg: string = e?.shortMessage ?? e?.message ?? "Transaction failed";
      if (!msg.toLowerCase().includes("rejected") && !msg.toLowerCase().includes("denied")) {
        setError(msg.slice(0, 120));
      }
    } finally {
      setPendingAction(null);
    }
  };

  const approve = () =>
    run("approve", () =>
      writeContractAsync({
        address: G_DOLLAR_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [GAME2048_ADDRESS, maxUint256],
      })
    );

  const buyShield = () =>
    run("shield", () =>
      writeContractAsync({
        address: GAME2048_ADDRESS,
        abi: GAME2048_ABI,
        functionName: "buyStreakShield",
      })
    );

  const buyBoost = (multiplier: 2 | 5) =>
    run(multiplier === 2 ? "boost2" : "boost5", () =>
      writeContractAsync({
        address: GAME2048_ADDRESS,
        abi: GAME2048_ABI,
        functionName: "buyXpBoost",
        args: [multiplier],
      })
    );

  const isApproved = (price: bigint | undefined) =>
    price !== undefined && gdAllowance !== undefined && gdAllowance >= price;

  const canAfford = (price: bigint | undefined) =>
    price !== undefined && gdBalance !== undefined && gdBalance >= price;

  const xpBoost = xpBoostRaw
    ? { multiplier: xpBoostRaw[0], expiry: xpBoostRaw[1] }
    : null;

  const boostActive =
    xpBoost !== null &&
    xpBoost.multiplier > 0 &&
    xpBoost.expiry > BigInt(Math.floor(Date.now() / 1000));

  return {
    shieldPrice, boost2xPrice, boost5xPrice,
    shieldCount: shieldCount ?? 0n,
    xpBoost, boostActive,
    playerXp: playerXp ?? 0n,
    streakCount: streakCount ?? 0n,
    gdBalance: gdBalance ?? 0n,
    gdAllowance: gdAllowance ?? 0n,
    pendingAction, isTxPending, error,
    approve, buyShield, buyBoost,
    isApproved, canAfford,
  };
}
