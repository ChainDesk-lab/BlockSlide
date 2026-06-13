import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError, ContractFunctionRevertedError, keccak256 } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { GAME2048_ABI } from "../lib/abi";
import { GAME2048_ADDRESS, TARGET_CHAIN } from "../lib/constants";
import { GameState } from "../lib/gameLogic";

export type SessionPhase =
  | "idle"        // no wallet / no active session
  | "starting"    // waiting for startSession tx
  | "active"      // session live, playing
  | "submitting"  // waiting for submitScore tx
  | "done";       // score submitted

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function useGameSession() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();

  const { writeContract, data: txHash, isPending, reset: resetWrite } =
    useWriteContract();
  const { isSuccess: txConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  const [phase, setPhase] = useState<SessionPhase>("idle");
  const pendingActionRef = useRef<"start" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isWrongChain = !!address && chainId !== TARGET_CHAIN.id;

  // Read on-chain session (disabled if contract not deployed)
  const contractDeployed = GAME2048_ADDRESS !== ZERO_ADDRESS;
  const { data: onChainSession, refetch: refetchSession } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "getSession",
    args: address ? [address] : undefined,
    query: { enabled: !!address && contractDeployed && !isWrongChain },
  });

  // Sync phase with on-chain state when address or session changes.
  // Using a ref for phase avoids stale-closure lint issues while keeping
  // the effect tight — we only re-run when the session active flag flips.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!address) {
      setPhase("idle");
      return;
    }
    if (onChainSession?.active) {
      // Only override "idle/done" — don't stomp "starting"/"submitting"
      if (phaseRef.current === "idle" || phaseRef.current === "done") {
        setPhase("active");
      }
    } else if (phaseRef.current === "active") {
      // Session expired or was submitted externally
      setPhase("idle");
    }
  }, [address, onChainSession?.active]);

  // Handle tx confirmation
  useEffect(() => {
    if (!txConfirmed || !pendingActionRef.current) return;
    if (pendingActionRef.current === "start") setPhase("active");
    else if (pendingActionRef.current === "submit") setPhase("done");
    pendingActionRef.current = null;
    refetchSession();
  }, [txConfirmed, refetchSession]);

  const startSession = useCallback(
    (seed: `0x${string}`) => {
      // No wallet or contract not deployed → offline/demo mode.
      // The game runs fully locally; blockchain features activate on submit.
      if (!address || !contractDeployed) {
        setError(null);
        setPhase("active");
        return;
      }

      if (isWrongChain) {
        // Wrong chain but wallet connected — still let the game start locally
        setPhase("active");
        return;
      }

      setError(null);
      pendingActionRef.current = "start";
      setPhase("starting");

      const seedHash = keccak256(seed);
      writeContract(
        {
          address: GAME2048_ADDRESS,
          abi: GAME2048_ABI,
          functionName: "startSession",
          args: [seedHash],
        },
        {
          onError: (e) => {
            setError(parseContractError(e));
            setPhase("idle");
            pendingActionRef.current = null;
          },
        },
      );
    },
    [address, contractDeployed, isWrongChain, writeContract],
  );

  const submitScore = useCallback(
    (gameState: GameState, seed: `0x${string}`) => {
      if (!address) return;
      if (!contractDeployed) {
        setError("Deploy the contract and update GAME2048_ADDRESS to submit scores onchain.");
        return;
      }
      setError(null);
      pendingActionRef.current = "submit";
      setPhase("submitting");
      writeContract(
        {
          address: GAME2048_ADDRESS,
          abi: GAME2048_ABI,
          functionName: "submitScore",
          args: [
            BigInt(gameState.score),
            gameState.highestTile,
            BigInt(gameState.moveCount),
            seed,
            BigInt(gameState.maxCombo ?? 0),
          ],
        },
        {
          onError: (e) => {
            setError(parseContractError(e));
            setPhase("active");
            pendingActionRef.current = null;
          },
        },
      );
    },
    [address, writeContract],
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
    switchToTargetChain,
  };
}

function parseContractError(error: Error): string {
  // Walk viem's BaseError chain to find a ContractFunctionRevertedError
  if (error instanceof BaseError) {
    const revert = error.walk(
      (e): e is ContractFunctionRevertedError =>
        e instanceof ContractFunctionRevertedError,
    );
    if (revert) {
      const errorName = (revert as { data?: { errorName?: string } }).data?.errorName;
      switch (errorName) {
        case "NotVerifiedHuman":
          return "You need a verified GoodDollar account to play. Visit gooddollar.org to get verified.";
        case "SessionAlreadyActive":
          return "You already have an active session on-chain. It auto-expires after 2 hours — try again then, or submit your previous game.";
        case "NoActiveSession":
          return "No active session found. Start a new game first.";
        case "SessionExpired":
          return "Your session expired — start a new game.";
        case "InvalidSeed":
          return "Seed mismatch. Don't clear your browser storage mid-game.";
        case "InvalidMoveCount":
          return "Invalid move count submitted.";
        case "InvalidTileValue":
          return "Invalid tile value submitted.";
      }
    }

    // User rejected the transaction in their wallet
    if (error.walk((e) => (e as { name?: string }).name === "UserRejectedRequestError")) {
      return "Transaction rejected.";
    }
  }

  // Fallback: check the full message string (covers older wagmi formats)
  const msg = error.message ?? "";
  if (msg.includes("NotVerifiedHuman"))    return "You need a verified GoodDollar account.";
  if (msg.includes("SessionAlreadyActive")) return "Active session on-chain. Auto-expires in 2 hours.";
  if (msg.includes("rejected") || msg.includes("denied") || msg.includes("cancelled"))
    return "Transaction rejected.";
  if (msg.includes("chain") || msg.includes("network"))
    return "Network error — make sure your wallet is on Celo Alfajores.";
  if (msg.includes("bytecode") || msg.includes("code") || msg.includes("empty"))
    return "Contract not found. Update GAME2048_ADDRESS in src/lib/constants.ts.";

  return `Transaction failed: ${msg.slice(0, 100)}`;
}
