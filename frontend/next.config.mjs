/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No ESLint config ships with this project; don't fail the build on it.
  eslint: { ignoreDuringBuilds: true },
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
