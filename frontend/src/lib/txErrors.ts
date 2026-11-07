import { isInsufficientGasError } from "./gasError";
import { GasPlanRpcError } from "./gasPlan";

/**
 * What kind of failure a transaction error is. These need different responses:
 * insufficient funds opens the gas top-up; an RPC failure is a retry, not a
 * lack of gas; a receipt timeout means the transaction may still land and must
 * not be resubmitted blindly.
 */
export type TxErrorKind =
  | "insufficient_funds"
  | "user_rejected"
  | "rpc_unavailable"
  | "receipt_timeout"
  | "reverted"
  | "unknown";

function chain(err: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let e: unknown = err;
  for (let i = 0; i < 8 && e && typeof e === "object"; i++) {
    out.push(e as Record<string, unknown>);
    e = (e as { cause?: unknown }).cause;
  }
  return out;
}

export function classifyTxError(err: unknown): TxErrorKind {
  if (!err) return "unknown";
  const links = chain(err);
  const names = links.map((l) => String(l.name ?? ""));
  const codes = links.map((l) => l.code);
  const text = links
    .map((l) => ["shortMessage", "message", "details"].map((k) => (typeof l[k] === "string" ? l[k] : "")).join(" "))
    .join(" | ")
    .toLowerCase();

  // Order matters: a timeout or rejection can mention "fund" in its text.
  if (names.includes("WaitForTransactionReceiptTimeoutError") || text.includes("timed out while waiting for transaction")) {
    return "receipt_timeout";
  }
  if (names.includes("UserRejectedRequestError") || codes.includes(4001) || /user (rejected|denied)/.test(text)) {
    return "user_rejected";
  }
  if (isInsufficientGasError(err)) return "insufficient_funds";
  if (names.includes("ContractFunctionRevertedError") || names.includes("ContractFunctionExecutionError") || text.includes("execution reverted")) {
    return "reverted";
  }
  if (
    err instanceof GasPlanRpcError ||
    names.some((n) => ["HttpRequestError", "TimeoutError", "RpcRequestError", "InternalRpcError", "LimitExceededRpcError"].includes(n)) ||
    /fetch failed|failed to fetch|network error|econnreset|timeout/.test(text)
  ) {
    return "rpc_unavailable";
  }
  return "unknown";
}
