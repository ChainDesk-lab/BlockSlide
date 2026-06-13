import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Dev deployment: bundles MockERC20 + MockIdentity so you can test on Alfajores
// without needing a real GoodDollar-verified wallet or treasury funding.
// Do NOT use this in production — use Game2048.ts with real contract addresses.
export default buildModule("Game2048DevModule", (m) => {
  const token    = m.contract("MockERC20");
  const identity = m.contract("MockIdentity");
  const game     = m.contract("Game2048", [token, identity]);

  return { token, identity, game };
});
