import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IDENTITY_ADDRESS = '0xc361a6e67822a0edc17d899227dd9fc50bd62f42';
const SUBGRAPH_URL = process.env.SUBGRAPH_URL || 'https://api.goldsky.com/api/public/project_cmqr4hmlpe3gy01upecld9jhu/subgraphs/blockslide-leaderboard/2.0.0/gn';
const SNAPSHOT_DIR = path.join(__dirname, '../data/verification-snapshots');
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, 'snapshots.json');

const IDENTITY_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'isWhitelisted',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
];

async function fetchAllPlayers() {
  console.log('[Verification Snapshot] Fetching players from subgraph...');
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

      if (!response.ok) {
        throw new Error(`Subgraph HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.errors) {
        console.error('[Verification Snapshot] Subgraph errors:', data.errors);
        throw new Error(`Subgraph returned errors: ${data.errors[0]?.message}`);
      }

      const pageResults = data.data?.players ?? [];
      if (pageResults.length === 0) break;

      players.push(...pageResults.map(p => p.id.toLowerCase()));
      console.log(`[Verification Snapshot] Fetched ${players.length} players so far...`);

      if (pageResults.length < pageSize) break;
      skip += pageSize;
    } catch (err) {
      console.error('[Verification Snapshot] Subgraph fetch error:', err);
      throw err;
    }
  }

  console.log(`[Verification Snapshot] Total players: ${players.length}`);
  return players;
}

async function checkWhitelistBatch(client, addresses) {
  const results = await Promise.allSettled(
    addresses.map(addr =>
      client.readContract({
        address: IDENTITY_ADDRESS,
        abi: IDENTITY_ABI,
        functionName: 'isWhitelisted',
        args: [addr],
      })
    )
  );

  return results.map((result, idx) => ({
    address: addresses[idx],
    isVerified: result.status === 'fulfilled' ? result.value : false,
  }));
}

async function checkVerification(client, addresses) {
  console.log('[Verification Snapshot] Checking verification status...');

  const verified = [];
  const unverified = [];
  const batchSize = 50;

  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);

    try {
      const results = await checkWhitelistBatch(client, batch);

      results.forEach(({ address, isVerified }) => {
        if (isVerified) verified.push(address);
        else unverified.push(address);
      });

      const progress = Math.min(i + batchSize, addresses.length);
      console.log(
        `[Verification Snapshot] Processed ${progress}/${addresses.length} (${verified.length} verified)`
      );

      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err) {
      console.error(`[Verification Snapshot] Error checking batch at index ${i}:`, err);
    }
  }

  return { verified, unverified };
}

async function ensureSnapshotDir() {
  try {
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  } catch (err) {
    console.error('[Verification Snapshot] Failed to create snapshot directory:', err);
    throw err;
  }
}

async function loadSnapshots() {
  try {
    const content = await fs.readFile(SNAPSHOT_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveSnapshots(snapshots) {
  try {
    const cutoffTime = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const filtered = snapshots.filter(s => s.timestamp >= cutoffTime);

    await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(filtered, null, 2));
    console.log(`[Verification Snapshot] Saved ${filtered.length} snapshots to ${SNAPSHOT_FILE}`);
  } catch (err) {
    console.error('[Verification Snapshot] Failed to save snapshots:', err);
    throw err;
  }
}

async function main() {
  console.log('[Verification Snapshot] Starting verification snapshot job...');
  console.log(`[Verification Snapshot] Time: ${new Date().toISOString()}`);

  const startTime = Date.now();

  try {
    await ensureSnapshotDir();

    const client = createPublicClient({
      chain: celo,
      transport: http('https://forno.celo.org'),
    });
    console.log('[Verification Snapshot] Connected to Celo RPC');

    const players = await fetchAllPlayers();
    if (players.length === 0) {
      throw new Error('No players found in subgraph');
    }

    const { verified } = await checkVerification(client, players);

    const now = new Date();
    const snapshot = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      totalPlayers: players.length,
      verifiedPlayers: verified.length,
      verificationRate: (verified.length / players.length) * 100,
    };

    const existing = await loadSnapshots();
    const updated = [...existing, snapshot];
    await saveSnapshots(updated);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('[Verification Snapshot] ✓ Complete');
    console.log(`  Date: ${snapshot.date}`);
    console.log(`  Total Players: ${snapshot.totalPlayers}`);
    console.log(`  Verified: ${snapshot.verifiedPlayers} (${snapshot.verificationRate.toFixed(2)}%)`);
    console.log(`  Time: ${elapsed}s`);

    return snapshot;
  } catch (err) {
    console.error('[Verification Snapshot] ✗ Failed:', err);
    throw err;
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
