import { GAME2048_ABI } from "./abi";
import { GAME2048_V6_FUNCTIONS, GAME2048_V6_EVENTS } from "./abiV6";

// Merge V5 + V6 ABIs for complete contract interface
export const GAME2048_MERGED_ABI = [
  ...GAME2048_ABI,
  ...GAME2048_V6_FUNCTIONS,
  ...GAME2048_V6_EVENTS,
] as const;
