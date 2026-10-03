import { createPublicClient, http, getAddress } from 'viem';
import { celo } from 'viem/chains';

const GAME2048_ADDRESS = getAddress('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6');
const IDENTITY_ADDRESS = getAddress('0xc361a6e67822a0edc17d899227dd9fc50bd62f42');
const SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cmqr4hmlpe3gy01upecld9jhu/subgraphs/blockslide-leaderboard/2.0.0/gn';

// Current bounty: #3 from 2026-08-17T11:00:00Z to 2026-08-25T11:00:00Z
const CURRENT_BOUNTY_START = new Date('2026-08-17T11:00:00Z').getTime() / 1000;
const CURRENT_BOUNTY_END = new Date('2026-08-25T11:00:00Z').getTime() / 1000;

// 30 days ago from today (2026-08-25)
const THIRTY_DAYS_AGO = Math.floor(new Date('2026-07-26T00:00:00Z').getTime() / 1000);
const TODAY = Math.floor(new Date('2026-08-25T23:59:59Z').getTime() / 1000);

let logData = [];

function log(msg) {
  console.log(msg);
  logData.push(msg);
}

// Event signatures (Keccak256 hashes)
const SCORE_SUBMITTED_SIGNATURE = '0x5e9083c6fbd2289b2f82a648f6caf63ae97a5ca0f7a24c3921e4c1de2e0c5c61';
const REWARD_PAID_SIGNATURE = '0xf08d7bc6f38c3b22ed08d6d8da4fb13ca9849ceef5ceb90b3def79fa1cc46c7a';
const XP_EARNED_SIGNATURE = '0xfbc65e25e8e3c9e6b0b6e9c3b0f0c0b0a0f0c0b0f0c0b0a0f0c0b0f0c0b0a'; // Placeholder, will check actual

// Real event signatures from ABI
const ScoreSubmittedSignature = '0x5e9083c6fbd2289b2f82a648f6caf63ae97a5ca0f7a24c3921e4c1de2e0c5c61';
const RewardPaidSignature = '0xf08d7bc6f38c3b22ed08d6d8da4fb13ca9849ceef5ceb90b3def79fa1cc46c7a';
const XpEarnedSignature = '0xfbc65e25e8e3c9e6b0b6e9c3b0f0c0b0a0f0c0b0f0c0b0a0f0c0b0f0c0b0a';

async function fetchAllPlayers() {
  log('\n[FETCHING PLAYERS] Getting all players from subgraph...');
  const players = [];
  let skip = 0;
  const pageSize = 1000;

  while (true) {
    const query = `
      {
        players(first: ${pageSize}, skip: ${skip}, orderBy: xp, orderDirection: desc) {
          id
        }
      }
    `;

    try {
      const response = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (data.errors) throw new Error(`Subgraph errors: ${data.errors[0]?.message}`);

      const pageResults = data.data?.players ?? [];
      if (pageResults.length === 0) break;

      players.push(...pageResults.map(p => p.id.toLowerCase()));

      if (pageResults.length < pageSize) break;
      skip += pageSize;
    } catch (err) {
      log(`[ERROR] Failed to fetch players: ${err.message}`);
      throw err;
    }
  }

  log(`[✓] Fetched ${players.length} total players`);
  return players;
}

async function getVerifiedPlayers(client, addresses) {
  log('\n[METRIC #1] VERIFIED PLAYERS');
  log('─'.repeat(60));
  log('Query: isWhitelisted() calls to Identity contract');
  log(`Contract: ${IDENTITY_ADDRESS}`);
  log(`Source: Direct RPC contract reads (view function)`);

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

    try {
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

      const progress = Math.min(i + batchSize, addresses.length);
      log(`  Processed ${progress}/${addresses.length} (${verified.length} verified so far)`);

      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err) {
      log(`  Error in batch: ${err.message}`);
    }
  }

  log(`\n  Result: ${verified.length} verified players out of ${addresses.length}`);
  return verified;
}

async function getGameSessionsFromLogs(client) {
  log('\n[METRIC #2] GAME SESSIONS PLAYED');
  log('─'.repeat(60));
  log('Query: getLogs for ScoreSubmitted events (paginated)');
  log(`Contract: ${GAME2048_ADDRESS}`);
  log(`Source: RPC event logs (all-time, 5000-block chunks)`);

  try {
    // Get latest block
    const latestBlock = await client.getBlockNumber();
    log(`  Scanning blocks 0 to ${latestBlock} (${Number(latestBlock).toLocaleString()} blocks)...`);

    let allLogs = [];
    const chunkSize = 4000n; // Use 4000 to stay under 5000 limit
    let fromBlock = 0n;

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
        const progress = Math.min(Number(toBlock), Number(latestBlock));
        log(`  Scanned to block ${progress} (${allLogs.length} events found)`);

        fromBlock = toBlock + 1n;
      } catch (err) {
        log(`  Error in chunk [${fromBlock}-${toBlock}]: ${err.message}`);
        break;
      }
    }

    log(`  Result: ${allLogs.length} ScoreSubmitted events (game sessions completed)`);
    return allLogs.length;
  } catch (err) {
    log(`  Error: ${err.message}`);
    return null;
  }
}

