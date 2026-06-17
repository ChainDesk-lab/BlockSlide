import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Proxy deployed by Game2048Module
const PROXY_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

// Correct GoodDollar addresses on Celo mainnet.
// The original initialize() committed a typo'd G$ address (…462A4e) that has
// NO code on Celo, which made the milestone reward path in submitScore revert.
const CORRECT_GDOLLAR  = "0x62B8B11039FcfE5aB0C56E502b1C372A3D2a9c7A";
const IDENTITY_ADDRESS = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";

// V3 upgrade:
//   - _sendReward is now defensive (try/catch) so a broken/empty G$ token can
//     never revert score submission.
//   - Adds setTokens() owner setter, called here to fix the bad G$ address.
export default buildModule("Game2048UpgradeV3Module", (m) => {
  const newImpl = m.contract("Game2048");

  const proxy = m.contractAt("Game2048", PROXY_ADDRESS, { id: "Game2048Proxy" });

  const upgrade = m.call(proxy, "upgradeToAndCall", [newImpl, "0x"], {
    after: [newImpl],
  });

  // Point the contract at the correct G$ token address.
  m.call(proxy, "setTokens", [CORRECT_GDOLLAR, IDENTITY_ADDRESS], {
    after: [upgrade],
  });

  return { newImpl };
});
