import { useAuth as useRawAuth, AuthValue } from "../auth/AuthContext";
import { useAuthSelection } from "../contexts/AuthSelectionContext";

/**
 * Wrapper around useAuth that clears the auth state if it doesn't match
 * the currently selected auth type. Prevents loading states from one
 * auth method persisting when switching to another.
 *
 * Maps between two auth type systems:
 * - selectedAuth: "email" | "wallet" (user's choice in AuthSelectionContext)
 * - authType: "magic" | "minipay" | null (underlying provider in AuthContext)
 */
export function useCleanAuth(): AuthValue {
  const rawAuth = useRawAuth();
  const { selectedAuth } = useAuthSelection();

  // Check if authType matches the selected auth method
  const authMatches =
    (selectedAuth === "email" && rawAuth.authType === "magic") ||
    (selectedAuth === "wallet" && rawAuth.authType === "minipay");

  // If auth type doesn't match selected auth, return neutral state
  // This prevents old loading states from lingering when switching tabs
  if (!authMatches) {
    return {
      isConnected: false,
      address: undefined,
      isReady: true,
      loading: false,
      error: null,
      authType: rawAuth.authType,
      login: async () => {},
      logout: async () => {},
    };
  }

  return rawAuth;
}
