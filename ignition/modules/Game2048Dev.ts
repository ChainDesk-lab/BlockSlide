import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Dev deployment: bundles MockERC20 + MockIdentity so you can test on Celo Sepolia
// without needing a real GoodDollar-verified wallet or treasury funding.
// Do NOT use this in production — use Game2048.ts with real contract addresses.
export default buildModule("Game2048DevModule", (m) => {
  const token    = m.contract("MockERC20");
  const identity = m.contract("MockIdentity");

  // Deploy implementation. The UBI contribution recipient defaults to the
  // deployer on dev networks (mock G$, so nothing real is sent).
  const ubiRecipient = m.getParameter("ubiRecipient", m.getAccount(0));
  const impl = m.contract("Game2048", [ubiRecipient]);

  // Deploy ERC1967Proxy which implements UUPS pattern
  const initData = m.encodeFunctionCall(impl, "initialize", [token, identity]);
  const proxy = m.contract("ERC1967Proxy", [impl, initData]);

  return { token, identity, implementation: impl, proxy };
});
