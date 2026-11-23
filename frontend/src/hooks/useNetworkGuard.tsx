"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import {
  CELO_CHAIN_ID,
  FAILURE_COPY,
  classifyWalletError,
  createSingleFlight,
  deriveSetupStatus,
  ensureCeloChain,
  type CeloReadiness,
  type Eip1193Like,
  type EnsureCeloResult,
  type SetupFailure,
  type SetupStatus,
  type SetupStep,
} from "../lib/celoOnboarding";

export interface NetworkGuardState {
  /** Where the connected browser wallet is in setup. "idle" for email sign-ins or no wallet. */
  status: SetupStatus;
  /** "connecting" because a saved connection is being restored (after a reload), not a new one. */
  restoring: boolean;
  /** Why setup stopped, while it still applies (status "needs-action"). */
  failure: SetupFailure | null;
  /** "Wallet ready" is on screen after a setup the player took part in; the app waits for it. */
  celebrating: boolean;
  /** The wallet disconnected before setup finished. Cleared by the next connection. */
  interrupted: boolean;
  /** Connected browser wallet is on a chain other than Celo. */
  isWrongNetwork: boolean;
  /** A setup run (check, switch, add or confirm) is in progress. */
  switchPending: boolean;
  /** Plain-words reason the last attempt failed, or null. */
  switchError: string | null;
  /** True once an attempt has settled. */
  hasAttempted: boolean;
  /** Ask the wallet again (switch, add, or just re-check). Shares a run already in progress. */
  retrySwitch: () => void;
  /**
   * For an action the player just took (New Game, Submit, a purchase): resolves { ok: true } once
   * the browser wallet is on Celo, asking it to switch (or add Celo) first when it is on another
   * network. Shares a run already in progress, so it never opens a second prompt, and always
   * settles (see SETUP_TIMEOUTS). Email wallets, and a wallet already on Celo, resolve at once.
   */
  ensureCelo: () => Promise<CeloReadiness>;
  /** Disconnect the browser wallet, e.g. to pick a different one. */
  disconnectWallet: () => void;
  dismissInterrupted: () => void;
  /** Onboarding views register while on screen, so the floating banner doesn't repeat them. */
  registerSurface: () => () => void;
  surfaceVisible: boolean;
}

/** How long "Wallet ready" stays on screen after a setup the player took part in. */
export const READY_HOLD_MS = 1_000;

/** Automatic switch prompts per connection. After that only the player's own tap asks again. */
const MAX_AUTO_PROMPTS = 3;

const NOOP = () => {};

/** Inert state for trees rendered outside the provider (SSR, isolated renders, tests). */
const INERT: NetworkGuardState = {
  status: "idle",
  restoring: false,
  failure: null,
  celebrating: false,
  interrupted: false,
  isWrongNetwork: false,
  switchPending: false,
  switchError: null,
  hasAttempted: false,
  retrySwitch: NOOP,
  // No guard in this tree, so nothing can be switched: "ok", and shop writes stay pinned to Celo.
  ensureCelo: async () => ({ ok: true }),
  disconnectWallet: NOOP,
  dismissInterrupted: NOOP,
  registerSurface: () => NOOP,
  surfaceVisible: false,
};

export const NetworkGuardContext = createContext<NetworkGuardState | null>(null);

export function useNetworkGuard(): NetworkGuardState {
  return useContext(NetworkGuardContext) ?? INERT;
}

/**
 * Celo onboarding for browser wallets. Called once, by UnifiedAuthBridge, which publishes the
 * result through NetworkGuardContext and only reports a browser wallet as signed in once this
 * says "ready" (verified on Celo). One instance on purpose: one per consumer would open a
 * wallet prompt per consumer.
 *
 * As soon as a wallet is connected on another chain, this asks it to switch (adding Celo first
 * if the wallet doesn't know it) and then confirms the wallet really is on Celo; see
 * lib/celoOnboarding.ts. It asks on its own once per wallet, account and chain; after a refusal
 * it waits for the player to tap again, so nobody is prompted in a loop. A wallet that later
 * moves off Celo is asked once more.
 *
 * Email (Magic) wallets are created on Celo and are not wagmi connections, so `enabled` is
 * false for them and nothing here runs.
 */
