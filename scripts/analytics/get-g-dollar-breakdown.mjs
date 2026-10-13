import { createPublicClient, http, getAddress } from 'viem';
import { celo } from 'viem/chains';

const GAME2048_ADDRESS = getAddress('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6');

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║        G$ VOLUME BREAKDOWN — DETAILED ANALYSIS                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  const latestBlock = await client.getBlockNumber();
  const chunkSize = 4000n;

  // ===== METRIC 1: fundTreasury (donations into UBI pool) =====
  console.log('📊 QUERYING: G$ Donations to UBI Pool (fundTreasury)');
  console.log('─'.repeat(70));

  let totalDonatedWei = 0n;
  let donationCount = 0;
  let fromBlock = 0n;

  process.stdout.write('  Scanning... ');
  while (fromBlock < latestBlock) {
    const toBlock = fromBlock + chunkSize > latestBlock ? latestBlock : fromBlock + chunkSize;

    try {
      const logs = await client.getLogs({
        address: GAME2048_ADDRESS,
        event: {
          type: 'event',
          name: 'TokensUpdated',
          inputs: [
            { name: 'gDollar', type: 'address', indexed: false },
            { name: 'identity', type: 'address', indexed: false },
          ],
        },
        fromBlock,
        toBlock,
      });

      donationCount += logs.length;
      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  // Try to get fundTreasury events (need the right signature)
  console.log('\n  Searching for fundTreasury events...');

  fromBlock = 0n;
  process.stdout.write('  Scanning fundTreasury... ');

  try {
    while (fromBlock < latestBlock) {
      const toBlock = fromBlock + chunkSize > latestBlock ? latestBlock : fromBlock + chunkSize;

      try {
        // Generic event query without specific parameters
        const logs = await client.getLogs({
          address: GAME2048_ADDRESS,
          fromBlock,
          toBlock,
        });

        // Filter for fundTreasury calls (look for 0xfundTreasury signature)
        // This is a fallback - we'll examine all events
        logs.forEach(log => {
          // fundTreasury would have a specific topic/signature
          if (log.topics[0]) {
            // You can check if this is fundTreasury by the signature
          }
        });

        const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
        process.stdout.write(`${pct}%... `);

        fromBlock = toBlock + 1n;
      } catch (err) {
        fromBlock = toBlock + 1n;
      }
    }
  } catch (err) {
    console.log(`\n  Error: ${err.message}`);
  }

  // ===== METRIC 2: ShieldPurchased (shop spending) =====
  console.log('\n\n💰 QUERYING: G$ Shop Spending (ShieldPurchased)');
  console.log('─'.repeat(70));

  let totalShieldWei = 0n;
  let shieldCount = 0;
  fromBlock = 0n;

  process.stdout.write('  Scanning... ');
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

  console.log(`\n  Result: ${shieldCount} ShieldPurchased events`);

  // ===== METRIC 3: XpBoostPurchased (shop spending) =====
  console.log('\n💰 QUERYING: G$ Shop Spending (XpBoostPurchased)');
  console.log('─'.repeat(70));

  let totalBoostWei = 0n;
  let boostCount = 0;
  fromBlock = 0n;

  process.stdout.write('  Scanning... ');
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

      boostCount += logs.length;
      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  console.log(`\n  Result: ${boostCount} XpBoostPurchased events`);

  // ===== METRIC 4: Verify ScoreSubmitted count and unique sessions =====
  console.log('\n\n🎮 VERIFYING: Game Sessions & Score Submissions');
  console.log('─'.repeat(70));

  let totalScoresWei = 0n;
  let totalScores = 0;
  let uniquePlayers = new Set();
  fromBlock = 0n;

  process.stdout.write('  Scanning... ');
  while (fromBlock < latestBlock) {
    const toBlock = fromBlock + chunkSize > latestBlock ? latestBlock : fromBlock + chunkSize;

    try {
      const logs = await client.getLogs({
        address: GAME2048_ADDRESS,
        event: {
          type: 'event',
          name: 'ScoreSubmitted',
          inputs: [
            { name: 'player', type: 'address', indexed: true },
            { name: 'score', type: 'uint256', indexed: false },
            { name: 'highestTile', type: 'uint32', indexed: false },
          ],
        },
        fromBlock,
        toBlock,
      });

      logs.forEach(log => {
        totalScores += 1;
        uniquePlayers.add(log.args.player.toLowerCase());
      });

      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  console.log(`\n  Total ScoreSubmitted events: ${totalScores}`);
  console.log(`  Unique players with scores: ${uniquePlayers.size}`);

  // ===== SUMMARY =====
  console.log('\n' + '═'.repeat(70));
  console.log('📋 SUMMARY');
  console.log('═'.repeat(70));
  console.log('\n🎮 GAME SESSIONS:');
  console.log(`  ├─ Total score submissions: ${totalScores}`);
  console.log(`  └─ Unique players: ${uniquePlayers.size}`);
  console.log('\n💰 G$ VOLUME BREAKDOWN:');
  console.log(`  ├─ Shop Shields (ShieldPurchased): ${shieldCount} purchases`);
  console.log(`  ├─ Shop XP Boosts (XpBoostPurchased): ${boostCount} purchases`);
  console.log(`  ├─ Total Shop Transactions: ${shieldCount + boostCount}`);
  console.log(`  └─ UBI Pool Donations (fundTreasury): [requires manual query - see below]`);
  console.log('\n' + '═'.repeat(70) + '\n');

  console.log('📝 NOTE: To get exact G$ amounts spent on shop:');
  console.log('  Need to query ShieldPrice and Boost2xPrice/Boost5xPrice from contract');
  console.log('  Then calculate: (shieldCount × shieldPrice) + (boostCount × boostPrice)\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
