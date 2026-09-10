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
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../auth/AuthContext";
import { useContractAddress } from "./useContractData";
import { getUserStorage, setUserStorage, removeUserStorage } from "../lib/unifiedStorage";
import { storeSeedInIndexedDB, recoverSeedFromIndexedDB, clearSeedFromIndexedDB } from "../lib/seedStorage";
import { useSigner } from "./useSigner";
import { useGasFaucet } from "./useGasFaucet";

const LOW_GAS_THRESHOLD = 1_000_000_000_000_000n; // 0.001 CELO (sufficient for Celo gas costs)

// Durable, session-scoped copy of the committed seed. Kept separate from the
// game-state seed (blockslide_game_*) so a board reset, remount, or "play
// locally" can't orphan the on-chain session — submitScore can always recover
// the seed that matches the committed hash from here.
const SESSION_SEED_KEY = "session_seed";

export type SessionPhase =
  | "idle"        // no wallet / no active session
  | "starting"    // waiting for startSession tx
  | "active"      // session live, playing
  | "submitting"  // waiting for submitScore tx (sent but not mined)
  | "finalizing"  // submitScore sent, waiting for receipt (mined)
  | "done";       // score submitted and confirmed on-chain

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function useGameSession() {
  const address = useContractAddress();
  const { isConnected, authType } = useAuth();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();
  const { triggerNoGas } = useNoGas();
  const { showToast } = useToast();

  // Public client uses our transport (ankr first) — for nonce reads and broadcast.
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN.id });
  // Single source of truth for signer — all three features (game, username, identity)
  // call useSigner() so there's exactly one code path, one retry strategy, one error handler.
  const { signer, error: signerError } = useSigner();
  // Gas faucet for topping up CELO when balance is low
  const { topUpGasIfNeeded } = useGasFaucet();

  // Manual tx state — replaces useSendTransaction so we can use signTransaction
  // + sendRawTransaction and keep the same interface for the rest of the hook.
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const resetWrite = useCallback(() => {
    setTxHash(undefined);
    setIsPending(false);
  }, []);

  const { isSuccess: txConfirmed, isError: txWaitError, data: txReceipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  const [phase, setPhase] = useState<SessionPhase>("idle");
  const pendingActionRef = useRef<"start" | "submit" | null>(null);
  // The seed hash of the most recent startSession broadcast — lets the
  // reverted-receipt handler re-simulate and decode the *real* revert reason
  // instead of guessing.
  const lastStartSeedRef = useRef<`0x${string}` | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // True when an active session can't be submitted because its seed is
  // unrecoverable on this device — the only escape is waiting for it to expire.
  const [sessionStuck, setSessionStuck] = useState(false);

  // For Magic users, the embedded wallet is hardcoded to Celo (42220) via Magic's config,
  // so we never need to check/switch chains. For Web3 wallet users, check against the
  // actual wagmi chainId which reflects their connected wallet's network.
  const isWrongChain = authType === "magic" ? false : (!!address && chainId !== TARGET_CHAIN.id);

  // Log auth state for debugging (especially Magic/email submit issues)
  useEffect(() => {
    if (phase === "submitting" || phase === "starting") {
      console.log(`[Game Session] Submitting with authType=${authType}, chainId=${chainId}, isWrongChain=${isWrongChain}`);
    }
  }, [phase, authType, chainId, isWrongChain]);

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
  const submissionInProgressRef = useRef(false);

  useEffect(() => {
    if (!address) {
      setPhase("idle");
      return;
    }
    // Don't reset phase to idle during submission, even if cache shows session inactive.
    // This prevents race conditions where background refetches return stale cache data
    // that shows the session as inactive, resetting phase and hiding the Submit button.
    if (submissionInProgressRef.current) {
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

  // Clear the stuck flag once the on-chain session is no longer active
  // (submitted, expired-and-cleared, or replaced by a new session).
  useEffect(() => {
    if (!onChainSession?.active) setSessionStuck(false);
  }, [onChainSession?.active]);

  // Only watches "start" here — submitScore owns its own completion (including
  // the reverted-receipt check) via its own imperative wait below, so a single
  // path decides the outcome instead of two watchers racing on the same hash.
  useEffect(() => {
    if (pendingActionRef.current !== "start") return;
    if (!txConfirmed && !txWaitError) return;

    const reverted = txReceipt?.status === "reverted" || txWaitError;
    pendingActionRef.current = null;
    setIsPending(false);

    if (reverted) {
      setPhase("idle");
      // Decode the actual revert instead of guessing. startSession on the
      // deployed contract can only revert with SessionAlreadyActive (there is
      // no verification or gas gate on it), so re-simulate to get the precise
      // reason. This branch is now a rare safety net — startSession simulates
      // before broadcasting — but when it fires the message must still be true.
      const seedForDecode = lastStartSeedRef.current;
      if (publicClient && address && seedForDecode) {
        publicClient
          .simulateContract({
            account: address,
            address: GAME2048_ADDRESS,
            abi: GAME2048_ABI,
            functionName: "startSession",
            args: [keccak256(seedForDecode)],
          })
          .then(() => {
            // Simulation passes now — the on-chain revert was transient (e.g. a
            // prior session cleared between broadcast and mining).
            setError("Starting the game didn't go through. Tap New Game to try again.");
          })
          .catch((e) => {
            setError(parseContractError(e as Error));
          });
      } else {
        setError(
          "Starting the game didn't go through on-chain. If you have a game in progress, submit it to finish it; otherwise tap New Game to try again.",
        );
      }
    } else {
      setPhase("active");
    }
    refetchSession();
  }, [txConfirmed, txWaitError, txReceipt, refetchSession, publicClient, address]);

  // ── Core transaction helper ───────────────────────────────────────────────
  // Takes the wallet client as a parameter (rather than closing over the
  // reactive hook value) so callers can resolve it — including the
  // imperative fallback below — right before signing, guaranteeing this
  // function always uses the freshest signer instead of a possibly-stale one.
  const signAndBroadcast = useCallback(async (
    activeSigner: any,
    data: `0x${string}`,
    gas: bigint,
    waitForReceipt: boolean = false,
  ): Promise<`0x${string}`> => {
    if (!activeSigner || !address) throw new Error("Wallet not connected");
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

      // Magic.link (email wallet) holds private keys server-side and doesn't
      // expose eth_signTransaction. Go straight to eth_sendTransaction with a
      // simple legacy-style tx (gasPrice only, no EIP-1559 fields, no explicit
      // nonce) so Magic's provider can apply chain defaults without confusion.
      //
      // Must use authType, not activeSigner.key — viem's createWalletClient()
      // defaults `key` to "wallet" when unset, so the Magic client from
      // useSigner() is never distinguishable by .key.
      const isMagicWallet = authType === "magic";

      if (isMagicWallet) {
        // Fetch live gas price immediately before broadcast — never send a stale hardcoded value.
        // Celo's base fee floats (currently ~200 Gwei); add 20% buffer so we clear it
        // even if it ticks up between the fetch and when the block is mined.
        let gasPrice = 300_000_000_000n; // 300 Gwei safe fallback if live fetch fails
        try {
          const liveGasPrice = await publicClient.getGasPrice();
          gasPrice = liveGasPrice + liveGasPrice / 5n; // live + 20%
        } catch { /* use fallback */ }

        hash = await (activeSigner as any).request({
          method: "eth_sendTransaction",
          params: [{
            from:     address,
            to:       GAME2048_ADDRESS,
            data,
            gas:      toHex(gas),
            gasPrice: toHex(gasPrice),
          }],
        }) as `0x${string}`;
      } else {
        try {
          // Primary path: eth_signTransaction (pure crypto, wallet makes zero RPC
          // calls) then we broadcast via ankr — forno never involved.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const signedTx = await (signTransaction as any)(activeSigner, { ...txBase, type: "eip1559" });
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
          hash = await (activeSigner as any).request({
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
      }

      setTxHash(hash);

      // If waitForReceipt, block until the transaction is mined (confirmed)
      if (waitForReceipt) {
        try {
          await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        } catch (receiptErr) {
          setIsPending(false);
          throw new Error(`Transaction ${hash} failed to confirm: ${(receiptErr as Error).message}`);
        }
      }

      setIsPending(false);
      return hash;
    } catch (e) {
      setIsPending(false);
      throw e;
    }
  }, [publicClient, address, authType]);

  // ── resume an already-active on-chain session ────────────────────────────
  // The contract allows only one live session per player. If one already
  // exists (e.g. a game abandoned on a refresh, or started on another tab),
  // starting a "new" game would revert. Instead, if we can still recover the
  // committed seed for that session, hand it back to the game so the player
  // keeps playing on the session they already own and can submit at the end.
  // Returns true if the session was resumed; false if its seed is unrecoverable.
  const tryResumeActiveSession = useCallback(
    async (
      seedHash: `0x${string}`,
      onSeedReady: (seed: `0x${string}`) => void,
    ): Promise<boolean> => {
      if (!address) return false;

      let candidate: `0x${string}` | null = null;

      try {
        const stored = getUserStorage(address, SESSION_SEED_KEY);
        if (
          stored &&
          stored.startsWith("0x") &&
          keccak256(stored as `0x${string}`) === seedHash
        ) {
          candidate = stored as `0x${string}`;
        }
      } catch { /* ignore — try the next source */ }

      if (!candidate) {
        try {
          const idb = await recoverSeedFromIndexedDB(address);
          if (
            idb &&
            idb.startsWith("0x") &&
            keccak256(idb as `0x${string}`) === seedHash
          ) {
            candidate = idb as `0x${string}`;
          }
        } catch { /* ignore — unrecoverable */ }
      }

      if (!candidate) return false;

      // Re-persist so the durable copy is definitely present for submitScore.
      try { setUserStorage(address, SESSION_SEED_KEY, candidate); } catch { /* ignore */ }
      // Sync the cache to "active" *before* flipping phase, so the phase-sync
      // effect agrees and never bounces us back to "idle".
      try { await refetchSession(); } catch { /* ignore */ }

      setError(null);
      setSessionStuck(false);
      pendingActionRef.current = null;
      setPhase("active");
      onSeedReady(candidate);
      console.log("[Game Session] Resumed an already-active on-chain session");
      return true;
    },
    [address, refetchSession],
  );

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
        setError("Topping up gas...");
        const gasResult = await topUpGasIfNeeded();
        if (!gasResult.ok) {
          // Sponsored gas failed — fall back to the manual top-up modal so
          // the user is never stuck with just an error.
          triggerNoGas();
          setError(gasResult.error || "Your CELO balance is too low to pay for gas. Top up your wallet and try again.");
          return;
        }
        setError(null);
      }

      const SESSION_TIMEOUT_SECS = 2n * 3600n;
      // Pre-flight: read the session straight from chain (never trust only the
      // wagmi cache — it can be empty, stale, or briefly disabled during a
      // chain switch). If a live session already exists, resume it rather than
      // broadcasting a startSession that the contract would revert. A failed
      // read does NOT block here — the pre-broadcast simulation below is the
      // authoritative gate, so RPC flakiness can't stop a valid player.
      if (publicClient) {
        try {
          const freshSession = await publicClient.readContract({
            address: GAME2048_ADDRESS,
            abi: GAME2048_ABI,
            functionName: "getSession",
            args: [address],
          }) as { active: boolean; startTime: bigint; seedHash: `0x${string}` } | null;

          if (
            freshSession?.active &&
            BigInt(Math.floor(Date.now() / 1000)) <=
              freshSession.startTime + SESSION_TIMEOUT_SECS
          ) {
            const resumed = await tryResumeActiveSession(
              freshSession.seedHash as `0x${string}`,
              onSeedReady,
            );
            if (!resumed) {
              // Couldn't recover the seed on this device. Sync the wagmi cache
              // so the "Session active on-chain" recovery panel (countdown +
              // play-locally) takes over instead of leaving a bare error.
              refetchSession();
              setError(
                "You already have a game in progress on-chain. Submit that game to finish it, or wait for it to expire (up to 2 hours), then start a new game.",
              );
            }
            return;
          }
          // Not active, or already past its 2h timeout — the contract clears an
          // expired session on the next startSession, so fall through and start.
        } catch (err) {
          console.warn("[Game Session] Pre-flight session read failed, deferring to simulation:", err);
        }
      }

      if (!isConnected) {
        setError("Wallet is still connecting — please wait a moment and try again.");
        return;
      }

      if (!signer) {
        const msg = signerError || "Wallet signer not available — please try again.";
        // For Magic users, provide specific guidance since they can't switch wallets
        const errorMsg = authType === "magic" && signerError?.includes("network")
          ? "Magic wallet should auto-connect to Celo. Try refreshing the page."
          : msg;
        setError(errorMsg);
        console.log(`[Game Session] No signer available. authType=${authType}, signerError=${signerError}`);
        return;
      }

      const seed = generateSeed();
      setError(null);
      setSessionStuck(false);
      pendingActionRef.current = "start";
      setPhase("starting");
      console.log(`[Game Session] Starting session with authType=${authType}, chainId=${chainId}`);

      // ── Pre-broadcast simulation — the authoritative gate ──────────────────
      // Mirrors submitScore's simulate-first flow. startSession on the deployed
      // contract can only revert with SessionAlreadyActive (no verification and
      // no gas gate live on it), so decode that here and either resume the
      // existing session or show its real reason — BEFORE we sign, wipe the
      // board, or spend gas. Only a genuine contract revert blocks; an
      // RPC/network error falls through so flaky infra can't stop a valid start.
      if (publicClient) {
        try {
          await publicClient.simulateContract({
            account: address,
            address: GAME2048_ADDRESS,
            abi: GAME2048_ABI,
            functionName: "startSession",
            args: [keccak256(seed)],
          });
        } catch (simErr) {
          const isContractRevert =
            simErr instanceof BaseError &&
            !!simErr.walk((e) => e instanceof ContractFunctionRevertedError);
          if (isContractRevert) {
            const revert = (simErr as BaseError).walk(
              (e) => e instanceof ContractFunctionRevertedError,
            ) as ContractFunctionRevertedError | null;
            const errorName = (revert as { data?: { errorName?: string } } | null)?.data?.errorName;

            // Cache was stale — a live session actually exists. Try to resume it
            // so the player keeps playing instead of hitting a dead end.
            if (errorName === "SessionAlreadyActive") {
              try {
                const fresh = await publicClient.readContract({
                  address: GAME2048_ADDRESS,
                  abi: GAME2048_ABI,
                  functionName: "getSession",
                  args: [address],
                }) as { active: boolean; startTime: bigint; seedHash: `0x${string}` } | null;
                if (
                  fresh?.active &&
                  BigInt(Math.floor(Date.now() / 1000)) <= fresh.startTime + 2n * 3600n &&
                  (await tryResumeActiveSession(fresh.seedHash as `0x${string}`, onSeedReady))
                ) {
                  return;
                }
              } catch { /* fall through to the decoded error */ }
            }

            setError(parseContractError(simErr as Error));
            setPhase("idle");
            pendingActionRef.current = null;
            refetchSession();
            return; // never broadcast a doomed startSession
          }
          // Network/RPC error during simulation — proceed and let the tx decide.
          console.warn("[Game Session] startSession simulation inconclusive, proceeding:", simErr);
        }
      }

      lastStartSeedRef.current = seed;
      // Durably persist the committed seed *before* handing it to the game, so a
      // later board reset / remount / "play locally" can't orphan this session.
      try {
        setUserStorage(address, SESSION_SEED_KEY, seed);
        console.log(`[Game Session] Seed stored to localStorage: ${seed.slice(0, 10)}...`);
      } catch (err) {
        console.error("[Game Session] Failed to store seed to localStorage:", err);
      }
      // Also store in IndexedDB as fallback (survives embedded browser clears better than localStorage)
      storeSeedInIndexedDB(address, seed, keccak256(seed))
        .then(() => {
          console.log(`[Game Session] Seed backed up to IndexedDB: ${seed.slice(0, 10)}...`);
        })
        .catch((err) => {
          console.error("[Game Session] Failed to backup seed to IndexedDB:", err);
        });
      console.log(`[Game Session] About to call callback onSeedReady with seed: ${seed.slice(0, 10)}...`);
      onSeedReady(seed);
      console.log(`[Game Session] Callback onSeedReady completed`);

      try {
        await signAndBroadcast(
          signer,
          encodeFunctionData({ abi: GAME2048_ABI, functionName: "startSession", args: [keccak256(seed)] }),
          200_000n,
        );
        console.log(`[Game Session] Transaction successful, refetching session to clear cache`);
        // Refetch to clear wagmi's cached session data so submitScore reads the fresh on-chain seed hash
        refetchSession();

        // CRITICAL FIX (2026-08-26): Store seed on server with confirmation.
        // This is now critical because localStorage/IndexedDB can both fail.
        // We verify the POST succeeded before considering the session "ready".
        const seedHash = keccak256(seed);
        try {
          const serverBackupResponse = await fetch("/api/game/seed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address,
              seedHash,
              seed,
            }),
          });

          if (!serverBackupResponse.ok) {
            console.error("[Game Session] Server seed backup failed with status", {
              status: serverBackupResponse.status,
              statusText: serverBackupResponse.statusText,
            });
            // CRITICAL: This is no longer "non-critical" — without server backup,
            // user only has localStorage/IndexedDB which can both fail.
            // Log prominently so we can track if this is happening.
            showToast(
              "⚠️ Seed backup to server failed. Your session is less protected against browser storage loss.",
              "warning"
            );
          } else {
            const data = await serverBackupResponse.json();
            if (data.success) {
              console.log("[Game Session] ✓ Seed backed up to server (persistent storage)");
            } else {
              console.warn("[Game Session] Server backup reported failure:", data);
            }
          }
        } catch (err) {
          console.error("[Game Session] Server seed backup exception:", err);
          // Network error — still allow session to proceed (localStorage/IndexedDB exist)
          // but log it prominently
          showToast(
            "Network error backing up seed. Your session relies on browser storage only.",
            "warning"
          );
        }
      } catch (e) {
        if (isInsufficientGasError(e)) triggerNoGas();
        const errMsg = parseContractError(e as Error);

        // If the error is "SessionAlreadyActive", refetch the on-chain session
        // and provide clear guidance on what happened.
        if (errMsg.includes("active session") || errMsg.includes("SessionAlreadyActive")) {
          setError(`A game session is still in progress on-chain. This may happen if:\n• A previous game submission is being mined (wait 30-60 seconds)\n• A session expired before we cleared it locally\n\nPlease try again in a moment, or wait up to 2 hours for the session to expire.`);
          refetchSession();
        } else {
          setError(errMsg);
        }

        if (!errMsg.includes("rejected")) showToast(errMsg, "error");
        setPhase("idle");
        pendingActionRef.current = null;
      }
    },
    [address, isConnected, contractDeployed, isWrongChain, celoBalance, onChainSession, signer, signerError, publicClient, refetchSession, tryResumeActiveSession, signAndBroadcast, triggerNoGas, showToast, topUpGasIfNeeded],
  );

  // ── submitScore ───────────────────────────────────────────────────────────
  const submitScore = useCallback(
    async (gameState: GameState, seed: `0x${string}`) => {
      if (!address) return;
      if (!contractDeployed) {
        setError("Deploy the contract and update GAME2048_ADDRESS to submit scores on-chain.");
        return;
      }
      // If gas is low, try to top up using the faucet
      if (celoBalance && celoBalance.value < LOW_GAS_THRESHOLD) {
        setError("Topping up gas...");
        const gasResult = await topUpGasIfNeeded();
        if (!gasResult.ok) {
          // Sponsored gas failed — fall back to the manual top-up modal so
          // the user is never stuck with just an error.
          triggerNoGas();
          setError(gasResult.error || "Your CELO balance is too low to pay for gas. Top up your wallet and try again.");
          return;
        }
        setError(null);
        // Gas was topped up successfully, continue with submission
      }
      if (!isConnected) {
        setError("Wallet is still connecting — please wait a moment and try again.");
        return;
      }

      if (!signer) {
        const msg = signerError || "Wallet signer not available — please try again.";
        const errorMsg = authType === "magic" && signerError?.includes("network")
          ? "Magic wallet should auto-connect to Celo. Try refreshing the page."
          : msg;
        setError(errorMsg);
        console.log(`[Game Session Submit] No signer. authType=${authType}, signerError=${signerError}, chainId=${chainId}`);
        return;
      }

      console.log(`[Game Session Submit] Submitting score with authType=${authType}, chainId=${chainId}, isWrongChain=${isWrongChain}`);

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

      // Prefer the seed the game handed us; if it doesn't match the committed
      // hash (board was reset / remounted / "played locally"), recover the seed
      // durably stored at startSession. Recovery order: localStorage → IndexedDB → server → error
      let submitSeed = seed;
      console.log(`[Seed Recovery] Submitted seed: ${seed.slice(0, 10)}..., hash: ${keccak256(seed).slice(0, 10)}..., expected hash: ${session.seedHash.slice(0, 10)}...`);
      if (keccak256(submitSeed) !== session.seedHash) {
        console.log(`[Seed Recovery] Seed hash mismatch! Starting recovery process...`);
        let recovered: `0x${string}` | null = null;
        const recoveryLog = {
          address: address.slice(0, 6),
          seedHash: session.seedHash.slice(0, 10),
          timestamp: new Date().toISOString(),
          steps: [] as Array<{ step: string; result: string; details?: string }>,
        };

        // Try localStorage first
        try {
          const stored = getUserStorage(address, SESSION_SEED_KEY);
          if (!stored) {
            recoveryLog.steps.push({
              step: "localStorage",
              result: "not-found",
              details: "No seed in localStorage for this address",
            });
            console.log("[Seed Recovery] localStorage: seed not found", {
              address: address.slice(0, 6),
              seedHash: session.seedHash.slice(0, 10),
            });
          } else if (!stored.startsWith("0x")) {
            recoveryLog.steps.push({
              step: "localStorage",
              result: "invalid-format",
              details: "Stored value is not a valid hex string",
            });
            console.warn("[Seed Recovery] localStorage: invalid format", {
              address: address.slice(0, 6),
              stored: stored.slice(0, 20),
            });
          } else if (keccak256(stored as `0x${string}`) !== session.seedHash) {
            recoveryLog.steps.push({
              step: "localStorage",
              result: "hash-mismatch",
              details: "Stored seed hash does not match session hash",
            });
            console.warn("[Seed Recovery] localStorage: hash mismatch", {
              address: address.slice(0, 6),
              storedHash: keccak256(stored as `0x${string}`).slice(0, 10),
              sessionHash: session.seedHash.slice(0, 10),
            });
          } else {
            recovered = stored as `0x${string}`;
            recoveryLog.steps.push({
              step: "localStorage",
              result: "success",
            });
            console.log("[Seed Recovery] ✓ Seed recovered from localStorage", {
              address: address.slice(0, 6),
              seedHash: session.seedHash.slice(0, 10),
            });
          }
        } catch (err) {
          recoveryLog.steps.push({
            step: "localStorage",
            result: "error",
            details: err instanceof Error ? err.message : String(err),
          });
          console.warn("[Seed Recovery] localStorage: exception", {
            address: address.slice(0, 6),
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // If localStorage failed, try IndexedDB (survives embedded-browser clears better)
        if (!recovered) {
          try {
            const indexedDbSeed = await recoverSeedFromIndexedDB(address);
            if (!indexedDbSeed) {
              recoveryLog.steps.push({
                step: "IndexedDB",
                result: "not-found",
                details: "No seed in IndexedDB for this address",
              });
              console.log("[Seed Recovery] IndexedDB: seed not found", {
                address: address.slice(0, 6),
                seedHash: session.seedHash.slice(0, 10),
              });
            } else if (!indexedDbSeed.startsWith("0x")) {
              recoveryLog.steps.push({
                step: "IndexedDB",
                result: "invalid-format",
              });
              console.warn("[Seed Recovery] IndexedDB: invalid format", {
                address: address.slice(0, 6),
              });
            } else if (
              keccak256(indexedDbSeed as `0x${string}`) !== session.seedHash
            ) {
              recoveryLog.steps.push({
                step: "IndexedDB",
                result: "hash-mismatch",
              });
              console.warn("[Seed Recovery] IndexedDB: hash mismatch", {
                address: address.slice(0, 6),
                storedHash: keccak256(indexedDbSeed as `0x${string}`).slice(0, 10),
                sessionHash: session.seedHash.slice(0, 10),
              });
            } else {
              recovered = indexedDbSeed as `0x${string}`;
              recoveryLog.steps.push({
                step: "IndexedDB",
                result: "success",
              });
              console.log(
                "[Seed Recovery] ✓ Seed recovered from IndexedDB (localStorage was lost)",
                {
                  address: address.slice(0, 6),
                  seedHash: session.seedHash.slice(0, 10),
                }
              );
            }
          } catch (err) {
            recoveryLog.steps.push({
              step: "IndexedDB",
              result: "error",
              details: err instanceof Error ? err.message : String(err),
            });
            console.error("[Seed Recovery] IndexedDB: exception", {
              address: address.slice(0, 6),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // If both client-side fallbacks fail, try server-side seed backup (final resort)
        if (!recovered) {
          try {
            console.log("[Seed Recovery] Attempting server-side recovery...", {
              address: address.slice(0, 6),
              seedHash: session.seedHash.slice(0, 10),
            });
            const response = await fetch(
              `/api/game/seed?address=${encodeURIComponent(address)}&seedHash=${encodeURIComponent(session.seedHash)}`
            );
            if (!response.ok) {
              recoveryLog.steps.push({
                step: "server",
                result: `http-${response.status}`,
                details: response.statusText,
              });
              console.log("[Seed Recovery] Server: HTTP error", {
                address: address.slice(0, 6),
                status: response.status,
                statusText: response.statusText,
              });
            } else {
              const data = (await response.json()) as { seed?: string };
              if (!data.seed) {
                recoveryLog.steps.push({
                  step: "server",
                  result: "empty-response",
                  details: "Server returned empty seed",
                });
                console.log("[Seed Recovery] Server: empty response", {
                  address: address.slice(0, 6),
                });
              } else if (!data.seed.startsWith("0x")) {
                recoveryLog.steps.push({
                  step: "server",
                  result: "invalid-format",
                });
                console.warn("[Seed Recovery] Server: invalid format", {
                  address: address.slice(0, 6),
                });
              } else if (keccak256(data.seed as `0x${string}`) !== session.seedHash) {
                recoveryLog.steps.push({
                  step: "server",
                  result: "hash-mismatch",
                });
                console.warn("[Seed Recovery] Server: hash mismatch", {
                  address: address.slice(0, 6),
                  serverHash: keccak256(data.seed as `0x${string}`).slice(0, 10),
                  sessionHash: session.seedHash.slice(0, 10),
                });
              } else {
                recovered = data.seed as `0x${string}`;
                recoveryLog.steps.push({
                  step: "server",
                  result: "success",
                });
                console.log(
                  "[Seed Recovery] ✓ Seed recovered from server (all client storage was lost)",
                  {
                    address: address.slice(0, 6),
                    seedHash: session.seedHash.slice(0, 10),
                  }
                );
              }
            }
          } catch (err) {
            recoveryLog.steps.push({
              step: "server",
              result: "error",
              details: err instanceof Error ? err.message : String(err),
            });
            console.error("[Seed Recovery] Server: exception", {
              address: address.slice(0, 6),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (recovered) {
          submitSeed = recovered;
          // Log summary of successful recovery
          console.log("[Seed Recovery] SUMMARY: Recovery successful", recoveryLog);
        } else {
          // Log summary of failed recovery for support debugging
          console.error("[Seed Recovery] SUMMARY: All recovery methods failed", recoveryLog);
          setError(
            "This game session can't be submitted — its seed was lost on this device (browser storage was cleared, or you started on a different browser/device).",
          );
          setSessionStuck(true);
          return;
        }
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
        submitSeed,
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
      submissionInProgressRef.current = true;

      // Re-check chain right before submission, not just from initialization
      // (chainId can change between hook init and when user clicks Submit)
      if (authType !== "magic" && chainId !== TARGET_CHAIN.id) {
        setPhase("active");
        setError("Wrong network — please switch to Celo mainnet in your wallet.");
        submissionInProgressRef.current = false;
        return;
      }

      let txSucceeded = false;
      try {
        const hash = await signAndBroadcast(
          signer,
          encodeFunctionData({ abi: GAME2048_ABI, functionName: "submitScore", args }),
          500_000n,
          false, // don't wait for receipt yet; show sending state first
        );

        // Transaction sent — now show "Finalizing..." while waiting for receipt
        setPhase("finalizing");

        // Wait for receipt to confirm transaction is mined
        if (!publicClient) throw new Error("Network unavailable");
        let receipt;
        try {
          receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        } catch (receiptErr) {
          throw new Error(`Transaction ${hash} failed to confirm: ${(receiptErr as Error).message}`);
        }
        if (receipt.status === "reverted") {
          throw new Error("Score submission reverted on-chain. Your session is still open — try submitting again.");
        }

        // Transaction succeeded on-chain — mark this so catch block knows not to revert phase
        txSucceeded = true;

        pendingActionRef.current = null;
        setSessionStuck(false);
        // Session is spent — drop the durable committed-seed copy.
        try {
          if (address) removeUserStorage(address, SESSION_SEED_KEY);
        } catch { /* ignore */ }
        // Also clear IndexedDB backup
        if (address) {
          clearSeedFromIndexedDB(address).catch(() => {
            /* ignore cleanup errors */
          });
        }

        // Don't wait for cache to update — we KNOW the session is now inactive
        // because we just ended it on-chain. Setting phase to "done" immediately
        // lets startSession's active-session guard work correctly (it checks
        // onChainSession?.active from cache, but won't block because we're not
        // calling startSession until after phase="done").
        // Refetch in background so other consumers see the fresh state eventually,
        // but don't block on it.
        refetchSession().catch(() => {
          /* ignore refetch errors — async background refresh */
        });

        setPhase("done");
        showToast("Score submitted! 🎉", "success");
        window.dispatchEvent(
          new CustomEvent("scoreSubmitted", { detail: { txHash: hash, timestamp: Date.now() } }),
        );
        submissionInProgressRef.current = false;
      } catch (e) {
        const error = e as Error;
        console.error(`[Game Session Submit] Score submission failed for ${address}:`, {
          message: error.message,
          code: (error as any).code,
          name: error.name,
          isGasError: isInsufficientGasError(error),
          authType,
          chainId,
        });

        if (isInsufficientGasError(error)) triggerNoGas();
        const errMsg = parseContractError(error);

        setError(errMsg);
        // ALWAYS show the error toast (removed the rejection filter so users see all errors)
        showToast(errMsg, "error");
        // Only reset phase to "active" if the transaction actually failed.
        // If txSucceeded=true, a downstream step (seed cleanup, refetch, dispatch)
        // threw, but the transaction is mined and session is spent on-chain.
        // Don't revert the phase back to "active" in that case.
        if (!txSucceeded) {
          setPhase("active");
        }
        pendingActionRef.current = null;
        submissionInProgressRef.current = false;
      }
    },
    [address, isConnected, contractDeployed, celoBalance, signer, signerError, publicClient, onChainSession, refetchSession, signAndBroadcast, triggerNoGas, showToast, topUpGasIfNeeded],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    pendingActionRef.current = null;
    setError(null);
    setSessionStuck(false);
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
    sessionStuck,
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
        case "NotVerifiedHuman":
          return "Your GoodDollar account is not verified, or you're using a linked wallet that can't submit scores. Scores can only be submitted from the primary verified account. Visit gooddollar.org to verify, or switch to your verified wallet if you have one.";
        case "SessionAlreadyActive":  return "You already have a game in progress on-chain. Submit that game to finish it, or wait for it to expire (up to 2 hours), then start a new game.";
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
      return "Score submission failed on-chain. Please try again or contact support.";
    }
    if (error.walk((e) => (e as { name?: string }).name === "UserRejectedRequestError"))
      return "You rejected the transaction in your wallet.";
  }

  const msg = error.message ?? "";
  if (msg.includes("NotVerifiedHuman"))
    return "Your GoodDollar account is not verified. Visit gooddollar.org to verify.";
  if (msg.includes("SessionAlreadyActive")) return "Active session on-chain. Auto-expires in 2 hours.";
  if (msg.includes("rejected") || msg.includes("denied") || msg.includes("cancelled"))
    return "You rejected the transaction.";
  if (msg.includes("signTransaction") || msg.includes("eth_signTransaction") || msg.includes("not supported"))
    return "Your wallet doesn't support transaction signing. Try MetaMask on Celo Mainnet.";
  if (msg.includes("resource not available") || msg.includes("too many errors"))
    return "Celo RPC unavailable. Check your wallet's Celo RPC is set to https://rpc.ankr.com/celo";
  if (msg.includes("fee cap") || msg.includes("base fee"))
    return "Gas price too low for the current network. Please try again in a moment.";
  // Distinguish provider/wallet errors ("invalid chain ID") from genuine network mismatches
  // If the error is from the provider during signing, it's likely already checked client-side
  if (msg.includes("wrong network") || msg.includes("switch network") || msg.includes("switch to"))
    return msg; // Provider gave specific instruction — pass through as-is
  if (msg.includes("chain") || msg.includes("network")) {
    // Generic "chain"/"network" error from provider — likely network problem, not user mismatch
    return "Network error during submission. Check your connection and try again.";
  }
  if (msg.includes("timeout") || msg.includes("Timeout"))
    return "Transaction took too long to complete. Your score may still be submitted — check your game history.";

  return `Score submission failed: ${msg.slice(0, 100)}`;
}
