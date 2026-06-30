import { Magic } from "magic-sdk";

// Magic.link API key from environment
const apiKey = process.env.NEXT_PUBLIC_MAGIC_API_KEY ?? "";

export const isMagicConfigured = apiKey.length > 0;

if (!isMagicConfigured && typeof window !== "undefined") {
  console.warn(
    "NEXT_PUBLIC_MAGIC_API_KEY is not set — email login will not work until it is configured."
  );
}

// Initialize Magic instance (only on client side)
let magicInstance: Magic | null = null;

export function getMagic(): Magic {
  if (typeof window === "undefined") {
    throw new Error("Magic can only be initialized on client side");
  }

  if (!magicInstance) {
    magicInstance = new Magic(apiKey, {
      network: {
        rpcUrl: "https://forno.celo.org",
        chainId: 42220,
      },
    });
  }

  return magicInstance;
}

if (typeof window !== "undefined" && isMagicConfigured) {
  console.info(
    `[Magic] API Key: ${apiKey.slice(0, 8)}…${apiKey.slice(-4)} network: Celo (42220)`
  );
}
