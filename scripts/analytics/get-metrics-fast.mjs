import { createPublicClient, http, getAddress } from 'viem';
import { celo } from 'viem/chains';

const GAME2048_ADDRESS = getAddress('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6');
const IDENTITY_ADDRESS = getAddress('0xc361a6e67822a0edc17d899227dd9fc50bd62f42');
const SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cmqr4hmlpe3gy01upecld9jhu/subgraphs/blockslide-leaderboard/2.0.0/gn';

// Bounty period timestamps
const CURRENT_BOUNTY_START = Math.floor(new Date('2026-08-17T11:00:00Z').getTime() / 1000);
const CURRENT_BOUNTY_END = Math.floor(new Date('2026-08-25T11:00:00Z').getTime() / 1000);
const THIRTY_DAYS_AGO = Math.floor(new Date('2026-07-26T00:00:00Z').getTime() / 1000);
const TODAY = Math.floor(new Date('2026-08-25T23:59:59Z').getTime() / 1000);

async function fetchAllPlayers() {
  console.log('\n[FETCHING PLAYERS] Getting all players from subgraph...');
  const players = [];
  let skip = 0;

  while (true) {
    const query = `
      {
        players(first: 1000, skip: ${skip}, orderBy: xp, orderDirection: desc) {
          id
        }
      }
    `;

    const response = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    const pageResults = data.data?.players ?? [];
    if (pageResults.length === 0) break;

    players.push(...pageResults.map(p => p.id.toLowerCase()));
    if (pageResults.length < 1000) break;
    skip += 1000;
  }

  console.log(`[✓] Fetched ${players.length} total players\n`);
  return players;
}

async function getVerifiedPlayers(client, addresses) {
  console.log('1️⃣  VERIFIED PLAYERS');
  console.log('─'.repeat(60));

  const IDENTITY_ABI = [
    {
      inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
      name: 'isWhitelisted',
      outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];

  const verified = [];
  const batchSize = 50;

  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(addr =>
        client.readContract({
          address: IDENTITY_ADDRESS,
          abi: IDENTITY_ABI,
          functionName: 'isWhitelisted',
          args: [addr],
        })
      )
    );

    results.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        verified.push(batch[idx]);
      }
    });

    if (i % 250 === 0) {
      process.stdout.write(`  Checked ${Math.min(i + batchSize, addresses.length)}/${addresses.length}\r`);
    }

    if (i + batchSize < addresses.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  console.log(`\n  Result: ${verified.length} verified players (${(verified.length / addresses.length * 100).toFixed(1)}% of ${addresses.length} total)`);
  console.log(`  Source: isWhitelisted() contract reads (Identity contract: ${IDENTITY_ADDRESS})`);
  console.log(`  Method: Direct RPC view function calls\n`);
  return verified;
}

async function getContractDeploymentBlock(client) {
  console.log('📍 Finding contract deployment block...');

  // Check a few recent block numbers to find first event
  const latestBlock = await client.getBlockNumber();
  const checkBlocks = [
    latestBlock,
    latestBlock - 100000n, // ~1 day back
    latestBlock - 500000n, // ~5 days back
    latestBlock - 1000000n, // ~10 days back
  ];

  for (const blockNum of checkBlocks) {
    try {
      if (blockNum < 0n) continue;
      const logs = await client.getLogs({
        address: GAME2048_ADDRESS,
        fromBlock: blockNum,
        toBlock: blockNum + 1000n,
      });

      if (logs.length > 0) {
        const earliestBlockWithEvents = logs.reduce((min, log) =>
          BigInt(log.blockNumber) < min ? BigInt(log.blockNumber) : min,
          latestBlock
        );
        console.log(`  ✓ Found events starting from block ${earliestBlockWithEvents}`);
        return earliestBlockWithEvents - 10n; // Search a bit before first event
      }
    } catch (err) {
      // Continue to next block
    }
  }

  // Default to 1M blocks back if no events found
  console.log(`  ⚠ Using fallback: scanning last 1M blocks`);
  return latestBlock - 1000000n;
}

async function getGameSessions(client, startBlock) {
  console.log('\n2️⃣  GAME SESSIONS PLAYED');
  console.log('─'.repeat(60));

  const latestBlock = await client.getBlockNumber();
  const chunkSize = 4000n;
  let allLogs = [];
  let fromBlock = startBlock;

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
            { name: 'score', type: 'uint256' },
            { name: 'highestTile', type: 'uint32' },
          ],
        },
        fromBlock,
        toBlock,
      });

      allLogs.push(...logs);
      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      console.log(`\n  Error in block range: ${err.message}`);
      break;
    }
  }

  console.log('\n  Result: ' + allLogs.length + ' game sessions (ScoreSubmitted events)');
  console.log(`  Source: RPC getLogs for ScoreSubmitted event\n`);
  return allLogs.length;
}

async function getTotalG$Volume(client, startBlock) {
  console.log('3️⃣  TOTAL G$ VOLUME');
  console.log('─'.repeat(60));

  const latestBlock = await client.getBlockNumber();
  const chunkSize = 4000n;
  let allLogs = [];
  let fromBlock = startBlock;

  process.stdout.write('  Scanning... ');
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
            { name: 'milestone', type: 'uint32' },
            { name: 'amount', type: 'uint256' },
          ],
        },
        fromBlock,
        toBlock,
      });

      allLogs.push(...logs);
      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      console.log(`\n  Error: ${err.message}`);
      break;
    }
  }

  let totalWei = 0n;
  allLogs.forEach(log => {
    totalWei += BigInt(log.args.amount || 0);
  });

  const totalG = Number(totalWei) / 1e18;
  console.log('\n  Result: ' + totalG.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' G$ distributed');
  console.log(`  Source: RPC getLogs for RewardPaid event (sum of amount field)\n`);
  return totalG;
}

