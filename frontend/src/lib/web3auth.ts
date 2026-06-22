// Get Web3Auth Client ID from environment (Vite)
const env = (import.meta as unknown as { env: Record<string, string> }).env;
const web3AuthClientId = env.VITE_WEB3AUTH_CLIENT_ID || "";

if (!web3AuthClientId) {
  console.warn(
    "Web3Auth Client ID not configured. Email login will not be available. " +
    "Set VITE_WEB3AUTH_CLIENT_ID in your .env.local file.",
  );
}

/**
 * Check if Web3Auth is configured
 */
export function isWeb3AuthConfigured(): boolean {
  return !!web3AuthClientId;
}

/**
 * Get Web3Auth Client ID
 */
export function getWeb3AuthClientId(): string {
  return web3AuthClientId || "";
}