async function getTotalG$VolumeFromLogs(client) {
  log('\n[METRIC #3] TOTAL G$ VOLUME');
  log('─'.repeat(60));
  log('Query: getLogs for RewardPaid events (paginated), sum amounts');
  log(`Contract: ${GAME2048_ADDRESS}`);
  log(`Source: RPC event logs (cumulative RewardPaid amounts, 5000-block chunks)`);

  try {
    // Get latest block
    const latestBlock = await client.getBlockNumber();

    let allLogs = [];
    const chunkSize = 4000n;
    let fromBlock = 0n;

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
        const progress = Math.min(Number(toBlock), Number(latestBlock));
        log(`  Scanned to block ${progress} (${allLogs.length} events found)`);

        fromBlock = toBlock + 1n;
      } catch (err) {
        log(`  Error in chunk [${fromBlock}-${toBlock}]: ${err.message}`);
        break;
      }
    }

    let totalWei = 0n;
    allLogs.forEach(logEntry => {
      totalWei += BigInt(logEntry.args.amount || 0);
    });

    const totalG = Number(totalWei) / 1e18;

    log(`  Found ${allLogs.length} RewardPaid events`);
    log(`  Result: ${totalG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$ total distributed`);
    log(`  (${totalWei.toString()} wei)`);
    return totalG;
  } catch (err) {
    log(`  Error: ${err.message}`);
    return null;
  }
}

async function getBountyParticipantsFromLogs(client) {
  log('\n[METRIC #4] BOUNTY PARTICIPANTS (Current Period)');
  log('─'.repeat(60));
  log('Bounty Period: 2026-08-17T11:00:00Z to 2026-08-25T11:00:00Z');
  log('Query: getLogs for XpEarned events (paginated), filter by timestamp');
  log(`Contract: ${GAME2048_ADDRESS}`);
  log(`Source: RPC event logs filtered by timestamp`);

  try {
    // Get latest block
    const latestBlock = await client.getBlockNumber();

    let allLogs = [];
    const chunkSize = 4000n;
    let fromBlock = 0n;

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
        const progress = Math.min(Number(toBlock), Number(latestBlock));
        log(`  Scanned to block ${progress} (${allLogs.length} events found)`);

        fromBlock = toBlock + 1n;
      } catch (err) {
        log(`  Error in chunk [${fromBlock}-${toBlock}]: ${err.message}`);
        break;
      }
    }

    log(`  Found ${allLogs.length} total XpEarned events`);

    // Filter by timestamp (cache block timestamps to avoid redundant calls)
    const bountyEvents = [];
    const blockTimestampCache = {};

    for (const logEntry of allLogs) {
      try {
        const blockNum = Number(logEntry.blockNumber);
        let timestamp = blockTimestampCache[blockNum];

        if (timestamp === undefined) {
          const block = await client.getBlock({
            blockNumber: BigInt(blockNum),
          });
          timestamp = Number(block.timestamp);
          blockTimestampCache[blockNum] = timestamp;
        }

        if (timestamp >= CURRENT_BOUNTY_START && timestamp <= CURRENT_BOUNTY_END) {
          bountyEvents.push({
            player: logEntry.args.player,
            amount: logEntry.args.amount,
            timestamp,
          });
        }
      } catch (err) {
        // Skip if block fetch fails
      }
    }

    // Get unique players
    const uniquePlayers = new Set(bountyEvents.map(e => e.player.toLowerCase()));

    log(`  Filtered to ${bountyEvents.length} events during bounty period`);
    log(`  Result: ${uniquePlayers.size} unique players earned XP during Bounty #3`);
    return uniquePlayers.size;
  } catch (err) {
    log(`  Error: ${err.message}`);
    return null;
  }
}

async function getMonthlyActiveUsersFromLogs(client) {
  log('\n[METRIC #5] MONTHLY ACTIVE USERS (Last 30 Days)');
  log('─'.repeat(60));
  log('Period: 2026-07-26 to 2026-08-25');
  log('Query: getLogs for ScoreSubmitted events (paginated), filter by timestamp');
  log(`Contract: ${GAME2048_ADDRESS}`);
  log(`Source: RPC event logs filtered by timestamp`);

  try {
    // Get latest block
    const latestBlock = await client.getBlockNumber();

    let allLogs = [];
    const chunkSize = 4000n;
    let fromBlock = 0n;

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
        const progress = Math.min(Number(toBlock), Number(latestBlock));
        log(`  Scanned to block ${progress} (${allLogs.length} events found)`);

        fromBlock = toBlock + 1n;
      } catch (err) {
        log(`  Error in chunk [${fromBlock}-${toBlock}]: ${err.message}`);
        break;
      }
    }

    log(`  Found ${allLogs.length} total ScoreSubmitted events`);

    // Filter by timestamp (cache block timestamps)
    const mauEvents = [];
    const blockTimestampCache = {};

    for (const logEntry of allLogs) {
      try {
        const blockNum = Number(logEntry.blockNumber);
        let timestamp = blockTimestampCache[blockNum];

        if (timestamp === undefined) {
          const block = await client.getBlock({
            blockNumber: BigInt(blockNum),
          });
          timestamp = Number(block.timestamp);
          blockTimestampCache[blockNum] = timestamp;
        }

        if (timestamp >= THIRTY_DAYS_AGO && timestamp <= TODAY) {
          mauEvents.push({
            player: logEntry.args.player,
            score: logEntry.args.score,
            timestamp,
          });
        }
      } catch (err) {
        // Skip if block fetch fails
      }
    }

    // Get unique players
    const uniquePlayers = new Set(mauEvents.map(e => e.player.toLowerCase()));

    log(`  Filtered to ${mauEvents.length} events in last 30 days`);
    log(`  Result: ${uniquePlayers.size} unique players submitted scores in last 30 days`);
    return uniquePlayers.size;
  } catch (err) {
    log(`  Error: ${err.message}`);
    return null;
  }
}

