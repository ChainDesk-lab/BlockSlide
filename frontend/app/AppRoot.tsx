"use client";

import { Web3AuthProvider } from "@web3auth/modal/react";
import { WagmiProvider } from "@web3auth/modal/react/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { web3AuthContextConfig } from "../src/web3auth";
import { NoGasProvider } from "../src/contexts/NoGasContext";
import App from "../src/App";

const queryClient = new QueryClient();

export default function AppRoot() {
  return (
    <Web3AuthProvider config={web3AuthContextConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider>
          <NoGasProvider>
            <App />
          </NoGasProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </Web3AuthProvider>
  );
}
