import { useAccount } from "wagmi";

/**
 * The chain the connected wallet is actually sitting on, or undefined when no
 * wallet is connected.
 *
 * Do NOT use wagmi's `useChainId()` for wrong-network detection. That returns
 * `config.state.chainId`, and wagmi only syncs that value when the wallet's
 * chain is present in `createConfig({ chains })`:
 *
 *   // @wagmi/core createConfig.js — "Update default chain when connector chain changes"
 *   const isChainConfigured = chains.getState().some((x) => x.id === chainId);
 *   if (!isChainConfigured) return;
 *
 * Our config lists Celo alone, so a wallet on Ethereum leaves `useChainId()`
 * pinned at 42220 and every `chainId !== TARGET_CHAIN.id` check silently reads
 * as "already on the right chain" — the exact case we need to catch.
 *
 * `useAccount().chainId` reads off the connection itself, so it reports the
 * wallet's real chain even when that chain isn't configured.
 */
export function useWalletChainId(): number | undefined {
  return useAccount().chainId;
}
