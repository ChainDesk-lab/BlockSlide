import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IDENTITY_ADDRESS = '0xc361a6e67822a0edc17d899227dd9fc50bd62f42' as const;
const SUBGRAPH_URL = process.env.SUBGRAPH_URL || 'https://api.thegraph.com/subgraphs/name/blockslide/game2048';
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
] as const;

export interface VerificationSnapshot {
  timestamp: number;
  date: string;
  totalPlayers: number;
  verifiedPlayers: number;
  verificationRate: number;
}

interface Player {
  id: string;
}

/**
 * Fetch all unique player addresses from the subgraph
 */
async function fetchAllPlayers(): Promise<string[]> {
  console.log('[Verification Snapshot] Fetching players from subgraph...');
  const players: string[] = [];
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

      const data = (await response.json()) as {
        data?: { players?: Player[] };
        errors?: Array<{ message: string }>;
      };

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

/**
 * Check isWhitelisted status for a batch of addresses
 */
async function checkWhitelistBatch(
  client: ReturnType<typeof createPublicClient>,
  addresses: string[]
): Promise<{ address: string; isVerified: boolean }[]> {
  const results = await Promise.allSettled(
    addresses.map(addr =>
      client.readContract({
        address: IDENTITY_ADDRESS,
        abi: IDENTITY_ABI,
        functionName: 'isWhitelisted',
        args: [addr as `0x${string}`],
      })
    )
  );

  return results.map((result, idx) => ({
    address: addresses[idx],
    isVerified: result.status === 'fulfilled' ? (result.value as boolean) : false,
  }));
}

/**
 * Check verification status for all players
 */
async function checkVerification(
  client: ReturnType<typeof createPublicClient>,
  addresses: string[]
): Promise<{ verified: string[]; unverified: string[] }> {
  console.log('[Verification Snapshot] Checking verification status...');

  const verified: string[] = [];
  const unverified: string[] = [];
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

      // Rate limiting - wait 100ms between batches
      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err) {
      console.error(`[Verification Snapshot] Error checking batch at index ${i}:`, err);
      // Continue with next batch on error
    }
  }

  return { verified, unverified };
}

/**
 * Ensure snapshot directory exists
 */
async function ensureSnapshotDir(): Promise<void> {
  try {
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  } catch (err) {
    console.error('[Verification Snapshot] Failed to create snapshot directory:', err);
    throw err;
  }
}

/**
 * Load existing snapshots from file
 */
async function loadSnapshots(): Promise<VerificationSnapshot[]> {
  try {
    const content = await fs.readFile(SNAPSHOT_FILE, 'utf-8');
    return JSON.parse(content) as VerificationSnapshot[];
  } catch {
    // File doesn't exist yet, return empty array
    return [];
  }
}

/**
 * Save snapshots to file
 */
async function saveSnapshots(snapshots: VerificationSnapshot[]): Promise<void> {
  try {
    // Keep only last 90 days
    const cutoffTime = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const filtered = snapshots.filter(s => s.timestamp >= cutoffTime);

    await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(filtered, null, 2));
    console.log(`[Verification Snapshot] Saved ${filtered.length} snapshots to ${SNAPSHOT_FILE}`);
  } catch (err) {
    console.error('[Verification Snapshot] Failed to save snapshots:', err);
    throw err;
  }
}

/**
 * Main verification snapshot job
 */
export async function runVerificationSnapshot(): Promise<VerificationSnapshot> {
  console.log('[Verification Snapshot] Starting verification snapshot job...');
  console.log(`[Verification Snapshot] Time: ${new Date().toISOString()}`);

  const startTime = Date.now();

  try {
    // Setup
    await ensureSnapshotDir();

    // Step 1: Connect to RPC
    const client = createPublicClient({
      chain: celo,
      transport: http('https://forno.celo.org'),
    });
    console.log('[Verification Snapshot] Connected to Celo RPC');

    // Step 2: Fetch all players
    const players = await fetchAllPlayers();
    if (players.length === 0) {
      throw new Error('No players found in subgraph');
    }

    // Step 3: Check verification
    const { verified } = await checkVerification(client, players);

    // Step 4: Create snapshot
    const now = new Date();
    const snapshot: VerificationSnapshot = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      totalPlayers: players.length,
      verifiedPlayers: verified.length,
      verificationRate: (verified.length / players.length) * 100,
    };

    // Step 5: Save snapshot
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

/**
 * Get latest snapshot
 */
export async function getLatestSnapshot(): Promise<VerificationSnapshot | null> {
  try {
    const snapshots = await loadSnapshots();
    return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Get all snapshots
 */
export async function getAllSnapshots(): Promise<VerificationSnapshot[]> {
  return loadSnapshots();
}

/**
 * Export snapshots as CSV for Dune
 */
export async function exportAsCSV(): Promise<string> {
  const snapshots = await loadSnapshots();

  let csv = 'date,total_players,verified_players,verification_rate\n';
  for (const snap of snapshots) {
    csv += `${snap.date},${snap.totalPlayers},${snap.verifiedPlayers},${snap.verificationRate.toFixed(2)}\n`;
  }

  return csv;
}
