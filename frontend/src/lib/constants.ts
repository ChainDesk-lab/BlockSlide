import { celo } from "viem/chains";
import { getAddress } from "viem";

export const TARGET_CHAIN = celo;

// Proxy address — ignition/deployments/chain-42220/deployed_addresses.json
export const GAME2048_ADDRESS = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");

export const CONTRACT_DEPLOYED =
  GAME2048_ADDRESS !== "0x0000000000000000000000000000000000000000";

// GoodDollar contracts on Celo mainnet — G$ token (used by the shop) and the
// identity registry. Addresses must use proper EIP-55 checksum for viem validation.
export const G_DOLLAR_ADDRESS = getAddress("0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a");
export const IDENTITY_ADDRESS = getAddress("0xc361a6e67822a0edc17d899227dd9fc50bd62f42");

// Treasury/funding wallet used to auto-fund new Magic.link wallets with CELO for gas.
// The private key for this wallet is stored in FUNDING_WALLET_PRIVATE_KEY env var.
export const FUNDING_WALLET_ADDRESS = getAddress("0xcb6f72152db12546b21ef0dd5f614ca532531838");
