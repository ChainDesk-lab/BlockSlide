import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export type AuthType = "email" | "wallet";

interface AuthSelectionContextType {
  selectedAuth: AuthType;
  setSelectedAuth: (auth: AuthType) => void;
}

const AuthSelectionContext = createContext<AuthSelectionContextType | undefined>(undefined);

interface AuthSelectionProviderProps {
  children: ReactNode;
  defaultAuth?: AuthType;
}

// Per-tab persistence. A mobile WalletConnect connect sends the user out to
// their wallet app; iOS may reload this tab when they come back. Without this,
// the selection resets to "email" on that reload and the restored wallet
// session is invisible to useAuth(), stranding the user on the sign-in screen.
// sessionStorage (not localStorage) keeps this scoped to the active tab so it
// never leaks into a future unrelated visit.
const STORAGE_KEY = "blockslide.selectedAuth";

function readStoredAuth(): AuthType | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return value === "wallet" || value === "email" ? value : null;
  } catch {
    return null;
  }
}

export function AuthSelectionProvider({ children, defaultAuth = "email" }: AuthSelectionProviderProps) {
  const [selectedAuth, setSelectedAuthState] = useState<AuthType>(defaultAuth);

  // Restore after mount (not via a lazy initializer) to avoid a hydration
  // mismatch between server and client markup.
  useEffect(() => {
    const stored = readStoredAuth();
    if (stored && stored !== selectedAuth) setSelectedAuthState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSelectedAuth = useCallback((auth: AuthType) => {
    setSelectedAuthState(auth);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, auth);
    } catch {
      /* private mode / storage disabled — selection still works for this render */
    }
  }, []);

  return (
    <AuthSelectionContext.Provider value={{ selectedAuth, setSelectedAuth }}>
      {children}
    </AuthSelectionContext.Provider>
  );
}

export function useAuthSelection() {
  const context = useContext(AuthSelectionContext);
  if (!context) {
    throw new Error("useAuthSelection must be used within AuthSelectionProvider");
  }
  return context;
}
