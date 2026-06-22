import { useState, useCallback, useRef } from "react";
import { isWeb3AuthConfigured, getWeb3AuthClientId } from "../lib/web3auth";

interface Web3AuthHookResult {
  login: () => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
  error: Error | null;
  isAvailable: boolean;
}

/**
 * Hook for Web3Auth email login integration
 * Opens Web3Auth modal and returns the authenticated provider
 */
export function useWeb3Auth(): Web3AuthHookResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isAvailable] = useState(() => isWeb3AuthConfigured());
  const web3authRef = useRef<any>(null);

  const initWeb3Auth = useCallback(async () => {
    if (web3authRef.current) {
      return web3authRef.current;
    }

    try {
      const { Web3Auth } = await import("@web3auth/modal");
      const clientId = getWeb3AuthClientId();

      if (!clientId) {
        throw new Error("Web3Auth Client ID not configured");
      }

      const web3auth = new Web3Auth({
        clientId,
        chainConfig: {
          chainNamespace: "eip155",
          chainId: "0xa4ec",
          rpcTarget: "https://forno.celo.org",
          blockExplorer: "https://celoscan.io",
          ticker: "CELO",
          tickerDecimals: 18,
          displayName: "Celo",
        },
        uiConfig: {
          appName: "BlockSlide",
          loginGridCol: 3,
        },
        web3AuthNetwork: "cyan",
      } as any);

      web3authRef.current = web3auth;
      return web3auth;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to initialize Web3Auth: ${message}`);
    }
  }, []);

  const login = useCallback(async () => {
    if (!isAvailable) {
      const err = new Error(
        "Email login is not configured. Please set VITE_WEB3AUTH_CLIENT_ID in your .env.local file.",
      );
      setError(err);
      throw err;
    }

    try {
      setIsLoading(true);
      setError(null);

      const web3auth = await initWeb3Auth();

      // Connect using Web3Auth modal
      // This opens the email/social login interface
      const web3authProvider = await web3auth.connect();

      if (!web3authProvider) {
        throw new Error("Failed to get provider from Web3Auth");
      }

      // After successful authentication, the user's embedded wallet is ready
      // The address will be available through wagmi's useAccount() hook
      // because we'll inject it into the window.ethereum provider
      window.ethereum = web3authProvider as any;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const friendlyMessage =
        message.includes("User rejected") || message.includes("cancelled")
          ? "Email login was cancelled"
          : message.includes("not configured")
            ? "Email login is not configured"
            : message || "Failed to start email login";

      const error = new Error(friendlyMessage);
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [isAvailable, initWeb3Auth]);

  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      if (web3authRef.current) {
        await web3authRef.current.logout();
        web3authRef.current = null;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    login,
    logout,
    isLoading,
    error,
    isAvailable,
  };
}

/**
 * Alternative hook that returns a simple login function
 * Useful when you just need to trigger email login without the full state
 */
export function useWeb3AuthLogin() {
  const { login, isLoading, isAvailable } = useWeb3Auth();

  return {
    login,
    isLoading,
    isAvailable,
  };
}
