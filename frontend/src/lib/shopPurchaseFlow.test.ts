/**
 * The shop's one-click purchase: "Buy Now" sends the G$ approval when it is needed and then the
 * purchase, and stops after the approval if that was rejected or failed. That relies on every
 * shop action resolving true only for a transaction that was mined successfully.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const writeContractAsync = vi.fn(async (_req: { functionName: string }) => "0xabc" as `0x${string}`);
let receiptStatus: "success" | "reverted" = "success";
let authType: "wagmi" | "magic" = "wagmi";
const magicRequest = vi.fn(async (_req: { method: string; params: unknown[] }) => "0xmagic" as `0x${string}`);

vi.mock("wagmi", () => ({
  useReadContract: () => ({ data: undefined, error: null, status: "success", refetch: vi.fn() }),
  useReadContracts: () => ({ data: [], status: "success" }),
  useWriteContract: () => ({ writeContractAsync }),
  useWaitForTransactionReceipt: () => ({ isLoading: false }),
}));
vi.mock("../hooks/useContractData", () => ({
  useContractAddress: () => "0x00000000000000000000000000000000000000aa",
  useContractPublicClient: () => ({
    waitForTransactionReceipt: async () => ({ status: receiptStatus, logs: [] }),
    estimateGas: async () => 100_000n,
    getGasPrice: async () => 25_000_000_000n,
  }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ authType, isConnected: true }) }));
vi.mock("../hooks/useSigner", () => ({ useSigner: () => ({ signer: { request: magicRequest }, isReady: true, error: null }) }));
vi.mock("../contexts/NoGasContext", () => ({ useNoGas: () => ({ triggerNoGas: vi.fn() }) }));
vi.mock("../hooks/useUndoAvailability", () => ({ useUndoAvailability: () => ({ available: false, reason: "switched-off" }) }));

import { useShop } from "../hooks/useShop";

function captureShop() {
  let out!: ReturnType<typeof useShop>;
  const Probe = () => { out = useShop(); return null; };
  renderToStaticMarkup(createElement(Probe));
  return out;
}
const src = (p: string) => readFileSync(join(__dirname, p), "utf8");

beforeEach(() => {
  // A successful purchase announces the new G$ balance on window; tests run without a DOM.
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  writeContractAsync.mockReset();
  writeContractAsync.mockImplementation(async () => "0xabc");
  receiptStatus = "success";
  authType = "wagmi";
  magicRequest.mockClear();
});

describe("shop actions report whether the transaction succeeded", () => {
  it("true once the transaction is mined successfully", async () => {
    const shop = captureShop();
    expect(await shop.approve()).toBe(true);
    expect(await shop.buyShield()).toBe(true);
  });

  it("false when the transaction is mined but reverted", async () => {
    receiptStatus = "reverted";
    expect(await captureShop().approve()).toBe(false);
  });

  it("false when the player rejects the request in the wallet", async () => {
    writeContractAsync.mockRejectedValueOnce(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    expect(await captureShop().approve()).toBe(false);
  });

  it("false, with no wallet request, for an Undo purchase while Undo is unavailable", async () => {
    expect(await captureShop().buyUndoMove(1)).toBe(false);
    expect(writeContractAsync).not.toHaveBeenCalled();
  });
});

describe("email (Magic) sign-ins can buy", () => {
  it("sends through the Magic signer, not wagmi, and succeeds", async () => {
    authType = "magic";
    expect(await captureShop().buyShield()).toBe(true);
    expect(writeContractAsync).not.toHaveBeenCalled();
    expect(magicRequest).toHaveBeenCalledTimes(1);
    const call = magicRequest.mock.calls[0][0];
    expect(call.method).toBe("eth_sendTransaction");
    const tx = call.params[0] as { gas: string; gasPrice: string };
    expect(BigInt(tx.gas)).toBe(120_000n);
    expect(BigInt(tx.gasPrice)).toBe(30_000_000_000n);
  });

  it("browser wallets still go through wagmi", async () => {
    expect(await captureShop().buyShield()).toBe(true);
    expect(writeContractAsync).toHaveBeenCalledTimes(1);
    expect(magicRequest).not.toHaveBeenCalled();
  });
});

describe("Buy Now in the shop page", () => {
  const shop = src("../components/Shop.tsx");

  it("chains the purchase after a successful approval, in one click", () => {
    expect(shop).toContain("if (await approve()) await buy();");
  });

  it("renders for an email sign-in too, and gates buying on the app's sign-in, not wagmi's", () => {
    expect(shop).not.toContain("if (!isConnected) return null;");
    expect(shop).not.toContain("Browser wallet needed");
    expect(shop).toContain("useAuth()");
  });
});
