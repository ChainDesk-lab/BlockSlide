/**
 * "Send G$": the checks that keep a player from losing G$, and the transfer itself for email
 * (Magic) and browser wallets.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decodeFunctionData, erc20Abi } from "viem";
import { checkSend, parseGAmount } from "./sendGDollar";

const ME = "0x00000000000000000000000000000000000000aa";
const FRIEND = "0x1111111111111111111111111111111111111111";
const G = (n: string) => parseGAmount(n)!;

describe("checkSend", () => {
  const base = { to: FRIEND, amount: "10", from: ME, balanceWei: G("100") };

  it("accepts a valid address and amount, and checksums the address", () => {
    const r = checkSend({ ...base, to: FRIEND.toLowerCase() });
    expect(r).toEqual({ ok: true, to: "0x1111111111111111111111111111111111111111", amountWei: G("10") });
  });

  it.each([
    ["", "Enter the wallet address"],
    ["0x1234", "isn't a valid wallet address"],
    ["hello", "isn't a valid wallet address"],
    ["0x0000000000000000000000000000000000000000", "zero address"],
    ["0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A", "G$ token contract"],
    ["0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6", "game contract"],
    [ME, "your own BlockSlide wallet"],
  ])("refuses the recipient %s", (to, msg) => {
    const r = checkSend({ ...base, to });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.field).toBe("to"); expect(r.message).toContain(msg); }
  });

  it.each([
    ["", "Enter an amount"], ["abc", "Enter an amount"], ["1.2.3", "Enter an amount"], ["-5", "Enter an amount"],
    ["0", "more than 0"], ["0.000", "more than 0"], ["100.0000000000000000001", "Enter an amount"], ["100.01", "more G$ than you have"],
  ])("refuses the amount %s", (amount, msg) => {
    const r = checkSend({ ...base, amount });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.field).toBe("amount"); expect(r.message).toContain(msg); }
  });

  it("allows sending the whole balance exactly, and amounts with commas or decimals", () => {
    expect(checkSend({ ...base, amount: "100" }).ok).toBe(true);
    expect(checkSend({ ...base, amount: "12.5" })).toMatchObject({ ok: true, amountWei: G("12.5") });
    expect(checkSend({ ...base, amount: "1,000", balanceWei: G("5000") })).toMatchObject({ ok: true, amountWei: G("1000") });
  });
});

// ── The transfer ─────────────────────────────────────────────────────────

const writeContractAsync = vi.fn(async (_req: unknown) => "0xabc" as `0x${string}`);
const magicRequest = vi.fn(async (_req: { method: string; params: unknown[] }) => "0xmagic" as `0x${string}`);
const triggerNoGas = vi.fn();
let authType: "wagmi" | "magic" = "magic";
let receiptStatus: "success" | "reverted" = "success";

vi.mock("wagmi", () => ({ useWriteContract: () => ({ writeContractAsync }) }));
vi.mock("../hooks/useContractData", () => ({
  useContractAddress: () => ME,
  useContractPublicClient: () => ({
    waitForTransactionReceipt: async () => ({ status: receiptStatus }),
    estimateGas: async () => 60_000n,
    getGasPrice: async () => 25_000_000_000n,
  }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ authType, address: ME }) }));
vi.mock("../hooks/useSigner", () => ({ useSigner: () => ({ signer: { request: magicRequest }, isReady: true, error: null }) }));
vi.mock("../contexts/NoGasContext", () => ({ useNoGas: () => ({ triggerNoGas }) }));

import { useSendGDollar } from "../hooks/useSendGDollar";

function captureSend() {
  let out!: ReturnType<typeof useSendGDollar>;
  const Probe = () => { out = useSendGDollar(); return null; };
  renderToStaticMarkup(createElement(Probe));
  return out;
}

beforeEach(() => {
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  writeContractAsync.mockReset(); writeContractAsync.mockImplementation(async () => "0xabc");
  magicRequest.mockReset(); magicRequest.mockImplementation(async () => "0xmagic");
  triggerNoGas.mockClear();
  authType = "magic";
  receiptStatus = "success";
});

describe("sending G$", () => {
  it("email wallets: a G$ transfer through the Magic signer, with a gas margin", async () => {
    expect(await captureSend().send(FRIEND, G("25"))).toBe(true);
    expect(writeContractAsync).not.toHaveBeenCalled();
    const { method, params } = magicRequest.mock.calls[0][0];
    expect(method).toBe("eth_sendTransaction");
    const tx = params[0] as { from: string; to: string; data: `0x${string}`; gas: string; gasPrice: string };
    expect(tx.from).toBe(ME);
    expect(tx.to).toBe("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data })).toEqual({ functionName: "transfer", args: [FRIEND, G("25")] });
    expect(BigInt(tx.gas)).toBe(72_000n);
    expect(BigInt(tx.gasPrice)).toBe(30_000_000_000n);
    expect((window.dispatchEvent as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("browser wallets: the same transfer through wagmi, on Celo", async () => {
    authType = "wagmi";
    expect(await captureSend().send(FRIEND, G("1"))).toBe(true);
    expect(magicRequest).not.toHaveBeenCalled();
    expect(writeContractAsync.mock.calls[0][0]).toMatchObject({ functionName: "transfer", args: [FRIEND, G("1")], chainId: 42220 });
  });

  it("reports failure when the transfer reverts on-chain", async () => {
    receiptStatus = "reverted";
    expect(await captureSend().send(FRIEND, G("1"))).toBe(false);
  });

  it("no CELO for the fee: opens the gas top-up and sends nothing", async () => {
    magicRequest.mockImplementation(async () => { throw new Error("insufficient funds for gas * price + value"); });
    expect(await captureSend().send(FRIEND, G("1"))).toBe(false);
    expect(triggerNoGas).toHaveBeenCalled();
  });
});
