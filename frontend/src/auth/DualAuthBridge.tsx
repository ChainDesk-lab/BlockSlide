import { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { miniPayWagmiConfig } from "./miniPayWagmi";
import { MiniPayBridge } from "./MiniPayBridge";
import { MagicBridge } from "./MagicBridge";
import { AuthSelectionProvider } from "../contexts/AuthSelectionContext";

const queryClient = new QueryClient();

interface DualAuthBridgeProps {
  children: ReactNode;
}

export function DualAuthBridge({ children }: DualAuthBridgeProps) {
  return (
    <AuthSelectionProvider>
      <WagmiProvider config={miniPayWagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {/* Nest Magic inside MiniPay so both AuthContexts are available.
              useCleanAuth() handles filtering to the correct one based on selectedAuth. */}
          <MiniPayBridge>
            <MagicBridge>
              {children}
            </MagicBridge>
          </MiniPayBridge>
        </QueryClientProvider>
      </WagmiProvider>
    </AuthSelectionProvider>
  );
}
