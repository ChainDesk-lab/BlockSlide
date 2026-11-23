/**
 * Celo onboarding for browser wallets: the network definition, the wallet requests, and the
 * words players see. Framework-free so it can be tested against a fake wallet; the React side
 * (hooks/useNetworkGuard.tsx) only connects it to wagmi.
 *
 * For a connected wallet:
 *   1. read the wallet's own chain (eth_chainId)
 *   2. not Celo: ask it to switch (wallet_switchEthereumChain)
 *   3. the wallet doesn't know Celo (4902): ask it to add Celo (wallet_addEthereumChain), then
 *      ask to switch again if adding didn't already move it
 *   4. verify: wait until the wallet itself reports Celo, on chainChanged or by polling
 *      eth_chainId. A request that resolved is never taken as proof of a switch.
 *
 * Every wallet answer that isn't "now on Celo" ends in a SetupFailure, which the UI turns into
 * a plain message and one action. Nothing is retried automatically after a refusal.
 */
import { numberToHex } from "viem";
import { TARGET_CHAIN } from "./constants";

// ── Network ─────────────────────────────────────────────────────────────────

export const CELO_CHAIN_ID = TARGET_CHAIN.id; // 42220
export const CELO_CHAIN_ID_HEX = numberToHex(CELO_CHAIN_ID); // "0xa4ec"

/** The name a wallet lists the network under when we ask it to add Celo. */
export const CELO_NETWORK_NAME = "Celo Mainnet";

/**
 * EIP-3085 parameters for adding Celo. Everything except the display name comes from
 * TARGET_CHAIN (viem's `celo`), the one chain definition the app reads and writes through,
 * so the network a wallet adds can't drift from the one the app talks to.
 */
export const CELO_ADD_CHAIN_PARAMS = {
  chainId: CELO_CHAIN_ID_HEX,
  chainName: CELO_NETWORK_NAME,
  nativeCurrency: {
    name: TARGET_CHAIN.nativeCurrency.name,
    symbol: TARGET_CHAIN.nativeCurrency.symbol,
    decimals: TARGET_CHAIN.nativeCurrency.decimals,
  },
  rpcUrls: [TARGET_CHAIN.rpcUrls.default.http[0]],
  blockExplorerUrls: [TARGET_CHAIN.blockExplorers.default.url],
};

/**
 * A chain id as wallets report it: hex string (EIP-1193), decimal string (some older
 * providers) or number (WalletConnect's eth_chainId). Anything else is undefined.
 */
