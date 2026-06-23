"use client";

import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { PrivyProvider } from "@privy-io/react-auth";
import { celo } from "viem/chains";
import { wagmiConfig } from "../src/wagmi";
import App from "../src/App";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

if (!privyAppId) {
  console.warn("NEXT_PUBLIC_PRIVY_APP_ID is not set in environment variables");
}

const queryClient = new QueryClient();

export default function AppRoot() {
  return (
    <PrivyProvider
      appId={privyAppId || ""}
      config={{
        loginMethods: ["email", "wallet"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        defaultChain: celo,
        supportedChains: [celo],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <RainbowKitProvider
            theme={{
              lightMode: lightTheme({
                accentColor: "#845ef7",
                borderRadius: "medium",
              }),
              darkMode: darkTheme({
                accentColor: "#845ef7",
                borderRadius: "medium",
              }),
            }}
          >
            <App />
          </RainbowKitProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
