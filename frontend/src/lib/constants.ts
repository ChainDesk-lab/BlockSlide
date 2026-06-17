import { celo } from "viem/chains";

export const TARGET_CHAIN = celo;

// Proxy address — ignition/deployments/chain-42220/deployed_addresses.json
export const GAME2048_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6" as `0x${string}`;

export const CONTRACT_DEPLOYED =
  GAME2048_ADDRESS !== "0x0000000000000000000000000000000000000000";

// GoodDollar contracts on Celo mainnet
// G$ token — verified on CeloScan (ends …2a9c7A). The previous value (…462A4e)
// was a typo with no code on Celo, which broke milestone rewards.
export const G_DOLLAR_ADDRESS = "0x62B8B11039FcfE5aB0C56E502b1C372A3D2a9c7A" as `0x${string}`;
export const IDENTITY_ADDRESS  = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as `0x${string}`;

export const MILESTONES: { tile: number; reward: string }[] = [
  { tile: 256,  reward: "5 G$" },
  { tile: 512,  reward: "15 G$" },
  { tile: 1024, reward: "40 G$" },
  { tile: 2048, reward: "100 G$" },
];