export function parseChainId(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  if (typeof value === "bigint") return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

// ── Wallet errors ───────────────────────────────────────────────────────────

export type WalletErrorKind =
  | "rejected" // the player said no (4001)
  | "pending" // the wallet already has this kind of request open (-32002)
  | "unrecognized-chain" // the wallet doesn't know Celo yet (4902)
  | "unsupported" // the wallet can't do this at all (4200, -32601, ...)
  | "disconnected" // the wallet went away (4900, 4901, 4100, ...)
  | "unknown";

/** Codes, names and messages from an error and everything it wraps. */
function errorFacts(err: unknown) {
  const codes: number[] = [];
  const names: string[] = [];
  const messages: string[] = [];
  const seen = new Set<unknown>();
  const visit = (e: unknown, depth: number) => {
    if (e == null || depth > 6) return;
    if (typeof e === "string") {
      messages.push(e);
      return;
    }
    if (typeof e !== "object" || seen.has(e)) return;
    seen.add(e);
    const o = e as Record<string, unknown>;
    if (typeof o.code === "number") codes.push(o.code);
    else if (typeof o.code === "string" && /^-?\d+$/.test(o.code)) codes.push(Number(o.code));
    if (typeof o.name === "string") names.push(o.name);
    for (const k of ["shortMessage", "message", "details", "reason"]) {
      if (typeof o[k] === "string") messages.push(o[k] as string);
    }
    // viem/wagmi wrap the provider's error in `cause`; some providers use `error`;
    // MetaMask Mobile nests the real one in `data.originalError`.
    visit(o.cause, depth + 1);
    visit(o.error, depth + 1);
    visit(o.originalError, depth + 1);
    if (o.data && typeof o.data === "object") visit(o.data, depth + 1);
  };
  visit(err, 0);
  return { codes, names, text: messages.join(" | ").toLowerCase() };
}

/** What a wallet's error means for onboarding. Codes win over message text. */
export function classifyWalletError(err: unknown): WalletErrorKind {
  const { codes, names, text } = errorFacts(err);
  const has = (...c: number[]) => c.some((x) => codes.includes(x));
  const named = (re: RegExp) => names.some((n) => re.test(n));

  if (has(4001) || named(/^UserRejectedRequestError$/) ||
      /user (rejected|denied|cancel)|rejected by (the )?user|denied by (the )?user|request (was )?rejected|user closed/.test(text)) {
    return "rejected";
  }
  if (has(-32002) || /already pending|request (is )?(already )?pending/.test(text)) return "pending";
  if (has(4902)) return "unrecognized-chain";
  if (has(4200, -32601, -32004) || named(/MethodNotSupported|UnsupportedProviderMethod|SwitchChainNotSupported/)) return "unsupported";
  if (has(4900, 4901, 4100) || named(/ConnectorNotConnected|ProviderDisconnected|ChainDisconnected|ProviderNotFound|ConnectorNotFound/)) {
    return "disconnected";
  }
  // Message-only answers, most specific first. WalletConnect: "The chain is not approved or the
  // wallet does not support 'wallet_switchEthereumChain'" means the session can't reach Celo.
  if (/(is|been) not approved|not been approved/.test(text)) return "unsupported";
  if (/unrecogni[sz]ed chain|try adding the chain|wallet_addethereumchain first|unknown chain|chain (id )?[^|]*not (been )?added|chain [^|]*not (recogni[sz]ed|found|configured)/.test(text)) {
    return "unrecognized-chain";
  }
  if (/method not found|not supported|does not support|doesn't support|unsupported|not implemented/.test(text)) return "unsupported";
  if (/disconnected|not connected|no provider|provider not found/.test(text)) return "disconnected";
  return "unknown";
}

/** A transaction refused because the wallet sits on another chain (viem/wagmi chain checks). */
export function isChainMismatchError(err: unknown): boolean {
  const { names, text } = errorFacts(err);
  return names.some((n) => /ChainMismatch|ChainNotConfigured/.test(n)) ||
    /does not match the target chain|chain mismatch|does not match the connection's chain/.test(text);
}

// ── Setup run ───────────────────────────────────────────────────────────────

/** The minimum of EIP-1193 this needs. Listener support is optional. */
export interface Eip1193Like {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
}

export type SetupStep = "checking" | "switching" | "adding" | "verifying";

export type SetupFailure =
  | "rejected" // declined the switch
  | "add-rejected" // declined adding Celo
  | "unsupported" // can't switch or add from the app
  | "timeout" // accepted, but never reported Celo
  | "disconnected" // went away during setup
  | "failed" // anything else
  | "wrong-network"; // moved off Celo again after we had already asked; waiting for the player

export type EnsureCeloResult =
  | { ok: true; chainId: number; switched: boolean; added: boolean }
  | { ok: false; reason: Exclude<SetupFailure, "wrong-network"> | "cancelled"; chainId?: number };

// ── Actions that need Celo ──────────────────────────────────────────────────

/** Why an action that needed the wallet on Celo couldn't get it there. */
export type CeloSwitchFailure = Exclude<SetupFailure, "wrong-network"> | "cancelled" | "no-wallet";

/** Whether the browser wallet is on Celo now, for an action the player just took. */
export type CeloReadiness = { ok: true } | { ok: false; reason: CeloSwitchFailure };

/** Player actions that need the wallet on Celo first. */
export type CeloAction = "start" | "submit" | "buy";

const TAP_AGAIN: Record<CeloAction, string> = {
  start: "tap New Game",
  submit: "tap Submit",
  buy: "buy again",
};

/**
 * What to tell the player when an action stopped because the wallet couldn't be put on Celo.
 * Nothing was started, sent or bought; the message says what to do, then to tap again.
 */
export function switchFailureMessage(reason: CeloSwitchFailure, action: CeloAction): string {
  const again = TAP_AGAIN[action];
  switch (reason) {
    case "rejected":
      return `Your wallet is still on another network. Approve the switch to Celo, then ${again}.`;
    case "add-rejected":
      return `Your wallet doesn't have the Celo network yet. Approve adding Celo (you only do this once), then ${again}.`;
    case "unsupported":
      return `Your wallet can't switch networks for us. Select Celo in your wallet, then ${again}.`;
    case "timeout":
      return `Your wallet hasn't confirmed the switch to Celo. Check your wallet, then ${again}.`;
    case "disconnected":
      return `Your wallet disconnected. Connect it again, then ${again}.`;
    case "no-wallet":
      return `No wallet is connected. Connect your wallet, then ${again}.`;
    case "cancelled":
      return `Your wallet changed while switching to Celo. Check your wallet, then ${again}.`;
    case "failed":
      return `Couldn't switch your wallet to Celo. Check your wallet, then ${again}.`;
  }
}

/** After a switch made for New Game or Submit: nothing carries on by itself; the player taps again. */
export function switchedToCeloMessage(action: Exclude<CeloAction, "buy">): string {
  return action === "start"
    ? "Your wallet is on Celo now. Tap New Game to start."
    : "Your wallet is on Celo now. Tap Submit to save your score.";
}

/** Thrown by a purchase that needed the wallet on Celo and couldn't get it there. Nothing was sent. */
export class CeloSwitchError extends Error {
  readonly reason: CeloSwitchFailure;
  constructor(reason: CeloSwitchFailure, action: CeloAction) {
    super(switchFailureMessage(reason, action));
    this.name = "CeloSwitchError";
    this.reason = reason;
  }
}

export const SETUP_TIMEOUTS = {
  /** After the wallet accepts, how long it gets to report Celo. */
  verifyMs: 10_000,
  /** A request the wallet already has open (-32002) may still be approved; wait this long for it. */
  pendingMs: 60_000,
  /** After adding Celo, how long to wait for the wallet's own switch before asking again. */
  afterAddMs: 1_500,
  pollMs: 500,
} as const;

export interface EnsureCeloOptions {
  onStep?: (step: SetupStep) => void;
  /** True once this run no longer matters (wallet changed or went away): stop without a result. */
  isCancelled?: () => boolean;
  verifyTimeoutMs?: number;
  pendingTimeoutMs?: number;
  afterAddGraceMs?: number;
  pollIntervalMs?: number;
  /** Injectable clock for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readChainId(provider: Eip1193Like): Promise<number | undefined> {
  return parseChainId(await provider.request({ method: "eth_chainId" }));
}

type WaitResult = { status: "celo" | "timeout" | "disconnected" | "cancelled"; chainId?: number };

/**
 * Waits until the wallet reports Celo. A chainChanged event only wakes the check early; the
 * answer always comes from eth_chainId, so a stray or late event can't fake a switch.
 */
export async function waitForCelo(
  provider: Eip1193Like,
  timeoutMs: number,
  options: Pick<EnsureCeloOptions, "isCancelled" | "pollIntervalMs" | "sleep" | "now"> = {},
): Promise<WaitResult> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const pollMs = options.pollIntervalMs ?? SETUP_TIMEOUTS.pollMs;
  let wake: (() => void) | null = null;
  // Set by every chainChanged, so an event that lands between a read and the wait isn't lost.
  let changed = false;
  const onChainChanged = () => {
    changed = true;
    wake?.();
  };
  try {
    provider.on?.("chainChanged", onChainChanged);
  } catch {
    /* listener support is optional; polling still works */
  }
  const deadline = now() + timeoutMs;
  let last: number | undefined;
  try {
    for (;;) {
      if (options.isCancelled?.()) return { status: "cancelled", chainId: last };
      changed = false;
      try {
        last = await readChainId(provider);
        if (last === CELO_CHAIN_ID) return { status: "celo", chainId: last };
      } catch (err) {
        if (classifyWalletError(err) === "disconnected") return { status: "disconnected", chainId: last };
        // A failed read is not an answer; keep waiting until the deadline.
      }
      const left = deadline - now();
      if (left <= 0) return { status: "timeout", chainId: last };
      if (changed) continue; // the wallet announced a change while we were reading: read again now
      await Promise.race([
        sleep(Math.min(pollMs, left)),
        new Promise<void>((resolve) => {
          wake = resolve;
        }),
      ]);
      wake = null;
    }
  } finally {
    try {
      provider.removeListener?.("chainChanged", onChainChanged);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Puts a connected wallet on Celo and proves it: see the module comment for the steps.
 * Prompts at most: one switch, one add, one more switch (only if adding didn't switch).
 */
export async function ensureCeloChain(provider: Eip1193Like, options: EnsureCeloOptions = {}): Promise<EnsureCeloResult> {
  const o = {
    verifyTimeoutMs: SETUP_TIMEOUTS.verifyMs,
    pendingTimeoutMs: SETUP_TIMEOUTS.pendingMs,
    afterAddGraceMs: SETUP_TIMEOUTS.afterAddMs,
    ...options,
  };
  const step = (s: SetupStep) => o.onStep?.(s);
  const cancelled = () => !!o.isCancelled?.();
  const CANCELLED = { ok: false, reason: "cancelled" } as const;
  const fail = (reason: Exclude<SetupFailure, "wrong-network">, chainId?: number): EnsureCeloResult => ({ ok: false, reason, chainId });
  const ask = async (method: "wallet_switchEthereumChain" | "wallet_addEthereumChain") => {
    try {
      await provider.request({
        method,
        params: [method === "wallet_switchEthereumChain" ? { chainId: CELO_CHAIN_ID_HEX } : CELO_ADD_CHAIN_PARAMS],
      });
      return null;
    } catch (err) {
      return classifyWalletError(err);
    }
  };
  const verify = async (timeoutMs: number, added: boolean, from?: number): Promise<EnsureCeloResult> => {
    step("verifying");
    const r = await waitForCelo(provider, timeoutMs, o);
    if (r.status === "celo") return { ok: true, chainId: CELO_CHAIN_ID, switched: true, added };
    if (r.status === "cancelled") return CANCELLED;
    if (r.status === "disconnected") return fail("disconnected", r.chainId ?? from);
    return fail("timeout", r.chainId ?? from);
  };

  step("checking");
  let current: number | undefined;
  try {
    current = await readChainId(provider);
  } catch (err) {
    return fail(classifyWalletError(err) === "disconnected" ? "disconnected" : "failed");
  }
  if (cancelled()) return CANCELLED;
  if (current === CELO_CHAIN_ID) return { ok: true, chainId: current, switched: false, added: false };

  step("switching");
  const switchErr = await ask("wallet_switchEthereumChain");
  if (cancelled()) return CANCELLED;
  if (switchErr === null) return verify(o.verifyTimeoutMs, false, current);
  if (switchErr === "pending") return verify(o.pendingTimeoutMs, false, current);
  if (switchErr === "rejected") return fail("rejected", current);
  if (switchErr === "unsupported") return fail("unsupported", current);
  if (switchErr === "disconnected") return fail("disconnected", current);
  if (switchErr !== "unrecognized-chain") return fail("failed", current);

  // The wallet doesn't know Celo: add it.
  step("adding");
  const addErr = await ask("wallet_addEthereumChain");
  if (cancelled()) return CANCELLED;
  if (addErr === "pending") return verify(o.pendingTimeoutMs, false, current);
  if (addErr === "rejected") return fail("add-rejected", current);
  if (addErr === "unsupported") return fail("unsupported", current);
  if (addErr === "disconnected") return fail("disconnected", current);
  if (addErr !== null) return fail("failed", current);

  // Most wallets offer the switch as part of adding (MetaMask: "Switch to Celo?"). Give that a
  // moment before asking again, so the player isn't asked twice for the same thing.
  step("verifying");
  const afterAdd = await waitForCelo(provider, o.afterAddGraceMs, o);
  if (afterAdd.status === "celo") return { ok: true, chainId: CELO_CHAIN_ID, switched: true, added: true };
  if (afterAdd.status === "cancelled") return CANCELLED;
  if (afterAdd.status === "disconnected") return fail("disconnected", afterAdd.chainId ?? current);

  step("switching");
  const secondErr = await ask("wallet_switchEthereumChain");
  if (cancelled()) return CANCELLED;
  if (secondErr === null) return verify(o.verifyTimeoutMs, true, current);
  if (secondErr === "pending") return verify(o.pendingTimeoutMs, true, current);
  if (secondErr === "rejected") return fail("rejected", current);
  if (secondErr === "disconnected") return fail("disconnected", current);
  // Added, yet still can't switch to it: nothing more the app can do from here.
  if (secondErr === "unsupported" || secondErr === "unrecognized-chain") return fail("unsupported", current);
  return fail("failed", current);
}

/**
 * Runs one task at a time per key: a second call for the same key while the first is still
 * running gets the same promise instead of opening a second wallet prompt.
 */
export function createSingleFlight<T>() {
  let current: { key: string; promise: Promise<T> } | null = null;
  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      if (current && current.key === key) return current.promise;
      const promise: Promise<T> = Promise.resolve()
        .then(task)
        .finally(() => {
          if (current?.promise === promise) current = null;
        });
      current = { key, promise };
      return promise;
    },
    isRunning(key?: string): boolean {
      return current !== null && (key === undefined || current.key === key);
    },
  };
}

// ── Status the UI shows ─────────────────────────────────────────────────────

export type SetupStatus =
  | "idle" // no browser wallet in play (none connected, or the player chose email)
  | "connecting" // the wallet is being asked to connect (or a saved connection is being restored)
  | SetupStep
  | "ready" // verified on Celo
  | "needs-action"; // stopped: a failure the player has to act on

export interface SetupSnapshot {
  /** The player chose a browser wallet (not email). */
  enabled: boolean;
  /** wagmi's account status. */
  accountStatus: "connected" | "connecting" | "reconnecting" | "disconnected";
  /** A connected address and connector are present. */
  hasAccount: boolean;
  /** The wallet's chain as wagmi last heard it from the wallet. */
  chainId: number | undefined;
  /** The step of a setup run in progress, if any. */
  runningStep: SetupStep | null;
  /** Why the last run stopped, while it still applies. */
  failure: SetupFailure | null;
}

/**
 * One status from the pieces. Ready only when connected and the wallet's chain is Celo; a saved
 * connection that is still being restored is never ready, because its chain may be stale.
 */
export function deriveSetupStatus(s: SetupSnapshot): SetupStatus {
  if (!s.enabled) return "idle";
  if (s.accountStatus === "connecting" || s.accountStatus === "reconnecting") return "connecting";
  if (s.accountStatus !== "connected" || !s.hasAccount) return "idle";
  if (s.runningStep) return s.runningStep;
  if (s.chainId === CELO_CHAIN_ID) return "ready";
  if (s.failure) return "needs-action";
  return "checking";
}

export const SETUP_STAGES = ["Connecting wallet", "Setting up Celo", "Wallet ready"] as const;

/** Which of the three stages a status belongs to (0-based). */
export function setupStage(status: SetupStatus): 0 | 1 | 2 {
  if (status === "ready") return 2;
  if (status === "idle" || status === "connecting") return 0;
  return 1;
}

/**
 * The one line under the stages while nothing needs the player's decision. `restoring` is a
 * saved connection coming back after a reload: nothing to approve, so don't ask for approval.
 */
export function setupStatusLine(status: SetupStatus, walletName?: string | null, options: { restoring?: boolean } = {}): string | null {
  const wallet = walletName?.trim() ? walletName.trim() : "your wallet";
  switch (status) {
    case "idle":
      return "Choose the wallet you want to play with.";
    case "connecting":
      return options.restoring ? "Reconnecting your wallet..." : `Approve the connection in ${wallet}.`;
    case "checking":
      return "Checking your wallet's network...";
    case "switching":
      return `Approve the switch to Celo in ${wallet}.`;
    case "adding":
      return `Approve adding Celo to ${wallet}. You only do this once.`;
    case "verifying":
      return "Confirming your wallet is on Celo...";
    case "ready":
      return "You're all set. Your wallet is on Celo.";
    case "needs-action":
      return null;
  }
}

export type FailureAction = "retry" | "reconnect";

export interface FailureCopy {
  title: string;
  message: string;
  actionLabel: string;
  action: FailureAction;
}

/** Plain words for each failure: no error codes, no RPC text. */
export const FAILURE_COPY: Record<SetupFailure, FailureCopy> = {
  rejected: {
    title: "Switch to Celo to continue",
    message: "BlockSlide runs on the Celo network. Approve the switch in your wallet to keep going.",
    actionLabel: "Switch to Celo",
    action: "retry",
  },
  "add-rejected": {
    title: "Add Celo to continue",
    message: "Your wallet needs the Celo network to play BlockSlide. Approve adding it in your wallet. You only do this once.",
    actionLabel: "Add Celo",
    action: "retry",
  },
  unsupported: {
    title: "Choose Celo in your wallet",
    message: "Your wallet can't switch networks for us. Open your wallet, select the Celo network, then come back. We'll notice the change. If Celo isn't listed, connect a different wallet.",
    actionLabel: "Check again",
    action: "retry",
  },
  timeout: {
    title: "Still waiting for your wallet",
    message: "We asked your wallet to switch to Celo, but it hasn't confirmed. Check your wallet, then try again.",
    actionLabel: "Try again",
    action: "retry",
  },
  disconnected: {
    title: "Wallet disconnected",
    message: "Your wallet disconnected before setup finished. Connect it again to continue.",
    actionLabel: "Connect again",
    action: "reconnect",
  },
  failed: {
    title: "Couldn't set up Celo",
    message: "Something went wrong while setting up the Celo network. Please try again.",
    actionLabel: "Try again",
    action: "retry",
  },
  "wrong-network": {
    title: "Your wallet is on another network",
    message: "BlockSlide runs on the Celo network. Switch back to Celo to keep playing.",
    actionLabel: "Switch to Celo",
    action: "retry",
  },
};

/** What to tell the player when a connection request fails, in plain words. */
export function connectErrorMessage(err: unknown): string {
  switch (classifyWalletError(err)) {
    case "rejected":
      return "The connection request was closed. Choose a wallet to try again.";
    case "pending":
      return "Your wallet already has a request waiting. Open your wallet to approve it.";
    default:
      return "Your wallet didn't connect. Try again, or choose a different wallet.";
  }
}
