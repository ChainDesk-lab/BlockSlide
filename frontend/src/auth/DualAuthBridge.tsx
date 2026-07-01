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
          {/* MiniPay bridge with wallet auth */}
          <MiniPayBridge>
            <div style={{ display: "none" }}>
              {children}
            </div>
          </MiniPayBridge>

          {/* Magic bridge with email auth */}
          <MagicBridge>
            {children}
          </MagicBridge>
        </QueryClientProvider>
      </WagmiProvider>
    </AuthSelectionProvider>
  );
}
