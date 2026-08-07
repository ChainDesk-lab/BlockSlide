import { useState, useEffect } from "react";
import { maxUint256 } from "viem";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ERC20_ABI, GAME2048_ABI } from "../lib/abi";
import { GAME2048_MERGED_ABI } from "../lib/abiMerged";
import { GAME2048_ADDRESS, G_DOLLAR_ADDRESS, CONTRACT_DEPLOYED } from "../lib/constants";
import { useContractAddress } from "./useContractData";

export type ShopAction = "approve" | "shield" | "boost2" | "boost5" | "undo" | "cosmetic" | null;

export function useShop() {
  const address = useContractAddress();
  const enabled = !!address && CONTRACT_DEPLOYED;

  const { writeContractAsync } = useWriteContract();
  const [pendingAction, setPendingAction] = useState<ShopAction>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);

  const { isLoading: isTxPending } = useWaitForTransactionReceipt({ hash: txHash });

  // ── Shop prices (V5 + V6) ──────────────────────────────────────────────────
  const { data: shieldPrice, error: shieldPriceError } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "shieldPrice", query: { enabled }
  });
  const { data: boost2xPrice, error: boost2xPriceError } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "boost2xPrice", query: { enabled }
  });
  const { data: boost5xPrice, error: boost5xPriceError } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "boost5xPrice", query: { enabled }
  });
  // V6 functions may not exist on deployed contract - handle gracefully
  const { data: undoPrice, error: undoPriceError, refetch: refetchUndoPrice } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_MERGED_ABI,
    functionName: "undoPrice", query: { enabled },
  });
  const { data: undoCreditsRaw, error: undoCreditsError, refetch: refetchUndoCredits } = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_MERGED_ABI, functionName: "undoCredits",
    args: address ? [address] : undefined, query: { enabled },
  });

  // Log price read errors for debugging
  useEffect(() => {
    if (shieldPriceError) console.warn("[Shop] shieldPrice read error:", shieldPriceError);
    if (boost2xPriceError) console.warn("[Shop] boost2xPrice read error:", boost2xPriceError);
    if (boost5xPriceError) console.warn("[Shop] boost5xPrice read error:", boost5xPriceError);
    if (undoPriceError) console.warn("[Shop] undoPrice read error:", undoPriceError);
    if (undoCreditsError) console.warn("[Shop] undoCredits read error:", undoCreditsError);
  }, [shieldPriceError, boost2xPriceError, boost5xPriceError, undoPriceError, undoCreditsError]);

  // Log price values for debugging
  useEffect(() => {
    console.log("[Shop] Raw prices from contract:", {
      shieldPrice: shieldPrice?.toString() ?? "undefined",
      boost2xPrice: boost2xPrice?.toString() ?? "undefined",
      boost5xPrice: boost5xPrice?.toString() ?? "undefined",
      undoPrice: undoPrice?.toString() ?? "undefined",
    });
  }, [shieldPrice, boost2xPrice, boost5xPrice, undoPrice]);

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
    refetchUndoPrice();
    refetchUndoCredits();
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
        abi: GAME2048_MERGED_ABI,
        functionName: "buyXpBoost",
        args: [multiplier],
      })
    );

  const buyUndoMove = (quantity: number) =>
    run("undo", () =>
      writeContractAsync({
        address: GAME2048_ADDRESS,
        abi: GAME2048_MERGED_ABI,
        functionName: "buyUndoMove",
        args: [BigInt(quantity)],
      })
    );

  const consumeUndo = () =>
    run("undo", () =>
      writeContractAsync({
        address: GAME2048_ADDRESS,
        abi: GAME2048_MERGED_ABI,
        functionName: "consumeUndo",
        args: [],
      })
    );

  const buyCosmetic = (itemId: number) =>
    run("cosmetic", () =>
      writeContractAsync({
        address: GAME2048_ADDRESS,
        abi: GAME2048_MERGED_ABI,
        functionName: "buyCosmetic",
        args: [BigInt(itemId)],
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

  // Normalize prices: use contract values, fallback to configured prices if undefined
  // If prices are 0 on-chain (unconfigured), leave them as 0 to trigger guards
  const SHIELD_PRICE_DEFAULT = 500n * 10n ** 18n; // 500 G$ (current mainnet)
  const BOOST_2X_PRICE_DEFAULT = 1500n * 10n ** 18n; // 1,500 G$ (current mainnet)
  const BOOST_5X_PRICE_DEFAULT = 4000n * 10n ** 18n; // 4,000 G$ (current mainnet)

  // Use contract prices if they exist (even if 0), otherwise fall back to defaults
  // This allows the zero-price guard to block purchases when prices aren't set
  const normalizedShieldPrice = shieldPrice !== undefined ? shieldPrice : SHIELD_PRICE_DEFAULT;
  const normalizedBoost2xPrice = boost2xPrice !== undefined ? boost2xPrice : BOOST_2X_PRICE_DEFAULT;
  const normalizedBoost5xPrice = boost5xPrice !== undefined ? boost5xPrice : BOOST_5X_PRICE_DEFAULT;

  // Sanity-check XP: if it's suspiciously large (like a timestamp), log warning
  if ((playerXp ?? 0n) > 10000000n) {
    console.warn(`Player XP suspiciously large: ${playerXp}. Possible storage corruption.`);
  }

  // Sanity-check Shields: if it's suspiciously large, log warning
  if ((shieldCount ?? 0n) > 1000n) {
    console.warn(`Shield count suspiciously large: ${shieldCount}. Possible storage corruption.`);
  }

  return {
    // V5 prices & state
    shieldPrice: normalizedShieldPrice,
    boost2xPrice: normalizedBoost2xPrice,
    boost5xPrice: normalizedBoost5xPrice,
    shieldCount: shieldCount ?? 0n,
    xpBoost, boostActive,
    playerXp: playerXp ?? 0n,
    streakCount: normalizedStreakCount,
    gdBalance: gdBalance ?? 0n,
    gdAllowance: gdAllowance ?? 0n,

    // V6 prices & state
    undoPrice: undoPrice ?? 0n,
    undoCredits: undoCreditsRaw ?? 0n,

    // Actions
    pendingAction, isTxPending, error,
    approve, buyShield, buyBoost,
    buyUndoMove, consumeUndo, buyCosmetic,
    isApproved, canAfford,
  };
}
