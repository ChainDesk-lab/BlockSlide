import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { getAddress } from "viem";

/**
 * Deploys the Game2048 implementation that sends 5% of every paid shop
 * purchase to the GoodDollar UBIScheme. DEPLOY ONLY — it does not upgrade the
 * proxy. The upgrade (upgradeToAndCall(impl, "0x")) must be proposed by the
 * contract owner after review, ideally from the multisig that ownership is
 * being moved to.
 *
 * ubiRecipient is baked into the implementation as an immutable; it can only
 * change through another reviewed upgrade. Default: GoodDollar's production
 * UBIScheme on Celo — the same recipient GoodDollar's own GoodCollective
 * factories pay their 500 bps protocol fee to.
 *
 * Before running: re-run scripts/checks/rehearse-ubi-contribution.ts at the
 * current block, and build with the production profile:
 *   npx hardhat ignition deploy ./ignition/modules/Game2048UbiContributionImpl.ts \
 *     --network celo --build-profile production
 * Storage layout is unchanged from the live implementation (no new state).
 */
const CELO_UBI_SCHEME = getAddress("0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1");

export default buildModule("Game2048UbiContributionImpl", (m) => {
  const ubiRecipient = m.getParameter("ubiRecipient", CELO_UBI_SCHEME);
  const implementation = m.contract("Game2048", [ubiRecipient], { id: "Game2048UbiContribution" });
  return { implementation };
});
