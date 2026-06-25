// Detects "wallet can't afford gas" failures from viem/RPC errors so the UI can
// show the Gas-needed modal instead of a cryptic message. Email/social-login
// wallets start with 0 CELO, so every on-chain write fails this way until funded.

export function isInsufficientGasError(err: unknown): boolean {
  if (!err) return false;

  // Walk the cause chain — viem nests the original RPC error under `.cause`.
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; i < 8 && e; i++) {
    if (typeof e === "string") {
      parts.push(e);
    } else if (typeof e === "object") {
      const o = e as Record<string, unknown>;
      for (const k of ["name", "shortMessage", "details", "message"]) {
        if (typeof o[k] === "string") parts.push(o[k] as string);
      }
    }
    e = (e as { cause?: unknown })?.cause;
  }

  const hay = parts.join(" | ").toLowerCase();
  return (
    hay.includes("insufficient funds") ||
    hay.includes("insufficient balance") ||
    hay.includes("insufficientfunds") ||
    hay.includes("gas required exceeds") ||
    hay.includes("exceeds the balance") ||
    hay.includes("not enough funds") ||
    (hay.includes("-32000") && hay.includes("fund"))
  );
}
