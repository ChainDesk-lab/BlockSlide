import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PROXY_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

// V5 upgrade: allow playing without verification, require it only for claiming.
//   - Remove identity check from startSession so anyone can start a game
//   - Add identity check to submitScore so only verified users can claim rewards
// This allows unverified players to play on-chain without blocking on verification.
export default buildModule("Game2048UpgradeV5Module", (m) => {
  const newImpl = m.contract("Game2048");

  const proxy = m.contractAt("Game2048", PROXY_ADDRESS, { id: "Game2048Proxy" });

  m.call(proxy, "upgradeToAndCall", [newImpl, "0x"], {
    after: [newImpl],
  });

  return { newImpl };
});
