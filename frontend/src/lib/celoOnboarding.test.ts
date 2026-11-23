/**
 * Celo onboarding core, against a fake EIP-1193 wallet that behaves like the real ones:
 * unknown chains answer 4902, refusals 4001, an open prompt -32002, and so on. A virtual clock
 * makes the waiting cases (late chainChanged, never switching) instant and exact.
 */
import { describe, expect, it } from "vitest";
import {
  CELO_ADD_CHAIN_PARAMS,
  CELO_CHAIN_ID,
  FAILURE_COPY,
  SETUP_STAGES,
  SETUP_TIMEOUTS,
  classifyWalletError,
  connectErrorMessage,
  createSingleFlight,
  deriveSetupStatus,
  ensureCeloChain,
  isChainMismatchError,
  parseChainId,
  setupStage,
  setupStatusLine,
  waitForCelo,
  type SetupFailure,
  type SetupSnapshot,
  type SetupStatus,
  type SetupStep,
} from "./celoOnboarding";

const ETHEREUM = 1;
const POLYGON = 137;
const CELO = CELO_CHAIN_ID;

const rpcError = (code: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

type SwitchAnswer = "accept" | "accept-late" | "accept-silently" | "reject" | "unsupported" | "pending" | "ignore" | "disconnect" | "error";
type AddAnswer = "accept-and-switch" | "accept" | "reject" | "unsupported" | "pending";

interface FakeOptions {
  chain: number;
  knowsCelo?: boolean;
  /** One answer per switch request, in order; "accept" after the list runs out. */
  switches?: SwitchAnswer[];
  add?: AddAnswer;
  /** How eth_chainId reports the chain. WalletConnect answers with a number. */
  format?: "hex" | "number" | "decimal";
  /** For "accept-late"/"pending": when (virtual ms after the request) the wallet actually moves. */
  lateMs?: number;
}

function makeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      await Promise.resolve();
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function fakeWallet(o: FakeOptions, clock = makeClock()) {
  let chain = o.chain;
  let knowsCelo = o.knowsCelo ?? true;
  let moveAt: number | null = null;
  let disconnected = false;
  let switchCount = 0;
  const calls: { method: string; params?: readonly unknown[] }[] = [];
  const listeners = new Map<string, Set<(...a: any[]) => void>>();
  const emit = (event: string, value: unknown) => listeners.get(event)?.forEach((f) => f(value));
  const move = (id: number, announce = true) => {
    chain = id;
    if (announce) emit("chainChanged", `0x${id.toString(16)}`);
  };
  const format = (id: number) => (o.format === "number" ? id : o.format === "decimal" ? String(id) : `0x${id.toString(16)}`);

  const provider = {
    async request({ method, params }: { method: string; params?: readonly unknown[] }) {
      calls.push({ method, params });
      if (moveAt !== null && clock.now() >= moveAt) {
        moveAt = null;
        move(CELO, false); // MetaMask's known quirk: switched, but no chainChanged event
      }
      if (disconnected) throw rpcError(4900, "Disconnected from all chains");
      switch (method) {
        case "eth_chainId":
          return format(chain);
        case "wallet_switchEthereumChain": {
          const answer = o.switches?.[switchCount] ?? "accept";
          switchCount++;
          if (answer === "unsupported") throw rpcError(4200, "The Provider does not support the requested method.");
          if (answer === "disconnect") {
            disconnected = true;
            throw rpcError(4900, "Disconnected");
          }
          if (answer === "error") throw rpcError(-32603, "Internal JSON-RPC error.");
          if (!knowsCelo) {
            throw rpcError(4902, 'Unrecognized chain ID "0xa4ec". Try adding the chain using wallet_addEthereumChain first.');
          }
          if (answer === "reject") throw rpcError(4001, "User rejected the request.");
          if (answer === "pending") {
            moveAt = clock.now() + (o.lateMs ?? 5_000);
            throw rpcError(-32002, "Request of type 'wallet_switchEthereumChain' already pending for origin. Please wait.");
          }
          if (answer === "accept") move(CELO);
          if (answer === "accept-silently") move(CELO, false);
          if (answer === "accept-late") moveAt = clock.now() + (o.lateMs ?? 3_000);
          // "ignore": resolves like a success but stays where it is
          return null;
        }
        case "wallet_addEthereumChain": {
          const answer = o.add ?? "accept-and-switch";
          if (answer === "reject") throw rpcError(4001, "User rejected the request.");
          if (answer === "unsupported") throw rpcError(-32601, "Method not found");
          if (answer === "pending") {
            moveAt = clock.now() + (o.lateMs ?? 5_000);
            throw rpcError(-32002, "Request of type 'wallet_addEthereumChain' already pending");
          }
          knowsCelo = true;
          if (answer === "accept-and-switch") move(CELO);
          return null;
        }
        default:
          // Onboarding never asks for anything else, least of all a signature.
          throw new Error(`unexpected wallet request: ${method}`);
      }
    },
    on(event: string, f: (...a: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(f);
    },
    removeListener(event: string, f: (...a: any[]) => void) {
      listeners.get(event)?.delete(f);
    },
  };
  const methods = () => calls.map((c) => c.method);
  const count = (m: string) => methods().filter((x) => x === m).length;
  return { provider, calls, methods, count, clock, emit, move, listenerCount: (e: string) => listeners.get(e)?.size ?? 0 };
}

async function run(o: FakeOptions, extra: Parameters<typeof ensureCeloChain>[1] = {}) {
  const w = fakeWallet(o);
  const steps: SetupStep[] = [];
  const result = await ensureCeloChain(w.provider, {
    sleep: w.clock.sleep,
    now: w.clock.now,
    onStep: (s) => steps.push(s),
    ...extra,
  });
  return { ...w, steps, result };
}

describe("Celo network definition", () => {
  it("matches the requested Celo Mainnet settings exactly", () => {
    expect(CELO_ADD_CHAIN_PARAMS).toEqual({
      chainId: "0xa4ec",
      chainName: "Celo Mainnet",
      nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
      rpcUrls: ["https://forno.celo.org"],
      blockExplorerUrls: ["https://celoscan.io"],
    });
    expect(CELO).toBe(42220);
  });

  it("reads chain ids however wallets send them", () => {
    expect(parseChainId("0xa4ec")).toBe(42220);
    expect(parseChainId("0xA4EC")).toBe(42220);
    expect(parseChainId(42220)).toBe(42220);
    expect(parseChainId("42220")).toBe(42220);
    expect(parseChainId(42220n)).toBe(42220);
    for (const bad of [null, undefined, "", "0x", "celo", -1, 0, 1.5, {}, "0xzz"]) expect(parseChainId(bad)).toBeUndefined();
  });
});

describe("Wallet error meanings", () => {
  it.each<[string, unknown, ReturnType<typeof classifyWalletError>]>([
    ["4001", rpcError(4001, "User rejected the request."), "rejected"],
    ["viem's rejection", Object.assign(new Error("User rejected the request."), { name: "UserRejectedRequestError" }), "rejected"],
    ["WalletConnect rejection", rpcError(5000, "User rejected."), "rejected"],
    ["prompt already open", rpcError(-32002, "Request of type 'wallet_switchEthereumChain' already pending"), "pending"],
    ["4902", rpcError(4902, "Unrecognized chain ID"), "unrecognized-chain"],
    ["MetaMask Mobile's nested 4902", rpcError(-32603, "Internal error", { data: { originalError: { code: 4902 } } }), "unrecognized-chain"],
    ["wrapped by viem/wagmi", Object.assign(new Error("Switch failed"), { cause: rpcError(4902, "x") }), "unrecognized-chain"],
    ["message only", rpcError(-32603, 'Unrecognized chain ID "0xa4ec". Try adding the chain using wallet_addEthereumChain first.'), "unrecognized-chain"],
    ["4200", rpcError(4200, "Unsupported method"), "unsupported"],
    ["-32601", rpcError(-32601, "Method not found"), "unsupported"],
    ["WalletConnect session without Celo", new Error("Failed to switch to chain 'eip155:42220'. The chain is not approved or the wallet does not support 'wallet_switchEthereumChain' method."), "unsupported"],
    ["4900", rpcError(4900, "Disconnected"), "disconnected"],
    ["4901", rpcError(4901, "Chain disconnected"), "disconnected"],
    ["4100 (locked)", rpcError(4100, "Unauthorized"), "disconnected"],
    ["anything else", new Error("boom"), "unknown"],
    ["not an error", undefined, "unknown"],
  ])("%s", (_name, err, kind) => {
    expect(classifyWalletError(err)).toBe(kind);
  });

  it("spots a transaction refused for being on the wrong chain", () => {
    expect(isChainMismatchError(Object.assign(new Error("x"), { name: "ChainMismatchError" }))).toBe(true);
    expect(isChainMismatchError(new Error("The current chain of the wallet (id: 1) does not match the target chain for the transaction (id: 42220 – Celo)."))).toBe(true);
    expect(isChainMismatchError(new Error("insufficient funds"))).toBe(false);
  });

  it("explains a failed connection without wallet jargon", () => {
    expect(connectErrorMessage(rpcError(4001, "User rejected the request."))).toBe("The connection request was closed. Choose a wallet to try again.");
    expect(connectErrorMessage(rpcError(-32002, "already pending"))).toMatch(/already has a request waiting/);
    expect(connectErrorMessage(new Error("Internal JSON-RPC error. code -32603"))).toBe("Your wallet didn't connect. Try again, or choose a different wallet.");
  });
});

describe("Putting a wallet on Celo", () => {
  it("does nothing when the wallet is already on Celo", async () => {
    const r = await run({ chain: CELO });
    expect(r.result).toEqual({ ok: true, chainId: CELO, switched: false, added: false });
    expect(r.methods()).toEqual(["eth_chainId"]);
    expect(r.steps).toEqual(["checking"]);
  });

  it.each([["Ethereum", ETHEREUM], ["another EVM network", POLYGON]])("switches a wallet on %s, then confirms it", async (_n, chain) => {
    const r = await run({ chain });
    expect(r.result).toEqual({ ok: true, chainId: CELO, switched: true, added: false });
    expect(r.count("wallet_switchEthereumChain")).toBe(1);
    expect(r.calls.find((c) => c.method === "wallet_switchEthereumChain")?.params).toEqual([{ chainId: "0xa4ec" }]);
    expect(r.count("wallet_addEthereumChain")).toBe(0);
    // Confirmed by reading the chain after the switch, not by the request resolving.
    expect(r.methods().lastIndexOf("eth_chainId")).toBeGreaterThan(r.methods().indexOf("wallet_switchEthereumChain"));
    expect(r.steps).toEqual(["checking", "switching", "verifying"]);
  });

  it("adds Celo when the wallet doesn't know it, and doesn't ask to switch twice when adding switched", async () => {
    const r = await run({ chain: ETHEREUM, knowsCelo: false, add: "accept-and-switch" });
    expect(r.result).toEqual({ ok: true, chainId: CELO, switched: true, added: true });
    expect(r.methods().filter((m) => m !== "eth_chainId")).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain"]);
    expect(r.calls.find((c) => c.method === "wallet_addEthereumChain")?.params).toEqual([CELO_ADD_CHAIN_PARAMS]);
    expect(r.steps).toEqual(["checking", "switching", "adding", "verifying"]);
  });

  it("asks to switch once more when the wallet added Celo but stayed put", async () => {
    const r = await run({ chain: ETHEREUM, knowsCelo: false, add: "accept" });
    expect(r.result).toMatchObject({ ok: true, added: true });
    expect(r.methods().filter((m) => m !== "eth_chainId")).toEqual([
      "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain",
    ]);
  });

  it("stops at a declined switch: one prompt, no add, no retry", async () => {
    const r = await run({ chain: ETHEREUM, switches: ["reject"] });
    expect(r.result).toEqual({ ok: false, reason: "rejected", chainId: ETHEREUM });
    expect(r.count("wallet_switchEthereumChain")).toBe(1);
    expect(r.count("wallet_addEthereumChain")).toBe(0);
  });

  it("stops at a declined add", async () => {
    const r = await run({ chain: ETHEREUM, knowsCelo: false, add: "reject" });
    expect(r.result).toMatchObject({ ok: false, reason: "add-rejected" });
    expect(r.count("wallet_switchEthereumChain")).toBe(1);
  });

  it("stops at a declined second switch after adding", async () => {
    const r = await run({ chain: ETHEREUM, knowsCelo: false, add: "accept", switches: ["accept", "reject"] });
    expect(r.result).toMatchObject({ ok: false, reason: "rejected" });
    expect(r.count("wallet_switchEthereumChain")).toBe(2);
  });

  it("reports a wallet that can't switch networks", async () => {
    const r = await run({ chain: ETHEREUM, switches: ["unsupported"] });
    expect(r.result).toMatchObject({ ok: false, reason: "unsupported" });
    const added = await run({ chain: ETHEREUM, knowsCelo: false, add: "unsupported" });
    expect(added.result).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("waits for a prompt that is already open instead of opening another", async () => {
    const r = await run({ chain: ETHEREUM, switches: ["pending"], lateMs: 20_000 });
    expect(r.result).toMatchObject({ ok: true, switched: true });
    expect(r.count("wallet_switchEthereumChain")).toBe(1);
  });

  it("handles a late switch with no chainChanged event by reading the chain", async () => {
    const r = await run({ chain: ETHEREUM, switches: ["accept-late"], lateMs: 4_000 });
    expect(r.result).toMatchObject({ ok: true, chainId: CELO });
  });

  it("handles a switch that never emits chainChanged", async () => {
    const r = await run({ chain: ETHEREUM, switches: ["accept-silently"] });
    expect(r.result).toMatchObject({ ok: true, chainId: CELO });
  });

  it("never takes a resolved request as proof: a wallet that says yes but stays put times out", async () => {
    const r = await run({ chain: ETHEREUM, switches: ["ignore"] });
    expect(r.result).toEqual({ ok: false, reason: "timeout", chainId: ETHEREUM });
    expect(r.clock.now()).toBeGreaterThanOrEqual(SETUP_TIMEOUTS.verifyMs);
    expect(r.count("wallet_switchEthereumChain")).toBe(1);
  });

  it("reports a wallet that disconnects during setup", async () => {
    const r = await run({ chain: ETHEREUM, switches: ["disconnect"] });
    expect(r.result).toMatchObject({ ok: false, reason: "disconnected" });
  });

  it("reports other wallet errors as a plain failure", async () => {
    const r = await run({ chain: ETHEREUM, switches: ["error"] });
    expect(r.result).toMatchObject({ ok: false, reason: "failed" });
  });

  it("stops quietly, with no more wallet requests, once cancelled", async () => {
    let cancel = false;
    const r = await run({ chain: ETHEREUM, switches: ["ignore"] }, { isCancelled: () => cancel, onStep: (s) => { if (s === "verifying") cancel = true; } });
    expect(r.result).toEqual({ ok: false, reason: "cancelled" });
    expect(r.methods().filter((m) => m !== "eth_chainId")).toEqual(["wallet_switchEthereumChain"]);
  });

  it("understands WalletConnect's numeric chain ids", async () => {
    expect((await run({ chain: CELO, format: "number" })).result).toMatchObject({ ok: true, switched: false });
    expect((await run({ chain: ETHEREUM, format: "number" })).result).toMatchObject({ ok: true, switched: true });
    expect((await run({ chain: CELO, format: "decimal" })).result).toMatchObject({ ok: true, switched: false });
  });

  it("removes its chainChanged listener when done", async () => {
    const r = await run({ chain: ETHEREUM, switches: ["accept-late"] });
    expect(r.listenerCount("chainChanged")).toBe(0);
  });
});

describe("Confirming the chain", () => {
  it("wakes on chainChanged but still confirms with eth_chainId", async () => {
    const w = fakeWallet({ chain: ETHEREUM });
    // A sleep that never ends: only the event can move the check on.
    const waiting = waitForCelo(w.provider, 60_000, { sleep: () => new Promise(() => {}), now: w.clock.now });
    await Promise.resolve();
    w.move(CELO); // the wallet switches and announces it
    await expect(waiting).resolves.toEqual({ status: "celo", chainId: CELO });
  });

  it("ignores a stray chainChanged that the wallet's own answer contradicts", async () => {
    const w = fakeWallet({ chain: ETHEREUM });
    const waiting = waitForCelo(w.provider, 2_000, { sleep: w.clock.sleep, now: w.clock.now });
    w.emit("chainChanged", "0xa4ec"); // event says Celo, eth_chainId still says Ethereum
    await expect(waiting).resolves.toEqual({ status: "timeout", chainId: ETHEREUM });
  });
});

describe("One wallet request at a time", () => {
  it("shares a running request instead of opening a second prompt", async () => {
    const flight = createSingleFlight<number>();
    let calls = 0;
    let release!: () => void;
    const task = () => new Promise<number>((r) => {
      calls++;
      release = () => r(calls);
    });
    const a = flight.run("wallet-a", task);
    const b = flight.run("wallet-a", task);
    expect(flight.isRunning("wallet-a")).toBe(true);
    await Promise.resolve();
    release();
    expect(await a).toBe(1);
    expect(await b).toBe(1);
    expect(calls).toBe(1);
    expect(flight.isRunning()).toBe(false);
    // Finished: the next request goes out.
    const c = flight.run("wallet-a", async () => 7);
    expect(await c).toBe(7);
  });

  it("doesn't let an old wallet's request block a new wallet", async () => {
    const flight = createSingleFlight<string>();
    flight.run("old", () => new Promise(() => {}));
    expect(await flight.run("new", async () => "new")).toBe("new");
  });
});

describe("Status the player sees", () => {
  const base: SetupSnapshot = {
    enabled: true, accountStatus: "connected", hasAccount: true, chainId: CELO, runningStep: null, failure: null,
  };
  it.each<[string, Partial<SetupSnapshot>, SetupStatus]>([
    ["email sign-in", { enabled: false, chainId: ETHEREUM }, "idle"],
    ["no wallet", { accountStatus: "disconnected", hasAccount: false, chainId: undefined }, "idle"],
    ["connecting", { accountStatus: "connecting" }, "connecting"],
    ["restoring a saved connection, even one saved on Celo", { accountStatus: "reconnecting" }, "connecting"],
    ["connected on Celo", {}, "ready"],
    ["connected elsewhere, before the first attempt", { chainId: ETHEREUM }, "checking"],
    ["a switch in progress", { chainId: ETHEREUM, runningStep: "switching" }, "switching"],
    ["after a refusal", { chainId: ETHEREUM, failure: "rejected" }, "needs-action"],
    ["the wallet moved to Celo after a refusal", { chainId: CELO, failure: "rejected" }, "ready"],
  ])("%s", (_name, patch, status) => {
    expect(deriveSetupStatus({ ...base, ...patch })).toBe(status);
  });

  it("maps every status onto the three stages", () => {
    expect(SETUP_STAGES).toEqual(["Connecting wallet", "Setting up Celo", "Wallet ready"]);
    expect(setupStage("idle")).toBe(0);
    expect(setupStage("connecting")).toBe(0);
    for (const s of ["checking", "switching", "adding", "verifying", "needs-action"] as const) expect(setupStage(s)).toBe(1);
    expect(setupStage("ready")).toBe(2);
  });

  it("names the wallet in its prompts", () => {
    expect(setupStatusLine("connecting", "MetaMask")).toBe("Approve the connection in MetaMask.");
    expect(setupStatusLine("switching", "Rabby Wallet")).toBe("Approve the switch to Celo in Rabby Wallet.");
    expect(setupStatusLine("switching")).toBe("Approve the switch to Celo in your wallet.");
    expect(setupStatusLine("needs-action")).toBeNull();
  });

  it("doesn't ask for approval while a saved connection is restored", () => {
    expect(setupStatusLine("connecting", "MetaMask", { restoring: true })).toBe("Reconnecting your wallet...");
  });

  const JARGON = /rpc|chain ?id|0x|eip|wallet_|4001|4902|-32|json|provider|hex/i;
  it("uses no error codes or wallet jargon in anything it shows", () => {
    const statuses: SetupStatus[] = ["idle", "connecting", "checking", "switching", "adding", "verifying", "ready", "needs-action"];
    for (const s of statuses) expect(setupStatusLine(s, "MetaMask") ?? "").not.toMatch(JARGON);
    for (const f of Object.keys(FAILURE_COPY) as SetupFailure[]) {
      const c = FAILURE_COPY[f];
      for (const text of [c.title, c.message, c.actionLabel]) {
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(JARGON);
      }
    }
    expect(connectErrorMessage(new Error("code 4001 json-rpc"))).not.toMatch(JARGON);
  });

  it("offers reconnecting only when the wallet has gone", () => {
    for (const f of Object.keys(FAILURE_COPY) as SetupFailure[]) {
      expect(FAILURE_COPY[f].action).toBe(f === "disconnected" ? "reconnect" : "retry");
    }
  });
});
