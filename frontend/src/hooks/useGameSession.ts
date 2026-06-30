import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, keccak256, toHex } from "viem";
import { signTransaction } from "viem/actions";
import {
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from "wagmi";
import { GAME2048_ABI } from "../lib/abi";
import { GAME2048_ADDRESS, TARGET_CHAIN } from "../lib/constants";
import { GameState, generateSeed } from "../lib/gameLogic";
import { isInsufficientGasError } from "../lib/gasError";
import { useNoGas } from "../contexts/NoGasContext";
import { useContractAddress, useContractWalletClient } from "./useContractData";

const LOW_GAS_THRESHOLD = 5_000_000_000_000_000n; // 0.005 CELO

export type SessionPhase =
  | "idle"        // no wallet / no active session
  | "starting"    // waiting for startSession tx
  | "active"      // session live, playing
  | "submitting"  // waiting for submitScore tx
  | "done";       // score submitted

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function useGameSession() {
  const address = useContractAddress();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();
  const { triggerNoGas } = useNoGas();

  // Public client uses our transport (ankr first) — for nonce reads and broadcast.
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN.id });
  // Wallet client — used for signTransaction (pure signing, no RPC calls made
  // by the wallet, so the wallet's forno config can't block us).
  const walletClient = useContractWalletClient();

  // Manual tx state — replaces useSendTransaction so we can use signTransaction
  // + sendRawTransaction and keep the same interface for the rest of the hook.
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const resetWrite = useCallback(() => {
    setTxHash(undefined);
    setIsPending(false);
  }, []);

  const { isSuccess: txConfirmed, isError: txWaitError, error: txWaitErrorObj, data: txReceipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  const [phase, setPhase] = useState<SessionPhase>("idle");
  const pendingActionRef = useRef<"start" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isWrongChain = !!address && chainId !== TARGET_CHAIN.id;

  const { data: celoBalance } = useBalance({
    address,
    query: { enabled: !!address },
  });

  const contractDeployed = GAME2048_ADDRESS !== ZERO_ADDRESS;

  const { data: onChainSession, refetch: refetchSession } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "getSession",
    args: address ? [address] : undefined,
    query: { enabled: !!address && contractDeployed && !isWrongChain },
  });

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!address) {
      setPhase("idle");
      return;
    }
    if (onChainSession?.active) {
      if (phaseRef.current === "idle" || phaseRef.current === "done") {
        setPhase("active");
      }
    } else if (phaseRef.current === "active") {
      setPhase("idle");
    }
  }, [address, onChainSession?.active]);

  useEffect(() => {
    if (!pendingActionRef.current) return;
    // Handle both outcomes from useWaitForTransactionReceipt:
    //  - resolved receipt (txConfirmed) — may be success OR reverted status
    //  - wait error (txWaitError) — node returned an error fetching the receipt
    if (!txConfirmed && !txWaitError) return;

    const reverted = txReceipt?.status === "reverted" || txWaitError;
    if (reverted) {
      if (pendingActionRef.current === "submit") {
        setError(
          txWaitErrorObj
            ? parseContractError(txWaitErrorObj as Error)
            : "Score submission reverted on-chain. Your session is still open — try submitting again.",
        );
        setPhase("active");
      } else {
        setError("Session start reverted on-chain. Make sure you are GoodDollar verified and have enough CELO for gas.");
        setPhase("idle");
      }
      pendingActionRef.current = null;
      setIsPending(false);
      refetchSession();
      return;
    }

    if (pendingActionRef.current === "start") setPhase("active");
    else if (pendingActionRef.current === "submit") setPhase("done");
    pendingActionRef.current = null;
    setIsPending(false);
    refetchSession();
  }, [txConfirmed, txWaitError, txWaitErrorObj, txReceipt, txHash, refetchSession]);

  // ── Core transaction helper ───────────────────────────────────────────────
  const signAndBroadcast = useCallback(async (
    data: `0x${string}`,
    gas: bigint,
  ): Promise<`0x${string}`> => {
    if (!walletClient || !address) throw new Error("Wallet not connected");
    if (!publicClient) throw new Error("Network unavailable");

    setIsPending(true);
    try {
      // Fetch nonce via our public client (ankr) — never through wallet's RPC.
      let nonce: number | undefined;
      try {
        nonce = await publicClient.getTransactionCount({ address, blockTag: "pending" });
      } catch { /* proceed without explicit nonce */ }

      const txBase = {
        account: address,
        to: GAME2048_ADDRESS,
        data,
        gas,
        maxFeePerGas:         500_000_000_000n,
        maxPriorityFeePerGas:   2_500_000_000n,
        ...(nonce !== undefined ? { nonce } : {}),
        chainId: TARGET_CHAIN.id,
      } as const;

      let hash: `0x${string}`;

      try {
        // Primary path: eth_signTransaction (pure crypto, wallet makes zero RPC
        // calls) then we broadcast via ankr — forno never involved.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const signedTx = await (signTransaction as any)(walletClient, { ...txBase, type: "eip1559" });
        hash = await publicClient.sendRawTransaction({ serializedTransaction: signedTx });
      } catch (signErr: unknown) {
        const msg = ((signErr as Error)?.message ?? "").toLowerCase();
        const code = (signErr as { code?: number })?.code;
        const name = (signErr as { name?: string })?.name ?? "";
        // Not every provider exposes eth_signTransaction. Some reject it as
        // unauthorized (4100), others report method-not-found (-32601), or "not
        // supported". In all cases, fall back to eth_sendTransaction.
        const isUnsupported =
          name === "MethodNotSupportedRpcError" ||
          name === "UnauthorizedProviderError" ||
          code === 4100 ||
          code === -32601 ||
          msg.includes("not supported") ||
          msg.includes("authoriz") ||
          msg.includes("eth_signtransaction");

        if (!isUnsupported) throw signErr;

        // Fallback: wallet doesn't support eth_signTransaction (e.g. Coinbase Wallet).
        // Use eth_sendTransaction directly — wallet handles signing + broadcast via
        // its own RPC (which is not forno, so the signing prompt appears normally).
        hash = await (walletClient as any).request({
          method: "eth_sendTransaction",
          params: [{
            from:                 address,
            to:                   GAME2048_ADDRESS,
            data,
            gas:                  toHex(gas),
            maxFeePerGas:         toHex(500_000_000_000n),
            maxPriorityFeePerGas: toHex(2_500_000_000n),
            chainId:              toHex(TARGET_CHAIN.id),
            type:                 "0x2",
            ...(nonce !== undefined ? { nonce: toHex(nonce) } : {}),
          }],
        }) as `0x${string}`;
      }

      setTxHash(hash);
      setIsPending(false);
      return hash;
    } catch (e) {
      setIsPending(false);
      throw e;
    }
  }, [walletClient, publicClient, address]);

  // ── startSession ─────────────────────────────────────────────────────────
  // onSeedReady is called with the committed seed only after all pre-flight
  // checks pass, so the local game state is always initialised with the seed
  // that actually went on-chain — prevents seed mismatch on submit.
  const startSession = useCallback(
    async (onSeedReady: (seed: `0x${string}`) => void) => {
      if (!address || !contractDeployed) {
        setError(null);
        setPhase("active");
        onSeedReady(generateSeed());
        return;
      }

      if (isWrongChain) {
        setPhase("active");
        onSeedReady(generateSeed());
        return;
      }

      if (celoBalance && celoBalance.value < LOW_GAS_THRESHOLD) {
        triggerNoGas();
        setError("Your CELO balance is too low to pay for gas. Top up your wallet and try again.");
        return;
      }

      const SESSION_TIMEOUT_SECS = 2n * 3600n;
      if (
        onChainSession?.active &&
        BigInt(Math.floor(Date.now() / 1000)) <=
          onChainSession.startTime + SESSION_TIMEOUT_SECS
      ) {
        setError("You already have an active session. Wait for it to expire or submit your previous game.");
        return;
      }

      if (!walletClient) {
        setError("Wallet is still connecting — please wait a moment and try again.");
        return;
      }

      const seed = generateSeed();
      setError(null);
      pendingActionRef.current = "start";
      setPhase("starting");
      onSeedReady(seed);

      try {
        await signAndBroadcast(
          encodeFunctionData({ abi: GAME2048_ABI, functionName: "startSession", args: [keccak256(seed)] }),
          200_000n,
        );
      } catch (e) {
        if (isInsufficientGasError(e)) triggerNoGas();
        setError(parseContractError(e as Error));
        setPhase("idle");
        pendingActionRef.current = null;
      }
    },
    [address, contractDeployed, isWrongChain, celoBalance, onChainSession, walletClient, signAndBroadcast, triggerNoGas],
  );

  // ── submitScore ───────────────────────────────────────────────────────────
  const submitScore = useCallback(
    async (gameState: GameState, seed: `0x${string}`) => {
      if (!address) return;
      if (!contractDeployed) {
        setError("Deploy the contract and update GAME2048_ADDRESS to submit scores on-chain.");
        return;
      }
      if (celoBalance && celoBalance.value < LOW_GAS_THRESHOLD) {
        triggerNoGas();
        setError("Your CELO balance is too low to pay for gas. Top up your wallet and try again.");
        return;
      }
      if (!walletClient) {
        setError("Wallet is still connecting — please wait a moment and try again.");
        return;
      }

      let session = onChainSession;
      try {
        const result = await refetchSession();
        if (result.data) session = result.data;
      } catch { /* use cached value */ }

      if (!session?.active) {
        setError("No active session found — start a new game first.");
        return;
      }

      const nowSecs = BigInt(Math.floor(Date.now() / 1000));
      if (nowSecs > session.startTime + 2n * 3600n) {
        setError("Your session expired — start a new game.");
        return;
      }

      if (keccak256(seed) !== session.seedHash) {
        setError("Seed mismatch — the game seed changed since your session started. Start a new game.");
        return;
      }

      // Build the exact args we'll submit, clamped to the contract's accepted
      // ranges so a stray value can't trigger an on-chain revert:
      //   moveCount 1–10 000 · highestTile a power of 2 in 2–131 072
      //   comboMoves ≤ moveCount
      const moveCount = Math.min(Math.max(Math.round(gameState.moveCount) || 1, 1), 10_000);
      const highestTile = gameState.highestTile;
      const comboMoves = Math.min(Math.max(Math.round(gameState.maxCombo ?? 0) || 0, 0), moveCount);
      const args = [
        BigInt(Math.max(Math.round(gameState.score) || 0, 0)),
        highestTile,
        BigInt(moveCount),
        seed,
        BigInt(comboMoves),
      ] as const;

      // Simulate against ankr first — this decodes the exact custom error
      // (InvalidTileValue, NoActiveSession, …) so the user sees a real reason
      // instead of a silently-reverting tx that hangs on "Submitting…".
      // Only block on a genuine contract revert; a flaky-RPC/network error
      // shouldn't stop a valid submission, so in that case we fall through.
      try {
        await publicClient!.simulateContract({
          account: address,
          address: GAME2048_ADDRESS,
          abi: GAME2048_ABI,
          functionName: "submitScore",
          args,
        });
      } catch (simErr) {
        const isContractRevert =
          simErr instanceof BaseError &&
          !!simErr.walk((e) => e instanceof ContractFunctionRevertedError);
        if (isContractRevert) {
          setError(parseContractError(simErr as Error));
          return; // don't send a doomed transaction
        }
        // Network/RPC error during simulation — proceed and let the tx decide.
      }

      setError(null);
      pendingActionRef.current = "submit";
      setPhase("submitting");

      try {
        await signAndBroadcast(
          encodeFunctionData({ abi: GAME2048_ABI, functionName: "submitScore", args }),
          500_000n,
        );
      } catch (e) {
        if (isInsufficientGasError(e)) triggerNoGas();
        setError(parseContractError(e as Error));
        setPhase("active");
        pendingActionRef.current = null;
      }
    },
    [address, contractDeployed, celoBalance, walletClient, publicClient, onChainSession, refetchSession, signAndBroadcast, triggerNoGas],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    pendingActionRef.current = null;
    setError(null);
    resetWrite();
  }, [resetWrite]);

  const switchToTargetChain = useCallback(() => {
    switchChain({ chainId: TARGET_CHAIN.id });
  }, [switchChain]);

  const SESSION_TIMEOUT_SECS = 2 * 60 * 60;
  const sessionExpiresAt = onChainSession?.active
    ? Number(onChainSession.startTime) + SESSION_TIMEOUT_SECS
    : null;
  const sessionExpired =
    sessionExpiresAt !== null && Date.now() / 1000 > sessionExpiresAt;

  return {
    phase,
    isPending,
    isSwitchPending,
    isWrongChain,
    txHash,
    error,
    startSession,
    submitScore,
    reset,
    onChainSession,
    sessionExpiresAt,
    sessionExpired,
    switchToTargetChain,
  };
}

