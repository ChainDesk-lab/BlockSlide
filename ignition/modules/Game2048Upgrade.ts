import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PROXY_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

export default buildModule("Game2048UpgradeModule", (m) => {
  // Deploy the new implementation
  const newImpl = m.contract("Game2048");

  // Reference the existing proxy using the Game2048 ABI (proxy delegates to it)
  const proxy = m.contractAt("Game2048", PROXY_ADDRESS, { id: "Game2048Proxy" });

  // Upgrade — no re-initializer needed, pass empty bytes
  m.call(proxy, "upgradeToAndCall", [newImpl, "0x"], {
    after: [newImpl],
  });

  return { newImpl };
});
