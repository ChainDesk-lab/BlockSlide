import { describe, expect, it } from "vitest";
import {
  HttpRequestError,
  InsufficientFundsError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import { classifyTxError } from "./txErrors";

describe("classifyTxError", () => {
  it("recognises a receipt timeout (the tx may still land)", () => {
    expect(classifyTxError(new WaitForTransactionReceiptTimeoutError({ hash: "0x01" }))).toBe("receipt_timeout");
  });
  it("recognises a user rejection", () => {
    expect(classifyTxError(new UserRejectedRequestError(new Error("User rejected the request.")))).toBe("user_rejected");
    expect(classifyTxError({ code: 4001, message: "denied" })).toBe("user_rejected");
  });
  it("recognises insufficient funds, including a node's raw message nested in a cause", () => {
    expect(classifyTxError(new InsufficientFundsError())).toBe("insufficient_funds");
    expect(classifyTxError(new Error("send failed", { cause: { message: "insufficient funds for gas * price + value" } }))).toBe(
      "insufficient_funds",
    );
  });
  it("recognises an RPC/network failure as distinct from a lack of gas", () => {
    expect(classifyTxError(new HttpRequestError({ url: "https://forno.celo.org", details: "fetch failed" }))).toBe("rpc_unavailable");
  });
  it("recognises a revert", () => {
    expect(classifyTxError(new Error("execution reverted: NoActiveSession"))).toBe("reverted");
  });
  it("leaves anything else as unknown", () => {
    expect(classifyTxError(new Error("something odd"))).toBe("unknown");
    expect(classifyTxError(null)).toBe("unknown");
  });
});
