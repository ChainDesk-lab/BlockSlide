import { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "./wagmiConfig";
import { MagicBridge } from "./MagicBridge";
import { WalletBridge } from "./WalletBridge";
import { AuthSelectionProvider } from "../contexts/AuthSelectionContext";

const queryClient = new QueryClient();

interface DualAuthBridgeProps {
  children: ReactNode;
}

export function DualAuthBridge({ children }: DualAuthBridgeProps) {
  return (
    <AuthSelectionProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {/* Both auth bridges provide AuthContext so components can use useAuth()
              regardless of which auth method is selected. useCleanAuth() filters
              to use only the selected provider. */}
          <WalletBridge>
            <MagicBridge>
              {children}
            </MagicBridge>
          </WalletBridge>
        </QueryClientProvider>
      </WagmiProvider>
    </AuthSelectionProvider>
  );
}
