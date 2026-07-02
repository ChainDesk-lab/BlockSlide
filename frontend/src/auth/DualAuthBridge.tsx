import { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "./wagmiConfig";
import { UnifiedAuthBridge } from "./UnifiedAuthBridge";
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
          {/* A single bridge provides AuthContext, exposing wallet OR magic
              state based on the selected auth method. This replaces the old
              nested WalletBridge > MagicBridge, where the inner bridge shadowed
              the outer one so wallet connections were never visible to useAuth(). */}
          <UnifiedAuthBridge>{children}</UnifiedAuthBridge>
        </QueryClientProvider>
      </WagmiProvider>
    </AuthSelectionProvider>
  );
}
