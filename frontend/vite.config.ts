import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: [
      "@noble/hashes",
      "@noble/curves",
      "@walletconnect/utils",
      "@walletconnect/ethereum-provider",
      "@reown/appkit",
      "viem",
    ],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      external: ["unstorage"],
    },
  },
});
