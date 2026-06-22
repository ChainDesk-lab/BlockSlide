import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { PrivyProvider } from "@privy-io/react-auth";
import { celo, celoAlfajores } from "viem/chains";
import { wagmiConfig } from "./wagmi";
import App from "./App";
import "./index.css";

const env = (import.meta as unknown as { env: Record<string, string> }).env;
const privyAppId = env.VITE_PRIVY_APP_ID;

if (!privyAppId) {
  console.warn("VITE_PRIVY_APP_ID is not set in environment variables");
}

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
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
        supportedChains: [celo, celoAlfajores],
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
  </React.StrictMode>,
);
