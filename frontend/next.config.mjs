/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No ESLint config ships with this project; don't fail the build on it.
  eslint: { ignoreDuringBuilds: true },
  // Allow popups for auth flows that need them. `same-origin-allow-popups`
  // permits authentication popups while keeping opener↔popup links intact.
  // We deliberately do NOT set Cross-Origin-Embedder-Policy: enabling COEP would
  // require CORP headers on every cross-origin asset and break image/RPC loads.
  async headers() {
    return [
      // Static assets: cache indefinitely (Next.js adds content hash to filenames)
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
      // Dynamic content: revalidate on each request to prevent stale builds
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
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
