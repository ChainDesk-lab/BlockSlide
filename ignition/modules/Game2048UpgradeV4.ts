import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PROXY_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

// V4 upgrade: adds on-chain usernames.
//   - setUsername(string) — claim/change a display name (3–20 chars, unique,
//     case-insensitive).
//   - usernames(address) / getUsernames(address[]) — read names for the
//     leaderboard.
// Pure storage append + new functions, so no re-initializer is needed.
export default buildModule("Game2048UpgradeV4Module", (m) => {
  const newImpl = m.contract("Game2048");

  const proxy = m.contractAt("Game2048", PROXY_ADDRESS, { id: "Game2048Proxy" });

  m.call(proxy, "upgradeToAndCall", [newImpl, "0x"], {
    after: [newImpl],
  });

  return { newImpl };
});
