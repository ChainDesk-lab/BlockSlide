import { celo } from "viem/chains";

export const TARGET_CHAIN = celo;

// Proxy address — ignition/deployments/chain-42220/deployed_addresses.json
export const GAME2048_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6" as `0x${string}`;

export const CONTRACT_DEPLOYED =
  GAME2048_ADDRESS !== "0x0000000000000000000000000000000000000000";

// GoodDollar contracts on Celo mainnet — G$ token (used by the shop) and the
// identity registry. G$ token address verified on CeloScan (ends …2a9c7A).
export const G_DOLLAR_ADDRESS = "0x62B8B11039FcfE5aB0C56E502b1C372A3D2a9c7A" as `0x${string}`;
export const IDENTITY_ADDRESS  = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as `0x${string}`;

// Treasury/funding wallet used to auto-fund new Magic.link wallets with CELO for gas.
// The private key for this wallet is stored in FUNDING_WALLET_PRIVATE_KEY env var.
export const FUNDING_WALLET_ADDRESS = "0xcb6f72152DB12546b21ef0dD5F614Ca532531838" as `0x${string}`;
