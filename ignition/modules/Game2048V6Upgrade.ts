import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { getAddress } from "viem";

/**
 * Game2048 V6 Upgrade Module
 *
 * This module upgrades the existing Game2048 proxy (deployed at GAME2048_ADDRESS)
 * to the V6 implementation.
 *
 * Changes in V6:
 * 1. New shop items: Undo Move (consumable) and Cosmetics (catalog-based)
 * 2. XP boost duration reduced from 24 hours to 5 hours
 * 3. All shop purchase events now emit the G$ amount paid
 * 4. Verification gate removed from score submission (moved to rewards only)
 * 5. Zero-price guards on all shop functions
 * 6. Storage layout preserved; new storage appended at end
 *
 * Pre-requisites:
 * - Existing Game2048 proxy must be at GAME2048_ADDRESS
 * - Deployer must be the proxy owner
 * - No data migration needed (storage layout preserved)
 *
 * Deployment steps:
 * 1. npx hardhat ignition deploy ./ignition/modules/Game2048V6Upgrade.ts --network celo
 * 2. Verify the transaction hash and check that proxy's implementation has changed
 * 3. Test new functions on testnet before mainnet deployment
 */

const GAME2048_ADDRESS = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");

export default buildModule("Game2048V6Upgrade", (m) => {
  // Deploy the V6 implementation
  const game2048V6 = m.contract("Game2048V6");

  // Upgrade the proxy to V6
  // This calls the proxy's upgradeToAndCall function (from UUPSUpgradeable)
  const upgradeCall = m.call(GAME2048_ADDRESS, "upgradeToAndCall", [
    game2048V6,
    "0x", // empty calldata — no initialization needed, just upgrade
  ]);

  return { game2048V6, upgradeCall };
});

/**
 * After deployment, verify the upgrade:
 *
 * 1. Check implementation changed:
 *    cast storage 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 0x360894a13ba1a3210667c828492db98dca3e2848cc3735a19cf27b5a7b407340 --rpc-url <celo-rpc>
 *    Should show the address of the new Game2048V6 implementation.
 *
 * 2. Call new V6 functions to confirm upgrade:
 *    cast call 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 "BOOST_DURATION_V6()" --rpc-url <celo-rpc>
 *    Should return: 18000 (5 hours in seconds)
 *
 * 3. Test setting undo price:
 *    cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
 *      "setShopPrices(uint256,uint256,uint256,uint256)" \
 *      25000000000000000000 50000000000000000000 125000000000000000000 40000000000000000000 \
 *      --from <owner> --rpc-url <celo-rpc>
 *
 * 4. Test cosmetics:
 *    cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
 *      "setCosmeticPrice(uint256,uint256)" 1 100000000000000000000 \
 *      --from <owner> --rpc-url <celo-rpc>
 *
 * Storage Layout Verification (Critical):
 * The V6 implementation preserves all V5 storage layout:
 * - V5 state vars: gDollar, identity, sessions, bestScore, bestTile, claimedMilestones, xp, streakCount, lastPlayTimestamp, shieldCount, xpBoost, shieldPrice, boost2xPrice, boost5xPrice, usernames, nameOwner, _nameKey, referrerOf, referralCount
 * - V6 new vars (appended at end): undoCredits, undoPrice, cosmeticCatalog, cosmeticsOwned
 *
 * This is safe because UUPS doesn't care about added storage at the end, only about
 * existing storage layout preservation (which is verified in tests).
 */
