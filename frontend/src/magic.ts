import { Magic } from "magic-sdk";

// Magic.link API key from environment
// CRITICAL: This must be set in Vercel Environment Variables (not .env.local)
// For local dev: add to .env.local
// For Vercel: add to Project Settings → Environment Variables
const apiKey = process.env.NEXT_PUBLIC_MAGIC_API_KEY ?? "";

export const isMagicConfigured = apiKey && apiKey.length > 0 && apiKey.startsWith("pk_");

if (typeof window !== "undefined") {
  if (!isMagicConfigured) {
    console.error(
      "❌ NEXT_PUBLIC_MAGIC_API_KEY is not configured. " +
      "For local dev: add to .env.local. " +
      "For Vercel: add to Project Settings → Environment Variables. " +
      "Email login will not work until this is set."
    );
  } else {
    console.info(
      `✅ [Magic.link] Configured for Celo (42220) with key: ${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`
    );
  }
}

// Initialize Magic instance (only on client side)
let magicInstance: Magic | null = null;
let initError: Error | null = null;

export function getMagic(): Magic {
  if (typeof window === "undefined") {
    throw new Error("Magic can only be initialized on client side");
  }

  if (initError) {
    throw initError;
  }

  if (!magicInstance) {
    if (!isMagicConfigured) {
      const error = new Error(
        "Magic.link is not configured. NEXT_PUBLIC_MAGIC_API_KEY env var is missing or invalid. " +
        "Add it to Vercel Project Settings → Environment Variables."
      );
      initError = error;
      throw error;
    }

    try {
      magicInstance = new Magic(apiKey, {
        network: {
          // ankr is more reliable than forno.celo.org for transaction broadcast.
          // Magic signs on its servers then broadcasts via this RPC — forno's
          // rate-limits and intermittent outages cause "network" errors for
          // eth_sendTransaction, which email users see as a false chain error.
          rpcUrl: "https://rpc.ankr.com/celo",
          chainId: 42220,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("Failed to initialize Magic.link:", err);
      initError = err;
      throw err;
    }
  }

  return magicInstance;
}
