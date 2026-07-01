import { createContext, useContext, useState, ReactNode } from "react";

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

export function AuthSelectionProvider({ children, defaultAuth = "email" }: AuthSelectionProviderProps) {
  const [selectedAuth, setSelectedAuth] = useState<AuthType>(defaultAuth);

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
