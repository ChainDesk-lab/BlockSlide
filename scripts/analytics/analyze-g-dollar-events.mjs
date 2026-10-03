import { createPublicClient, http, getAddress } from 'viem';
import { celo } from 'viem/chains';

const GAME2048_ADDRESS = getAddress('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6');
const GDOLLAR_ADDRESS = getAddress('0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a');

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║       G$ FLOW ANALYSIS — Finding Actual Amounts                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  console.log('📊 ANALYZING: RewardPaid Event Details');
  console.log('─'.repeat(70));

  const latestBlock = await client.getBlockNumber();
  const chunkSize = 4000n;

  let allRewards = [];
  let fromBlock = 0n;

  process.stdout.write('  Scanning RewardPaid events... ');
  while (fromBlock < latestBlock) {
    const toBlock = fromBlock + chunkSize > latestBlock ? latestBlock : fromBlock + chunkSize;

    try {
      const logs = await client.getLogs({
        address: GAME2048_ADDRESS,
        event: {
          type: 'event',
          name: 'RewardPaid',
          inputs: [
            { name: 'player', type: 'address', indexed: true },
            { name: 'milestone', type: 'uint32', indexed: false },
            { name: 'amount', type: 'uint256', indexed: false },
          ],
        },
        fromBlock,
        toBlock,
      });

      logs.forEach(log => {
        allRewards.push({
          player: log.args.player,
          milestone: Number(log.args.milestone),
          amount: BigInt(log.args.amount),
          blockNumber: Number(log.blockNumber),
        });
      });

      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  console.log('✓\n');

  // Analyze rewards
  console.log(`  Total RewardPaid events: ${allRewards.length}`);

  const totalRewardWei = allRewards.reduce((sum, r) => sum + r.amount, 0n);
  const totalRewardG = Number(totalRewardWei) / 1e18;

  console.log(`  Total amount distributed: ${totalRewardG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`);

  // Group by milestone
  const byMilestone = {};
  allRewards.forEach(r => {
    if (!byMilestone[r.milestone]) {
      byMilestone[r.milestone] = { count: 0, totalWei: 0n };
    }
    byMilestone[r.milestone].count++;
    byMilestone[r.milestone].totalWei += r.amount;
  });

  console.log('\n  Breakdown by milestone:');
  Object.keys(byMilestone)
    .sort((a, b) => Number(a) - Number(b))
    .forEach(milestone => {
      const { count, totalWei } = byMilestone[milestone];
      const amountG = Number(totalWei) / 1e18;
      const perReward = Number(totalWei) / count / 1e18;
      console.log(`    Milestone ${milestone}: ${count} rewards × ${perReward.toFixed(2)} G$ = ${amountG.toFixed(2)} G$ total`);
    });

  // ===== Now check ShieldPurchased events =====
  console.log('\n\n💰 ANALYZING: Shop Events (ShieldPurchased, XpBoostPurchased)');
  console.log('─'.repeat(70));

  let shieldPurchases = [];
  let boost2xPurchases = [];
  let boost5xPurchases = [];

  fromBlock = 0n;

  // Shield Purchases
  process.stdout.write('  Scanning ShieldPurchased... ');
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

      logs.forEach(log => {
        shieldPurchases.push({
          player: log.args.player,
          count: Number(log.args.count),
        });
      });

      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      if (pct % 20 === 0) process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  console.log('✓');

  // XP Boost Purchases (need to distinguish 2x and 5x)
  console.log('  Scanning XpBoostPurchased... ');
  fromBlock = 0n;

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
          boost2xPurchases.push({ player: log.args.player });
        } else if (multiplier === 5) {
          boost5xPurchases.push({ player: log.args.player });
        }
      });

      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      if (pct % 20 === 0) process.stdout.write(`    ${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  console.log('✓\n');

  // Calculate shop spending
  const SHIELD_PRICE = 500n; // 500 G$
  const BOOST_2X_PRICE = 1500n; // 1500 G$
  const BOOST_5X_PRICE = 4000n; // 4000 G$

  const shieldTotalWei = BigInt(shieldPurchases.length) * SHIELD_PRICE * 10n ** 18n;
  const boost2xTotalWei = BigInt(boost2xPurchases.length) * BOOST_2X_PRICE * 10n ** 18n;
  const boost5xTotalWei = BigInt(boost5xPurchases.length) * BOOST_5X_PRICE * 10n ** 18n;

  const shieldSpendG = Number(shieldTotalWei) / 1e18;
  const boost2xSpendG = Number(boost2xTotalWei) / 1e18;
  const boost5xSpendG = Number(boost5xTotalWei) / 1e18;
  const totalShopSpendG = shieldSpendG + boost2xSpendG + boost5xSpendG;

  console.log(`  ShieldPurchased events: ${shieldPurchases.length} purchases`);
  console.log(`    → ${shieldSpendG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$ spent (${shieldPurchases.length} × 500 G$)\n`);

  console.log(`  XpBoostPurchased (2x) events: ${boost2xPurchases.length} purchases`);
  console.log(`    → ${boost2xSpendG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$ spent (${boost2xPurchases.length} × 1500 G$)\n`);

  console.log(`  XpBoostPurchased (5x) events: ${boost5xPurchases.length} purchases`);
  console.log(`    → ${boost5xSpendG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$ spent (${boost5xPurchases.length} × 4000 G$)\n`);

  console.log(`  TOTAL SHOP SPENDING: ${totalShopSpendG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`);

  // ===== SUMMARY =====
  console.log('\n' + '═'.repeat(70));
  console.log('📋 G$ VOLUME SUMMARY');
  console.log('═'.repeat(70));
  console.log(`\nReward Payouts:      ${totalRewardG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$ (from RewardPaid events)`);
  console.log(`Shop Spending:       ${totalShopSpendG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$ (shields + boosts)`);
  console.log(`  ├─ Shields:        ${shieldSpendG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`);
  console.log(`  ├─ Boost 2x:       ${boost2xSpendG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`);
  console.log(`  └─ Boost 5x:       ${boost5xSpendG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`);
  console.log(`\nCOMBINED VOLUME:     ${(totalRewardG + totalShopSpendG).toLocaleString(undefined, { maximumFractionDigits: 2 })} G$ (rewards + shop)`);
  console.log('\n(NOTE: UBI Pool donations still need to be queried separately)');
  console.log('═'.repeat(70) + '\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
