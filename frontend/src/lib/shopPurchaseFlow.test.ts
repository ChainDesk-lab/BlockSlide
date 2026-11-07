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

vi.mock("wagmi", () => ({
  useReadContract: () => ({ data: undefined, error: null, status: "success", refetch: vi.fn() }),
  useReadContracts: () => ({ data: [], status: "success" }),
  useWriteContract: () => ({ writeContractAsync }),
  useWaitForTransactionReceipt: () => ({ isLoading: false }),
}));
vi.mock("../hooks/useContractData", () => ({
  useContractAddress: () => "0x00000000000000000000000000000000000000aa",
  useContractPublicClient: () => ({ waitForTransactionReceipt: async () => ({ status: receiptStatus, logs: [] }) }),
}));
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

describe("Buy Now in the shop page", () => {
  const shop = src("../components/Shop.tsx");

  it("chains the purchase after a successful approval, in one click", () => {
    expect(shop).toContain("if (await approve()) await buy();");
  });

  it("renders for an email sign-in too, with purchases explained instead of a blank page", () => {
    expect(shop).not.toContain("if (!isConnected) return null;");
    expect(shop).toContain('label: "Browser wallet needed"');
  });
});
