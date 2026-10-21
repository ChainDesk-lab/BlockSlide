import { useState, useEffect } from "react";
import { maxUint256 } from "viem";
import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ERC20_ABI, GAME2048_ABI } from "../lib/abi";
import { GAME2048_MERGED_ABI } from "../lib/abiMerged";
import { GAME2048_ADDRESS, G_DOLLAR_ADDRESS, CONTRACT_DEPLOYED } from "../lib/constants";
import { useContractAddress, useContractPublicClient } from "./useContractData";
import { isInsufficientGasError } from "../lib/gasError";
import { classifyTxError } from "../lib/txErrors";
import { useNoGas } from "../contexts/NoGasContext";
import { COSMETICS_CATALOG } from "../lib/avatarSystem";
import { cosmeticPriceFromRead, toPriceRead, type CosmeticPrice } from "../lib/shopPrice";

export type ShopAction = "approve" | "shield" | "boost2" | "boost5" | "undo" | "cosmetic" | null;

export function useShop() {
  const address = useContractAddress();
  const publicClient = useContractPublicClient();
  // Player-specific reads need an address; prices don't. Prices are read even
  // with no wallet connected, so visitors see real on-chain prices.
  const enabled = !!address && CONTRACT_DEPLOYED;
  const pricesEnabled = CONTRACT_DEPLOYED;
  const { triggerNoGas } = useNoGas();

  const { writeContractAsync } = useWriteContract();
  const [pendingAction, setPendingAction] = useState<ShopAction>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);

  const { isLoading: isTxPending } = useWaitForTransactionReceipt({ hash: txHash });

  // ── Shop prices (V5 + V6), read-only, wallet not required ─────────────────
  const shieldPriceRead = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "shieldPrice", query: { enabled: pricesEnabled }
  });
  const boost2xPriceRead = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "boost2xPrice", query: { enabled: pricesEnabled }
  });
  const boost5xPriceRead = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_ABI, functionName: "boost5xPrice", query: { enabled: pricesEnabled }
  });
  const undoPriceRead = useReadContract({
    address: GAME2048_ADDRESS, abi: GAME2048_MERGED_ABI,
    functionName: "undoPrice", query: { enabled: pricesEnabled },
  });
  const { data: shieldPrice, error: shieldPriceError } = shieldPriceRead;
  const { data: boost2xPrice, error: boost2xPriceError } = boost2xPriceRead;
  const { data: boost5xPrice, error: boost5xPriceError } = boost5xPriceRead;
  const { data: undoPrice, error: undoPriceError, refetch: refetchUndoPrice } = undoPriceRead;

  // Cosmetic prices come from the contract's catalog, one read per item.
  const cosmeticReads = useReadContracts({
    contracts: COSMETICS_CATALOG.map((c) => ({
      address: GAME2048_ADDRESS,
      abi: GAME2048_MERGED_ABI,
      functionName: "getCosmeticItem" as const,
      args: [BigInt(c.id)] as const,
    })),
    query: { enabled: pricesEnabled },
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

      // Wait for receipt to confirm transaction is mined and successful
      if (!publicClient) {
        setError("Network unavailable — could not verify transaction");
        return;
      }

      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status === "reverted") {
          setError("Transaction failed — please check your balance and try again.");
          return;
        }
      } catch (receiptErr) {
        if (classifyTxError(receiptErr) === "receipt_timeout") {
          // Not mined yet isn't a failure — the purchase may still land.
          // Refresh once it has had more time, and say so plainly.
          setError(`Still confirming (tx ${hash.slice(0, 10)}…). Your balance will update when it lands — please don't buy again yet.`);
          setTimeout(() => {
            refetchAll();
            window.dispatchEvent(new Event("gdBalanceChanged"));
          }, 60_000);
        } else {
          setError(`Transaction confirmation failed: ${(receiptErr as Error).message}`);
        }
        return;
      }

      // Transaction succeeded — refetch all state and notify other components
      refetchAll();
      window.dispatchEvent(new Event("gdBalanceChanged"));
    } catch (e: any) {
      if (isInsufficientGasError(e)) {
        triggerNoGas();
        setError("You need a little CELO for gas — see the pop-up.");
      } else {
        const msg: string = e?.shortMessage ?? e?.message ?? "Transaction failed";
        if (!msg.toLowerCase().includes("rejected") && !msg.toLowerCase().includes("denied")) {
          setError(msg.slice(0, 120));
        }
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

  // No consumeUndo action: Undo is disabled (UNDO_ENABLED). The deployed
  // consumeUndo(address) has no caller check, so the app must not call it.

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
  // Detect and normalize corrupted values (player stats only — never prices).

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

  // Prices: only what the chain returned. No hard-coded fallbacks — a missing
  // price is "loading" or "unavailable", never a guessed number or zero.
  const prices = {
    shield: toPriceRead(shieldPriceRead),
    boost2x: toPriceRead(boost2xPriceRead),
    boost5x: toPriceRead(boost5xPriceRead),
    undo: toPriceRead(undoPriceRead),
  };
  const cosmeticPrices: Record<number, CosmeticPrice> = {};
  COSMETICS_CATALOG.forEach((c, i) => {
    cosmeticPrices[c.id] = cosmeticPriceFromRead(cosmeticReads.data?.[i], cosmeticReads.status);
  });

  // Sanity-check XP: if it's suspiciously large (like a timestamp), log warning
  if ((playerXp ?? 0n) > 10000000n) {
    console.warn(`Player XP suspiciously large: ${playerXp}. Possible storage corruption.`);
  }

  // Sanity-check Shields: if it's suspiciously large, log warning
  if ((shieldCount ?? 0n) > 1000n) {
    console.warn(`Shield count suspiciously large: ${shieldCount}. Possible storage corruption.`);
  }

  return {
    // Prices: undefined until the chain returns them (see `prices` for status)
    shieldPrice,
    boost2xPrice,
    boost5xPrice,
    prices,
    cosmeticPrices,
    shieldCount: shieldCount ?? 0n,
    xpBoost, boostActive,
    playerXp: playerXp ?? 0n,
    streakCount: normalizedStreakCount,
    gdBalance: gdBalance ?? 0n,
    gdAllowance: gdAllowance ?? 0n,

    // V6 prices & state
    undoPrice,
    undoCredits: undoCreditsRaw ?? 0n,

    // Actions
    pendingAction, isTxPending, error,
    approve, buyShield, buyBoost,
    buyUndoMove, buyCosmetic,
    isApproved, canAfford,
  };
}
