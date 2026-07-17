import { useState } from "react";
import { maxUint256 } from "viem";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ERC20_ABI, GAME2048_ABI } from "../lib/abi";
import { GAME2048_ADDRESS, G_DOLLAR_ADDRESS, CONTRACT_DEPLOYED } from "../lib/constants";
import { useContractAddress } from "./useContractData";

export type ShopAction = "approve" | "shield" | "boost2" | "boost5" | null;

export function useShop() {
  const address = useContractAddress();
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
      // Refetch after a short wait for the node to index, then notify other
      // components (e.g. WalletButton) that the G$ balance has changed.
      setTimeout(() => {
        refetchAll();
        window.dispatchEvent(new Event("gdBalanceChanged"));
      }, 3000);
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

  // ── Storage corruption detection & normalization ────────────────────────────
  // The deployed contract has storage layout misalignment (failed V5 upgrade).
  // Detect and normalize corrupted values with fallbacks.

  // Normalize streak: if value looks like a timestamp (>10000), it's corrupted
  const normalizedStreakCount = (() => {
    const val = streakCount ?? 0n;
    if (val > 10000n) {
      // Value looks like a timestamp, not a day count — corrupted
      console.warn(`Streak value suspiciously large: ${val}. Possible storage corruption. Showing as 0.`);
      return 0n;
    }
    return val;
  })();

  // Normalize prices: use contract values, fallback to expected prices if 0
  const SHIELD_PRICE_DEFAULT = 2150n * 10n ** 18n; // 2,150 G$ (~$0.25)
  const BOOST_2X_PRICE_DEFAULT = 3870n * 10n ** 18n; // 3,870 G$ (~$0.45)
  const BOOST_5X_PRICE_DEFAULT = 6880n * 10n ** 18n; // 6,880 G$ (~$0.80)

  const normalizedShieldPrice = shieldPrice ?? SHIELD_PRICE_DEFAULT;
  const normalizedBoost2xPrice = boost2xPrice ?? BOOST_2X_PRICE_DEFAULT;
  const normalizedBoost5xPrice = boost5xPrice ?? BOOST_5X_PRICE_DEFAULT;

  // Sanity-check XP: if it's suspiciously large (like a timestamp), log warning
  if ((playerXp ?? 0n) > 10000000n) {
    console.warn(`Player XP suspiciously large: ${playerXp}. Possible storage corruption.`);
  }

  // Sanity-check Shields: if it's suspiciously large, log warning
  if ((shieldCount ?? 0n) > 1000n) {
    console.warn(`Shield count suspiciously large: ${shieldCount}. Possible storage corruption.`);
  }

  return {
    shieldPrice: normalizedShieldPrice,
    boost2xPrice: normalizedBoost2xPrice,
    boost5xPrice: normalizedBoost5xPrice,
    shieldCount: shieldCount ?? 0n,
    xpBoost, boostActive,
    playerXp: playerXp ?? 0n,
    streakCount: normalizedStreakCount,
    gdBalance: gdBalance ?? 0n,
    gdAllowance: gdAllowance ?? 0n,
    pendingAction, isTxPending, error,
    approve, buyShield, buyBoost,
    isApproved, canAfford,
  };
}
