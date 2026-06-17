import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Proxy deployed by Game2048Module
const PROXY_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

// Upgrades the proxy to the current Game2048 implementation, which adds:
//   - Shop (buyStreakShield, buyXpBoost, setShopPrices)
//   - XP system (xp, streakCount, shieldCount mappings)
//   - 5-argument submitScore (score, highestTile, moveCount, seed, comboMoves)
export default buildModule("Game2048UpgradeV2Module", (m) => {
  const newImpl = m.contract("Game2048");

  const proxy = m.contractAt("Game2048", PROXY_ADDRESS, { id: "Game2048Proxy" });

  m.call(proxy, "upgradeToAndCall", [newImpl, "0x"], {
    after: [newImpl],
  });

  return { newImpl };
});
