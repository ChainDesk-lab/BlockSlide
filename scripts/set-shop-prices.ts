import { ethers } from 'hardhat';

const GAME2048_ADDRESS = '0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6';

// Prices in wei (18 decimals)
const COSMETIC_PRICES = {
  1: '150000000000000000000', // Tile Skin - 150 G$
  2: '125000000000000000000', // Fits - 125 G$
  3: '100000000000000000000', // Leaderboard Flair - 100 G$
  4: '75000000000000000000',  // Goggles - 75 G$
  5: '50000000000000000000',  // Caps - 50 G$
};

const SHOP_PRICES = {
  shield: '500000000000000000000',    // 500 G$ (V5)
  boost2x: '1500000000000000000000',  // 1500 G$ (V5)
  boost5x: '4000000000000000000000',  // 4000 G$ (V5)
  undo: '100000000000000000000',      // 100 G$ (V6)
};

async function main() {
  const signers = await ethers.getSigners();
  if (!signers.length) {
    console.error('❌ No signers available. Make sure your wallet is configured.');
    process.exit(1);
  }
  const signer = signers[0];
  const signerAddr = await signer.getAddress();

  console.log('\n📋 Transaction Sender:', signerAddr);

  // Load contract (ethers will auto-detect ABI from bytecode)
  // We only need the functions we're calling, so we can specify them directly
  const gameAbi = [
    'function owner() view returns (address)',
    'function shieldPrice() view returns (uint256)',
    'function boost2xPrice() view returns (uint256)',
    'function boost5xPrice() view returns (uint256)',
    'function undoPrice() view returns (uint256)',
    'function cosmeticCatalog(uint256) view returns (uint256 price, bool exists)',
    'function setShopPrices(uint256,uint256,uint256,uint256)',
    'function setCosmeticPrice(uint256,uint256)',
  ];

  // Get contract instance
  const game = new ethers.Contract(GAME2048_ADDRESS, gameAbi, signer);

  // Check if signer is owner
  const owner = await game.owner();
  console.log('📍 Contract Owner:', owner);

  if (signerAddr.toLowerCase() !== owner.toLowerCase()) {
    console.error('\n❌ ERROR: Connected signer is NOT the owner!');
    console.error(`   Connected: ${signerAddr}`);
    console.error(`   Owner:     ${owner}`);
    process.exit(1);
  }

  console.log('✅ Signer is owner\n');

  // Set shop prices (includes undo price)
  console.log('📤 Setting shop prices...');
  console.log(`  Shield:      ${ethers.formatUnits(SHOP_PRICES.shield, 18)} G$`);
  console.log(`  Boost 2x:    ${ethers.formatUnits(SHOP_PRICES.boost2x, 18)} G$`);
  console.log(`  Boost 5x:    ${ethers.formatUnits(SHOP_PRICES.boost5x, 18)} G$`);
  console.log(`  Undo Step:   ${ethers.formatUnits(SHOP_PRICES.undo, 18)} G$`);

  const setShopTx = await game.setShopPrices(
    SHOP_PRICES.shield,
    SHOP_PRICES.boost2x,
    SHOP_PRICES.boost5x,
    SHOP_PRICES.undo
  );
  console.log(`  Tx: ${setShopTx.hash}`);
  await setShopTx.wait();
  console.log('  ✅ Confirmed\n');

  // Set cosmetic prices
  console.log('📤 Setting cosmetic prices...');
  for (const [itemId, price] of Object.entries(COSMETIC_PRICES)) {
    const cosmetics = ['', 'Tile Skin', 'Fits', 'Leaderboard Flair', 'Goggles', 'Caps'];
    const name = cosmetics[parseInt(itemId)];
    console.log(`  ${itemId}. ${name}: ${ethers.formatUnits(price, 18)} G$`);

    const tx = await game.setCosmeticPrice(itemId, price);
    console.log(`     Tx: ${tx.hash}`);
    await tx.wait();
    console.log(`     ✅`);
  }

  console.log('\n✅ All prices set! Verifying...\n');

  // Verify all prices were set correctly
  console.log('📖 Reading prices back from contract:\n');

  const shieldPrice = await game.shieldPrice();
  const boost2xPrice = await game.boost2xPrice();
  const boost5xPrice = await game.boost5xPrice();
  const undoPrice = await game.undoPrice();

  console.log('Shop Prices:');
  console.log(`  Shield:      ${ethers.formatUnits(shieldPrice, 18)} G$ ${shieldPrice.toString() === SHOP_PRICES.shield ? '✅' : '❌'}`);
  console.log(`  Boost 2x:    ${ethers.formatUnits(boost2xPrice, 18)} G$ ${boost2xPrice.toString() === SHOP_PRICES.boost2x ? '✅' : '❌'}`);
  console.log(`  Boost 5x:    ${ethers.formatUnits(boost5xPrice, 18)} G$ ${boost5xPrice.toString() === SHOP_PRICES.boost5x ? '✅' : '❌'}`);
  console.log(`  Undo Step:   ${ethers.formatUnits(undoPrice, 18)} G$ ${undoPrice.toString() === SHOP_PRICES.undo ? '✅' : '❌'}`);

  console.log('\nCosmetic Prices:');
  for (const [itemId, expectedPrice] of Object.entries(COSMETIC_PRICES)) {
    const cosmetics = ['', 'Tile Skin', 'Fits', 'Leaderboard Flair', 'Goggles', 'Caps'];
    const name = cosmetics[parseInt(itemId)];
    const [price, exists] = await game.cosmeticCatalog(itemId);
    const isCorrect = price.toString() === expectedPrice && exists;
    console.log(`  ${itemId}. ${name}: ${ethers.formatUnits(price, 18)} G$ ${isCorrect ? '✅' : '❌'}`);
  }

  console.log('\n✅ All prices verified!\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