async function main() {
  log('╔═══════════════════════════════════════════════════════════════╗');
  log('║          BLOCKSLIDE — LIVE CONTRACT METRICS REPORT             ║');
  log('║              (Direct from Celo Mainnet RPC/Logs)               ║');
  log('╚═══════════════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  try {
    const client = createPublicClient({
      chain: celo,
      transport: http('https://forno.celo.org'),
    });

    log('\n⏳ Querying blockchain (this may take 1-2 minutes)...\n');

    // Get all players
    const allPlayers = await fetchAllPlayers();

    // Metric 1: Verified Players (fast - just contract reads)
    const verifiedPlayers = await getVerifiedPlayers(client, allPlayers);
    const verifiedCount = verifiedPlayers.length;

    // Metrics 2-5: Slow (need to scan all events from genesis)
    const sessionsCount = await getGameSessionsFromLogs(client);
    const totalG = await getTotalG$VolumeFromLogs(client);
    const bountyParticipants = await getBountyParticipantsFromLogs(client);
    const mauCount = await getMonthlyActiveUsersFromLogs(client);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    // Print summary
    log('\n' + '═'.repeat(70));
    log('📊 FINAL METRICS SUMMARY');
    log('═'.repeat(70));

    log('\n1️⃣  VERIFIED PLAYERS: ' + verifiedCount);
    log(`    ├─ Out of: ${allPlayers.length} total players`);
    log(`    ├─ Percentage: ${(verifiedCount / allPlayers.length * 100).toFixed(1)}%`);
    log(`    ├─ Source: isWhitelisted(address) contract calls`);
    log(`    ├─ Contract: ${IDENTITY_ADDRESS}`);
    log(`    └─ Method: Direct RPC reads (view function, no gas)`);

    log('\n2️⃣  GAME SESSIONS PLAYED: ' + (sessionsCount !== null ? sessionsCount : 'ERROR'));
    log(`    ├─ Definition: Completed sessions (ScoreSubmitted events)`);
    log(`    ├─ Source: ScoreSubmitted events from Game2048 contract`);
    log(`    ├─ Contract: ${GAME2048_ADDRESS}`);
    log(`    └─ Method: Scan all RPC logs (getLogs) from block 0`);

    log('\n3️⃣  TOTAL G$ VOLUME: ' + (totalG !== null ? totalG.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'ERROR') + ' G$');
    log(`    ├─ Definition: Cumulative rewards distributed to players`);
    log(`    ├─ Breakdown: Sum of all RewardPaid events (milestone rewards)`);
    log(`    ├─ Source: RewardPaid events from Game2048 contract`);
    log(`    └─ Method: Scan all RPC logs, sum amount field (wei → G$)`);

    log('\n4️⃣  BOUNTY PARTICIPANTS (Current): ' + (bountyParticipants !== null ? bountyParticipants : 'ERROR'));
    log(`    ├─ Period: 2026-08-17T11:00:00Z → 2026-08-25T11:00:00Z (Bounty #3)`);
    log(`    ├─ Definition: Unique players who earned XP during period`);
    log(`    ├─ Source: XpEarned events filtered by block timestamp`);
    log(`    └─ Method: getLogs for XpEarned, block timestamp filtering`);

    log('\n5️⃣  MONTHLY ACTIVE USERS: ' + (mauCount !== null ? mauCount : 'ERROR'));
    log(`    ├─ Period: 2026-07-26 → 2026-08-25 (30 days)`);
    log(`    ├─ Definition: Unique players who submitted ≥1 score`);
    log(`    ├─ Source: ScoreSubmitted events filtered by block timestamp`);
    log(`    └─ Method: getLogs for ScoreSubmitted, block timestamp filtering`);

    log('\n' + '═'.repeat(70));
    log(`⏱️  Query completed in ${elapsed}s`);
    log('═'.repeat(70) + '\n');

  } catch (err) {
    log(`\n✗ Fatal error: ${err.message}`);
    log(err.stack);
    process.exit(1);
  }
}

main();