async function getBountyParticipants(client, startBlock) {
  console.log('4️⃣  BOUNTY PARTICIPANTS (Current Period: 2026-08-17 to 2026-08-25)');
  console.log('─'.repeat(60));

  const latestBlock = await client.getBlockNumber();
  const chunkSize = 4000n;
  let allLogs = [];
  let fromBlock = startBlock;

  process.stdout.write('  Scanning... ');
  while (fromBlock < latestBlock) {
    const toBlock = fromBlock + chunkSize > latestBlock ? latestBlock : fromBlock + chunkSize;

    try {
      const logs = await client.getLogs({
        address: GAME2048_ADDRESS,
        event: {
          type: 'event',
          name: 'XpEarned',
          inputs: [
            { name: 'player', type: 'address', indexed: true },
            { name: 'amount', type: 'uint256' },
            { name: 'total', type: 'uint256' },
          ],
        },
        fromBlock,
        toBlock,
      });

      allLogs.push(...logs);
      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      console.log(`\n  Error: ${err.message}`);
      break;
    }
  }

  // Filter by bounty period timestamps
  const blockTimestampCache = {};
  const bountyEvents = [];

  for (const logEntry of allLogs) {
    try {
      const blockNum = Number(logEntry.blockNumber);
      let timestamp = blockTimestampCache[blockNum];

      if (timestamp === undefined) {
        const block = await client.getBlock({ blockNumber: BigInt(blockNum) });
        timestamp = Number(block.timestamp);
        blockTimestampCache[blockNum] = timestamp;
      }

      if (timestamp >= CURRENT_BOUNTY_START && timestamp <= CURRENT_BOUNTY_END) {
        bountyEvents.push(logEntry.args.player.toLowerCase());
      }
    } catch (err) {
      // Skip
    }
  }

  const uniquePlayers = new Set(bountyEvents);
  console.log('\n  Result: ' + uniquePlayers.size + ' unique players earned XP during Bounty #3');
  console.log(`  Source: RPC getLogs for XpEarned event (filtered by block timestamp)\n`);
  return uniquePlayers.size;
}

async function getMonthlyActiveUsers(client, startBlock) {
  console.log('5️⃣  MONTHLY ACTIVE USERS (Last 30 Days: 2026-07-26 to 2026-08-25)');
  console.log('─'.repeat(60));

  const latestBlock = await client.getBlockNumber();
  const chunkSize = 4000n;
  let allLogs = [];
  let fromBlock = startBlock;

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
            { name: 'score', type: 'uint256' },
            { name: 'highestTile', type: 'uint32' },
          ],
        },
        fromBlock,
        toBlock,
      });

      allLogs.push(...logs);
      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      console.log(`\n  Error: ${err.message}`);
      break;
    }
  }

  // Filter by 30-day period
  const blockTimestampCache = {};
  const mauEvents = [];

  for (const logEntry of allLogs) {
    try {
      const blockNum = Number(logEntry.blockNumber);
      let timestamp = blockTimestampCache[blockNum];

      if (timestamp === undefined) {
        const block = await client.getBlock({ blockNumber: BigInt(blockNum) });
        timestamp = Number(block.timestamp);
        blockTimestampCache[blockNum] = timestamp;
      }

      if (timestamp >= THIRTY_DAYS_AGO && timestamp <= TODAY) {
        mauEvents.push(logEntry.args.player.toLowerCase());
      }
    } catch (err) {
      // Skip
    }
  }

  const uniquePlayers = new Set(mauEvents);
  console.log('\n  Result: ' + uniquePlayers.size + ' unique players submitted scores in last 30 days');
  console.log(`  Source: RPC getLogs for ScoreSubmitted event (filtered by block timestamp)\n`);
  return uniquePlayers.size;
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     BLOCKSLIDE — LIVE METRICS (Direct from Celo RPC)          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  try {
    // Get all players
    const allPlayers = await fetchAllPlayers();

    // Metric 1: Verified Players
    const verifiedCount = (await getVerifiedPlayers(client, allPlayers)).length;

    // Find optimal starting block for event scanning
    const startBlock = await getContractDeploymentBlock(client);
    console.log('');

    // Metrics 2-5: From logs
    const sessions = await getGameSessions(client, startBlock);
    const volumeG = await getTotalG$Volume(client, startBlock);
    const bountyParticipants = await getBountyParticipants(client, startBlock);
    const mau = await getMonthlyActiveUsers(client, startBlock);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    // Print clean summary
    console.log('═'.repeat(70));
    console.log('📊 FINAL METRICS');
    console.log('═'.repeat(70));
    console.log('\n1. VERIFIED PLAYERS:       ' + verifiedCount + ' (out of ' + allPlayers.length + ' total)');
    console.log('2. GAME SESSIONS PLAYED:   ' + sessions);
    console.log('3. TOTAL G$ VOLUME:        ' + volumeG.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' G$');
    console.log('4. BOUNTY PARTICIPANTS:    ' + bountyParticipants + ' (Bounty #3)');
    console.log('5. MONTHLY ACTIVE USERS:   ' + mau + ' (last 30 days)');
    console.log('\n' + '═'.repeat(70));
    console.log(`Queried in ${elapsed}s\n`);

  } catch (err) {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
  }
}

main();