export function useCeloOnboardingController(enabled: boolean): NetworkGuardState {
  const { address, connector, chainId, status: accountStatus } = useAccount();
  const { disconnect } = useDisconnect();
  const hasAccount = !!address && !!connector;
  const connectionKey = enabled && hasAccount ? `${connector!.uid}:${address!.toLowerCase()}` : null;

  const [runningStep, setRunningStep] = useState<SetupStep | null>(null);
  const [failure, setFailure] = useState<SetupFailure | null>(null);
  const [hasAttempted, setHasAttempted] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  // The connection whose "ready" has been handled (held for "Wallet ready", or let straight in).
  // Until then a ready wallet still counts as held, so the app never flashes in for one render
  // before the hold starts.
  const [readyAck, setReadyAck] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [surfaces, setSurfaces] = useState(0);

  const status = deriveSetupStatus({ enabled, accountStatus, hasAccount, chainId, runningStep, failure });

  // Latest values for work that outlives the render that started it.
  const live = useRef({ enabled, connector, chainId, connectionKey });
  live.current = { enabled, connector, chainId, connectionKey };

  const [flight] = useState(() => createSingleFlight<EnsureCeloResult>());
  const runIdRef = useRef(0);
  const interactiveRef = useRef(false);
  const expectDisconnectRef = useRef(false);
  const autoPromptsRef = useRef(new Map<string, number>());
  const attemptedRef = useRef(new Set<string>());

  const runSetup = useCallback((): Promise<EnsureCeloResult> => {
    const { connector: conn, connectionKey: key } = live.current;
    if (!conn || !key) return Promise.resolve({ ok: false, reason: "disconnected" });
    // Same connection already being set up: share that run instead of prompting again.
    return flight.run(key, async () => {
      const runId = ++runIdRef.current;
      const current = () => runIdRef.current === runId;
      interactiveRef.current = true;
      setFailure(null);
      setRunningStep("checking");
      let result: EnsureCeloResult;
      try {
        // The connection's own provider, never window.ethereum: with several wallets installed
        // (EIP-6963) or WalletConnect, that's the only one that reaches the chosen wallet.
        const provider = (await conn.getProvider()) as Eip1193Like | undefined;
        result =
          provider && typeof provider.request === "function"
            ? await ensureCeloChain(provider, {
                onStep: (s) => {
                  if (current()) setRunningStep(s);
                },
                isCancelled: () => !current(),
              })
            : { ok: false, reason: "unsupported" };
      } catch (err) {
        result = { ok: false, reason: classifyWalletError(err) === "disconnected" ? "disconnected" : "failed" };
      }
      if (!current()) return { ok: false, reason: "cancelled" }; // the connection changed or went away while we waited
      if (result.ok) {
        // The wallet itself just reported Celo. MetaMask can switch without a chainChanged
        // event, which would leave wagmi (and every hook reading the chain) behind; tell it.
        if (live.current.chainId !== CELO_CHAIN_ID) conn.emitter.emit("change", { chainId: CELO_CHAIN_ID });
      } else if (result.reason !== "cancelled") {
        setFailure(result.reason);
      }
      setHasAttempted(true);
      setRunningStep(null);
      return result;
    });
  }, [flight]);

  // A different connection, or none: drop the previous one's progress and stop its run.
  useEffect(() => {
    runIdRef.current++;
    setRunningStep(null);
    setFailure(null);
    setHasAttempted(false);
    setCelebrating(false);
  }, [connectionKey]);

  // Connected on another chain with nothing running: ask once, automatically.
  useEffect(() => {
    if (status !== "checking" || !connectionKey) return;
    const situation = `${connectionKey}:${chainId ?? "unknown"}`;
    const used = autoPromptsRef.current.get(connectionKey) ?? 0;
    if (attemptedRef.current.has(situation) || used >= MAX_AUTO_PROMPTS) {
      // Already asked about exactly this: wait for the player instead of prompting again.
      setFailure("wrong-network");
      return;
    }
    attemptedRef.current.add(situation);
    autoPromptsRef.current.set(connectionKey, used + 1);
    void runSetup();
  }, [status, connectionKey, chainId, runSetup]);

  // Bookkeeping on status changes.
  const prevStatusRef = useRef<SetupStatus>(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status === prev) return;
    if (status === "connecting") {
      // A connection the player started (a restore after reload is "reconnecting").
      if (accountStatus === "connecting") interactiveRef.current = true;
      setInterrupted(false);
    } else if (status === "ready") {
      setFailure(null);
      setHasAttempted(false);
      // Moving off Celo again later is a new situation: it gets one automatic prompt.
      if (connectionKey) {
        for (const k of [...attemptedRef.current]) if (k.startsWith(`${connectionKey}:`)) attemptedRef.current.delete(k);
      }
    } else if (status === "idle") {
      const wasSettingUp = prev !== "connecting" && prev !== "ready";
      if (enabled && wasSettingUp && !expectDisconnectRef.current) setInterrupted(true);
      expectDisconnectRef.current = false;
      interactiveRef.current = false;
    }
  }, [status, accountStatus, connectionKey, enabled]);

  // Each time a connection becomes ready: after a setup the player took part in (they connected,
  // or approved a switch), show "Wallet ready" for a moment; after a quiet restore, go straight in.
  useEffect(() => {
    if (status !== "ready") {
      if (readyAck !== null) setReadyAck(null);
      return;
    }
    if (readyAck === connectionKey) return;
    if (interactiveRef.current) setCelebrating(true);
    interactiveRef.current = false;
    setReadyAck(connectionKey);
  }, [status, connectionKey, readyAck]);

  // "Wallet ready" for a moment, then let the app in.
  useEffect(() => {
    if (!celebrating) return;
    if (status !== "ready") {
      setCelebrating(false);
      return;
    }
    const t = setTimeout(() => setCelebrating(false), READY_HOLD_MS);
    return () => clearTimeout(t);
  }, [celebrating, status]);

  const retrySwitch = useCallback(() => {
    void runSetup();
  }, [runSetup]);

  const ensureCelo = useCallback(async (): Promise<CeloReadiness> => {
    const { enabled: on, connector: conn, connectionKey: key, chainId: current } = live.current;
    if (!on) return { ok: true }; // email (Magic) wallets are created on Celo
    if (!conn || !key) return { ok: false, reason: "no-wallet" };
    // Already on Celo as far as wagmi knows: nothing to ask, and no setup run (which would briefly
    // take the wallet out of "ready"). Shop writes stay pinned to Celo, so a wallet that has quietly
    // moved since is refused rather than used on another network.
    if (current === CELO_CHAIN_ID) return { ok: true };
    // The player's own tap: asks even after an earlier refusal, like the "Switch to Celo" button.
    const result = await runSetup();
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }, [runSetup]);

  const disconnectWallet = useCallback(() => {
    expectDisconnectRef.current = true;
    runIdRef.current++;
    setInterrupted(false);
    disconnect();
  }, [disconnect]);

  const dismissInterrupted = useCallback(() => setInterrupted(false), []);

  const registerSurface = useCallback(() => {
    setSurfaces((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setSurfaces((n) => Math.max(0, n - 1));
    };
  }, []);

  const isWrongNetwork =
    enabled && accountStatus === "connected" && hasAccount && chainId !== undefined && chainId !== CELO_CHAIN_ID;
  const shownFailure = status === "needs-action" ? failure : null;
  const holdingReady = status === "ready" && (celebrating || readyAck !== connectionKey);
  const restoring = status === "connecting" && accountStatus === "reconnecting";

  return useMemo<NetworkGuardState>(
    () => ({
      status,
      restoring,
      failure: shownFailure,
      celebrating: holdingReady,
      interrupted,
      isWrongNetwork,
      switchPending: runningStep !== null,
      switchError: shownFailure ? FAILURE_COPY[shownFailure].message : null,
      hasAttempted,
      retrySwitch,
      ensureCelo,
      disconnectWallet,
      dismissInterrupted,
      registerSurface,
      surfaceVisible: surfaces > 0,
    }),
    [status, restoring, shownFailure, holdingReady, interrupted, isWrongNetwork, runningStep, hasAttempted, retrySwitch, ensureCelo, disconnectWallet, dismissInterrupted, registerSurface, surfaces],
  );
}
