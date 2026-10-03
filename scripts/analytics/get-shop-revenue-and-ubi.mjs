import { createPublicClient, http, getAddress } from 'viem';
import { celo } from 'viem/chains';

const GAME2048_ADDRESS = getAddress('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6');
const GDOLLAR_ADDRESS = getAddress('0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a');

// Known GoodDollar addresses that might be UBI pool targets
const POTENTIAL_UBI_ADDRESSES = [
  '0xbD57D8e6cbFF270A2c15e19CF91e9fF1B4e37425', // Common GoodDollar UBI address
  '0x8d482c50b9b0d012a7b34ba0aFaCfDd12e8A5c3e', // Alternative
];

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║    GAME SHOP REVENUE & UBI POOL ANALYSIS                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  const latestBlock = await client.getBlockNumber();
  const chunkSize = 4000n;

  // ===== COUNT SHOP PURCHASES =====
  console.log('🛍️  COUNTING SHOP PURCHASES');
  console.log('─'.repeat(70));

  let shieldCount = 0;
  let boost2xCount = 0;
  let boost5xCount = 0;
  let fromBlock = 0n;

  console.log('  Scanning ShieldPurchased events...');
  process.stdout.write('    ');
  while (fromBlock < latestBlock) {
    const toBlock = fromBlock + chunkSize > latestBlock ? latestBlock : fromBlock + chunkSize;

    try {
      const logs = await client.getLogs({
        address: GAME2048_ADDRESS,
        event: {
          type: 'event',
          name: 'ShieldPurchased',
          inputs: [
            { name: 'player', type: 'address', indexed: true },
            { name: 'count', type: 'uint256', indexed: false },
          ],
        },
        fromBlock,
        toBlock,
      });

      shieldCount += logs.length;
      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  console.log('\n  Scanning XpBoostPurchased events...');
  fromBlock = 0n;
  process.stdout.write('    ');
  while (fromBlock < latestBlock) {
    const toBlock = fromBlock + chunkSize > latestBlock ? latestBlock : fromBlock + chunkSize;

    try {
      const logs = await client.getLogs({
        address: GAME2048_ADDRESS,
        event: {
          type: 'event',
          name: 'XpBoostPurchased',
          inputs: [
            { name: 'player', type: 'address', indexed: true },
            { name: 'multiplier', type: 'uint8', indexed: false },
            { name: 'expiry', type: 'uint64', indexed: false },
          ],
        },
        fromBlock,
        toBlock,
      });

      logs.forEach(log => {
        const multiplier = Number(log.args.multiplier);
        if (multiplier === 2) {
          boost2xCount++;
        } else if (multiplier === 5) {
          boost5xCount++;
        }
      });

      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  console.log('\n');

  // Calculate shop revenue
  const SHIELD_PRICE = 500;
  const BOOST_2X_PRICE = 1500;
  const BOOST_5X_PRICE = 4000;

  const shieldRevenue = shieldCount * SHIELD_PRICE;
  const boost2xRevenue = boost2xCount * BOOST_2X_PRICE;
  const boost5xRevenue = boost5xCount * BOOST_5X_PRICE;
  const totalShopRevenue = shieldRevenue + boost2xRevenue + boost5xRevenue;

  console.log(`  Shield Purchases: ${shieldCount} × ${SHIELD_PRICE} G$ = ${shieldRevenue.toLocaleString()} G$`);
  console.log(`  Boost 2x Purchases: ${boost2xCount} × ${BOOST_2X_PRICE} G$ = ${boost2xRevenue.toLocaleString()} G$`);
  console.log(`  Boost 5x Purchases: ${boost5xCount} × ${BOOST_5X_PRICE} G$ = ${boost5xRevenue.toLocaleString()} G$`);
  console.log(`\n  💰 TOTAL SHOP REVENUE: ${totalShopRevenue.toLocaleString()} G$\n`);

  // ===== FIND G$ TRANSFERS TO UBI POOL =====
  console.log('💳 SCANNING: G$ TRANSFERS FROM GAME2048 TO UBI POOL');
  console.log('─'.repeat(70));

  // Query G$ contract for Transfer events FROM Game2048 contract
  console.log('  Looking for Transfer events on G$ token contract...');
  console.log(`  From: ${GAME2048_ADDRESS}`);
  console.log(`  To: [scanning for UBI pool addresses]`);
  console.log('  Token: ' + GDOLLAR_ADDRESS + '\n');

  fromBlock = 0n;
  let ubiTransfers = [];

  process.stdout.write('    Scanning transfers: ');
  while (fromBlock < latestBlock) {
    const toBlock = fromBlock + chunkSize > latestBlock ? latestBlock : fromBlock + chunkSize;

    try {
      const logs = await client.getLogs({
        address: GDOLLAR_ADDRESS,
        event: {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'value', type: 'uint256', indexed: false },
          ],
        },
        fromBlock,
        toBlock,
      });

      // Filter for transfers FROM Game2048
      logs.forEach(log => {
        if (log.args.from.toLowerCase() === GAME2048_ADDRESS.toLowerCase()) {
          ubiTransfers.push({
            to: log.args.to.toLowerCase(),
            amount: BigInt(log.args.value),
            blockNumber: Number(log.blockNumber),
          });
        }
      });

      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  console.log('\n');

  if (ubiTransfers.length === 0) {
    console.log('  ⚠️  No Transfer events found FROM Game2048 contract');
    console.log('  This could mean:');
    console.log('    1. UBI funds are not transferred out (held in contract)');
    console.log('    2. Transfers use a different mechanism (contract method)');
    console.log('    3. No UBI funding has been sent yet\n');

    console.log('  Query the contract state directly to check balance:\n');
    console.log(`    balanceOf(${GAME2048_ADDRESS}) on ${GDOLLAR_ADDRESS}\n`);
  } else {
    // Group transfers by recipient
    const byRecipient = {};
    ubiTransfers.forEach(t => {
      if (!byRecipient[t.to]) {
        byRecipient[t.to] = { count: 0, totalWei: 0n };
      }
      byRecipient[t.to].count++;
      byRecipient[t.to].totalWei += t.amount;
    });

    console.log(`  Found ${ubiTransfers.length} transfers FROM Game2048:\n`);

    let totalToUbiWei = 0n;
    Object.keys(byRecipient).forEach(address => {
      const { count, totalWei } = byRecipient[address];
      const amountG = Number(totalWei) / 1e18;
      console.log(`    To ${address}:`);
      console.log(`      ${count} transfers, ${amountG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$ total`);

      // Check if this looks like a UBI pool address
      if (POTENTIAL_UBI_ADDRESSES.includes(address)) {
        console.log(`      ✓ Recognized GoodDollar UBI address`);
      }
      totalToUbiWei += totalWei;
    });

    console.log(`\n  💰 TOTAL SENT OUT: ${(Number(totalToUbiWei) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 })} G$\n`);
  }

  // ===== SUMMARY =====
  console.log('═'.repeat(70));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(70));
  console.log(`\n🛍️  Game Shop Revenue:  ${totalShopRevenue.toLocaleString()} G$`);
  console.log(`   ├─ Shields:  ${shieldRevenue.toLocaleString()} G$ (${shieldCount} purchases)`);
  console.log(`   ├─ Boosts 2x: ${boost2xRevenue.toLocaleString()} G$ (${boost2xCount} purchases)`);
  console.log(`   └─ Boosts 5x: ${boost5xRevenue.toLocaleString()} G$ (${boost5xCount} purchases)`);

  console.log('\n💳 UBI Pool Funding:    [see above]');
  console.log('═'.repeat(70) + '\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