function parseContractError(error: Error): string {
  if (error instanceof BaseError) {
    const revert = error.walk(
      (e): e is ContractFunctionRevertedError =>
        e instanceof ContractFunctionRevertedError,
    );
    if (revert) {
      const r = revert as {
        data?: { errorName?: string; args?: unknown[] };
        reason?: string;
        raw?: string;
        signature?: string;
      };
      const errorName = r.data?.errorName;
      switch (errorName) {
        case "NotVerifiedHuman":      return "You need a verified GoodDollar account to play. Visit gooddollar.org to get verified.";
        case "SessionAlreadyActive":  return "You already have an active session on-chain. It auto-expires after 2 hours.";
        case "NoActiveSession":       return "No active session found. Start a new game first.";
        case "SessionExpired":        return "Your session expired — start a new game.";
        case "InvalidSeed":           return "Seed mismatch. Don't clear your browser storage mid-game.";
        case "InvalidMoveCount":      return "Invalid move count submitted.";
        case "InvalidComboCount":     return "Invalid combo count submitted.";
        case "InvalidTileValue":      return "Invalid tile value submitted.";
      }
      // Decoded a custom error we don't have a friendly message for — surface
      // its name so we know exactly what reverted.
      if (errorName) return `Contract reverted: ${errorName}`;
      // Error(string) revert (require with a message)
      if (r.reason) return `Contract reverted: ${r.reason}`;
      // Couldn't decode the revert data — surface a clean, generic message.
      return "Transaction reverted. Please try again.";
    }
    if (error.walk((e) => (e as { name?: string }).name === "UserRejectedRequestError"))
      return "Transaction rejected.";
  }

  const msg = error.message ?? "";
  if (msg.includes("NotVerifiedHuman"))     return "You need a verified GoodDollar account.";
  if (msg.includes("SessionAlreadyActive")) return "Active session on-chain. Auto-expires in 2 hours.";
  if (msg.includes("rejected") || msg.includes("denied") || msg.includes("cancelled"))
    return "Transaction rejected.";
  if (msg.includes("signTransaction") || msg.includes("eth_signTransaction") || msg.includes("not supported"))
    return "Your wallet doesn't support transaction signing. Try MetaMask on Celo Mainnet.";
  if (msg.includes("resource not available") || msg.includes("too many errors"))
    return "Celo RPC unavailable. Check your wallet's Celo RPC is set to https://rpc.ankr.com/celo";
  if (msg.includes("chain") || msg.includes("network"))
    return "Network error — make sure your wallet is on Celo mainnet.";

  return `Transaction failed: ${msg.slice(0, 120)}`;
}
