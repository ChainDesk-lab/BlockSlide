/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No ESLint config ships with this project; don't fail the build on it.
  eslint: { ignoreDuringBuilds: true },
  // Web3Auth's email/social login opens a popup and polls `popup.closed` to
  // detect completion. Under a restrictive COOP the opener loses access to the
  // popup and the flow hangs ("silent login loop"). `same-origin-allow-popups`
  // is Web3Auth's recommended setting — it keeps the opener↔popup link intact.
  // We deliberately do NOT set Cross-Origin-Embedder-Policy: enabling COEP would
  // require CORP headers on every cross-origin asset and break image/RPC loads.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Optional transitive deps of WalletConnect/wagmi that aren't needed in the
    // browser bundle — mark external to silence "module not found" warnings.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // Optional Privy integrations (fiat onramp, Farcaster/Solana mini-apps) that
    // are lazily loaded and not installed. Vite auto-externalized these; webpack
    // is stricter, so resolve them to empty modules to match that behavior.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@stripe/crypto": false,
      "@farcaster/mini-app-solana": false,
      // React-Native-only storage referenced by @metamask/sdk; unused in browser.
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
