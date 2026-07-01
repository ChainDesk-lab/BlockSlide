import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Proxy deployed by Game2048Module
const PROXY_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

// V4 upgrade:
//   - Corrects startSession() NatSpec comment which incorrectly stated that
//     "Caller must be a GoodDollar-verified human". Verification is only
//     required when calling submitScore() to claim rewards, not for starting
//     a game session. This clarifies the actual contract behavior: anyone can
//     play without verification, but only verified users can claim rewards.
//   - No contract code changes — purely documentation fix for clarity.
export default buildModule("Game2048UpgradeV4Module", (m) => {
  const newImpl = m.contract("Game2048");

  const proxy = m.contractAt("Game2048", PROXY_ADDRESS, { id: "Game2048Proxy" });

  const upgrade = m.call(proxy, "upgradeToAndCall", [newImpl, "0x"], {
    after: [newImpl],
  });

  return { newImpl, upgrade };
});
