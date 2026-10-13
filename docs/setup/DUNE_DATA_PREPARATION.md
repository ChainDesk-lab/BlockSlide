# BlockSlide Dune Analytics — Data Preparation Guide

**Contracts:**
- Game2048: `0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6` (Celo Mainnet)
- Identity: `0xc361a6e67822a0edc17d899227dd9fc50bd62f42` (Celo Mainnet)

---

## TASK 1: GoodDollar Identity Contract Events

### Finding
❌ **NO VERIFICATION EVENTS EXIST** in the GoodDollar identity contract.

The identity contract only exposes read-only functions:
- `isWhitelisted(address user) → bool` — Check if user is verified
- `getWhitelistedRoot(address account) → address` — Get root verified account (for linked wallets)

**Verification is NOT emitted as an event.** This means:
- Dune cannot decode verification status changes directly from contract events
- We must use a snapshot approach (see TASK 2) to track verified user counts over time

---

## TASK 2: Backend Verification Snapshot Job

Since GoodDollar doesn't emit verification events, we need a periodic job that:
1. Fetches all known player addresses from the subgraph
2. Checks `isWhitelisted()` for each address
3. Stores verified count + timestamp in a simple data store
4. Exposes this data to Dune

### Option A: Node.js/Express Backend Job (Recommended)

**File:** `/backend/jobs/verification-snapshot.ts`

```typescript
import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';
import * as fs from 'fs/promises';
import * as path from 'path';

const IDENTITY_ADDRESS = '0xc361a6e67822a0edc17d899227dd9fc50bd62f42';
const GAME2048_ADDRESS = '0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6';
const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/celo-game2048/game2048'; // Update with actual
const SNAPSHOT_FILE = path.join(__dirname, 'verification-snapshots.json');

const IDENTITY_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'isWhitelisted',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

interface VerificationSnapshot {
  timestamp: number;
  date: string;
  totalPlayers: number;
  verifiedPlayers: number;
  verificationRate: number; // %
}

async function fetchAllPlayers(): Promise<string[]> {
  // Query subgraph to get all unique player addresses
  const query = `
    {
      players(first: 1000, orderBy: xp, orderDirection: desc) {
        id
      }
    }
  `;

  const response = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  const data = (await response.json()) as {
    data?: { players?: Array<{ id: string }> };
  };

  return data.data?.players?.map(p => p.id) ?? [];
}

async function checkVerification(
  client: any,
  addresses: string[]
): Promise<{ verified: string[]; unverified: string[] }> {
  const verified: string[] = [];
  const unverified: string[] = [];

  // Check in batches of 50 to avoid rate limiting
  for (let i = 0; i < addresses.length; i += 50) {
    const batch = addresses.slice(i, i + 50);
    
    const results = await Promise.all(
      batch.map(addr =>
        client
          .readContract({
            address: IDENTITY_ADDRESS as `0x${string}`,
            abi: IDENTITY_ABI,
            functionName: 'isWhitelisted',
            args: [addr as `0x${string}`],
          })
          .then((isVerified: boolean) => ({ addr, isVerified }))
          .catch(() => ({ addr, isVerified: false })) // Default to false on error
      )
    );

    results.forEach(({ addr, isVerified }) => {
      if (isVerified) verified.push(addr);
      else unverified.push(addr);
    });

    console.log(
      `[Verification Check] Processed ${Math.min(i + 50, addresses.length)}/${addresses.length}`
    );
  }

  return { verified, unverified };
}

async function saveSnapshot(snapshot: VerificationSnapshot): Promise<void> {
  try {
    let snapshots: VerificationSnapshot[] = [];
    try {
      const existing = await fs.readFile(SNAPSHOT_FILE, 'utf-8');
      snapshots = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }

    snapshots.push(snapshot);
    // Keep only last 90 days
    snapshots = snapshots.slice(-90);

    await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(snapshots, null, 2));
    console.log(`[Snapshot] Saved: ${snapshot.date} (${snapshot.verifiedPlayers}/${snapshot.totalPlayers} verified)`);
  } catch (err) {
    console.error('[Snapshot] Failed to save:', err);
  }
}

export async function runVerificationSnapshot(): Promise<void> {
  console.log('[Verification Snapshot] Starting...');

  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  try {
    // Step 1: Fetch all players from subgraph
    console.log('[Verification Snapshot] Fetching all players from subgraph...');
    const players = await fetchAllPlayers();
    console.log(`[Verification Snapshot] Found ${players.length} players`);

    // Step 2: Check verification for each player
    console.log('[Verification Snapshot] Checking verification status...');
    const { verified } = await checkVerification(client, players);

    // Step 3: Create snapshot
    const now = new Date();
    const snapshot: VerificationSnapshot = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      totalPlayers: players.length,
      verifiedPlayers: verified.length,
      verificationRate: (verified.length / players.length) * 100,
    };

    // Step 4: Save to file
    await saveSnapshot(snapshot);
    console.log('[Verification Snapshot] Complete');
  } catch (err) {
    console.error('[Verification Snapshot] Error:', err);
    throw err;
  }
}

// Run daily via cron job or scheduled task
// Example: Every day at 2 AM UTC
// 0 2 * * * node -e "require('./jobs/verification-snapshot').runVerificationSnapshot()"
```

### Option B: Simple REST Endpoint

Add to your backend API:

```typescript
// routes/api/verification-snapshot.ts
import { Router } from 'express';
import { runVerificationSnapshot } from '../../jobs/verification-snapshot';

const router = Router();

router.post('/api/verification-snapshot', async (req, res) => {
  try {
    // Verify request has auth token if needed
    await runVerificationSnapshot();
    res.json({ status: 'success', message: 'Snapshot completed' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: String(err) });
  }
});

export default router;
```

### Using the Snapshot in Dune

Once you have `verification-snapshots.json`:

1. **Option 1 (Manual):** Copy-paste JSON into Dune as a query result
2. **Option 2 (Automated):** Set up Dune's API to periodically pull from your backend
3. **Option 3 (Database):** Store snapshots in a Supabase/Firebase table and reference from Dune

---

## TASK 3: Dune SQL Queries (Ready to Paste)

### Query 1: Total Registered Users (All-Time)

```sql
-- Count unique players who have ever started a session
SELECT COUNT(DISTINCT player) AS total_users
FROM celo.events.game2048_sessionstarted_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
```

### Query 2: Daily Active Users (DAU)

```sql
-- Count unique players per day who submitted a score or started a session
SELECT
  DATE_TRUNC('day', block_time) AS date,
  COUNT(DISTINCT player) AS dau
FROM celo.events.game2048_scoresubmitted_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
  AND block_time >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', block_time)
ORDER BY date DESC
```

### Query 3: Weekly Active Users (WAU)

```sql
-- Count unique players per week who submitted a score
SELECT
  DATE_TRUNC('week', block_time) AS week_start,
  COUNT(DISTINCT player) AS wau,
  ROUND(100.0 * COUNT(DISTINCT player) / 
    (SELECT COUNT(DISTINCT player) FROM celo.events.game2048_scoresubmitted_evt_v0
     WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')), 2) AS pct_of_total
FROM celo.events.game2048_scoresubmitted_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
  AND block_time >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE_TRUNC('week', block_time)
ORDER BY week_start DESC
```

### Query 4: Monthly Active Users (MAU)

```sql
-- Count unique players per month who submitted a score
SELECT
  DATE_TRUNC('month', block_time) AS month_start,
  COUNT(DISTINCT player) AS mau,
  ROUND(100.0 * COUNT(DISTINCT player) / 
    (SELECT COUNT(DISTINCT player) FROM celo.events.game2048_scoresubmitted_evt_v0
     WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')), 2) AS pct_of_total
FROM celo.events.game2048_scoresubmitted_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
GROUP BY DATE_TRUNC('month', block_time)
ORDER BY month_start DESC
```

### Query 5: Total XP Distributed

```sql
-- Sum all XP earned by players
SELECT
  SUM(CAST(amount AS DECIMAL(38, 0))) AS total_xp_earned,
  COUNT(*) AS xp_distribution_events,
  ROUND(AVG(CAST(amount AS DECIMAL(38, 0))), 2) AS avg_xp_per_session
FROM celo.events.game2048_xpearned_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
```

### Query 6: XP Earned Per Day

```sql
-- Daily XP distribution totals
SELECT
  DATE_TRUNC('day', block_time) AS date,
  SUM(CAST(amount AS DECIMAL(38, 0))) AS daily_xp,
  COUNT(DISTINCT player) AS players_earning_xp,
  COUNT(*) AS xp_events
FROM celo.events.game2048_xpearned_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
  AND block_time >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', block_time)
ORDER BY date DESC
```

### Query 7: Total G$ Rewards Paid Out

```sql
-- Sum all G$ rewards distributed to players (RewardPaid events)
SELECT
  SUM(CAST(amount AS DECIMAL(38, 0))) AS total_g_rewards,
  COUNT(*) AS reward_events,
  COUNT(DISTINCT player) AS players_rewarded,
  ROUND(AVG(CAST(amount AS DECIMAL(38, 0))), 2) AS avg_reward_per_milestone
FROM celo.events.game2048_rewardpaid_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
```

### Query 8: Daily G$ Rewards

```sql
-- Daily G$ reward payouts
SELECT
  DATE_TRUNC('day', block_time) AS date,
  SUM(CAST(amount AS DECIMAL(38, 0))) AS daily_g_rewards,
  COUNT(*) AS reward_count,
  COUNT(DISTINCT player) AS unique_recipients
FROM celo.events.game2048_rewardpaid_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
  AND block_time >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', block_time)
ORDER BY date DESC
```

### Query 9: Total On-Chain Transactions

```sql
-- Count all transactions that called Game2048 contract functions
SELECT
  COUNT(*) AS total_transactions,
  COUNT(DISTINCT from) AS unique_callers,
  COUNT(DISTINCT function_name) AS distinct_functions,
  COUNT(CASE WHEN success THEN 1 END) AS successful_txs,
  COUNT(CASE WHEN NOT success THEN 1 END) AS failed_txs
FROM celo.transactions
WHERE to = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
```

### Query 10: Daily On-Chain Transactions

```sql
-- Daily transaction volume
SELECT
  DATE_TRUNC('day', block_time) AS date,
  COUNT(*) AS daily_txs,
  COUNT(DISTINCT from) AS unique_callers,
  COUNT(CASE WHEN success THEN 1 END) AS successful_txs
FROM celo.transactions
WHERE to = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
  AND block_time >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', block_time)
ORDER BY date DESC
```

### Query 11: Top Earners by G$ Rewards

```sql
-- Top players ranked by total G$ earned (all-time)
SELECT
  player,
  COUNT(*) AS reward_count,
  COUNT(DISTINCT DATE_TRUNC('day', block_time)) AS days_earned,
  SUM(CAST(amount AS DECIMAL(38, 0))) AS total_g_earned,
  ROUND(AVG(CAST(amount AS DECIMAL(38, 0))), 2) AS avg_reward,
  MAX(block_time) AS last_reward_date
FROM celo.events.game2048_rewardpaid_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
GROUP BY player
ORDER BY total_g_earned DESC
LIMIT 50
```

### Query 12: Top Players by XP

```sql
-- Top players ranked by total XP earned (all-time)
SELECT
  player,
  SUM(CAST(amount AS DECIMAL(38, 0))) AS total_xp,
  COUNT(*) AS xp_earning_events,
  COUNT(DISTINCT DATE_TRUNC('day', block_time)) AS active_days,
  ROUND(AVG(CAST(amount AS DECIMAL(38, 0))), 2) AS avg_xp_per_session,
  MAX(block_time) AS last_active
FROM celo.events.game2048_xpearned_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
GROUP BY player
ORDER BY total_xp DESC
LIMIT 50
```

### Query 13: Top Earners by G$ (Last 30 Days)

```sql
-- Top earners in the last 30 days
SELECT
  player,
  COUNT(*) AS recent_rewards,
  SUM(CAST(amount AS DECIMAL(38, 0))) AS recent_g_earned
FROM celo.events.game2048_rewardpaid_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
  AND block_time >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY player
ORDER BY recent_g_earned DESC
LIMIT 20
```

### Query 14: Game Sessions Started (Daily)

```sql
-- Daily count of players starting new sessions
SELECT
  DATE_TRUNC('day', block_time) AS date,
  COUNT(*) AS sessions_started,
  COUNT(DISTINCT player) AS unique_players
FROM celo.events.game2048_sessionstarted_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
  AND block_time >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', block_time)
ORDER BY date DESC
```

### Query 15: Scores Submitted (Daily)

```sql
-- Daily count of scores submitted
SELECT
  DATE_TRUNC('day', block_time) AS date,
  COUNT(*) AS scores_submitted,
  COUNT(DISTINCT player) AS players_with_scores,
  ROUND(AVG(CAST(score AS DECIMAL(38, 0))), 2) AS avg_score,
  MAX(CAST(score AS DECIMAL(38, 0))) AS max_score
FROM celo.events.game2048_scoresubmitted_evt_v0
WHERE contract_address = LOWER('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6')
  AND block_time >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', block_time)
ORDER BY date DESC
```

### Query 16: Total Verified Users (Using Snapshot Data)

```sql
-- Requires loading verification-snapshots.json data into Dune first
-- This query joins with your snapshot table
SELECT
  snapshot_date,
  total_players,
  verified_players,
  ROUND(verification_rate, 2) AS verification_percentage
FROM your_verification_snapshots_table
ORDER BY snapshot_date DESC
LIMIT 30
```

---

## Implementation Steps

### Step 1: Set Up Verification Snapshots
1. Deploy the backend job (TASK 2) to your server
2. Set it to run daily via cron job: `0 2 * * *` (2 AM UTC)
3. Verify snapshots are being saved to `verification-snapshots.json`

### Step 2: Load Verification Data into Dune
Choose one method:
- **Manual:** Copy JSON into Dune's custom data upload
- **Automated:** Set up API connection to your backend
- **Database:** Store in Supabase and reference via Dune API

### Step 3: Add Queries to Dune
1. Log into your Dune dashboard
2. Create 16 new queries (one for each above)
3. Paste each SQL block exactly as shown
4. Replace `game2048` table names if your Dune schema differs
5. Set refresh intervals:
   - User/activity queries: 4 hours
   - Transaction queries: 2 hours
   - Reward queries: 6 hours

### Step 4: Create Visualizations
For each query, choose appropriate chart type:
- User counts: **Big Number Card**
- Daily/Weekly trends: **Line Chart** (Date on X-axis)
- Top earners: **Table**
- Verification rate: **Gauge Chart** or **Big Number**

### Step 5: Organize Dashboard
Reference the `DUNE_DASHBOARD_REORGANIZATION_GUIDE.md` for layout structure.

---

## Troubleshooting

### "No data found" errors
- Verify contract address is correct (checksum-sensitive)
- Confirm events are being emitted on Celo mainnet (not testnet)
- Check block time range isn't too recent (events need time to index)

### Verification snapshots not updating
- Check cron job logs: `journalctl -u verification-snapshot-job`
- Verify subgraph is responding: `curl {SUBGRAPH_URL}`
- Check identity contract RPC: `cast call 0xc361... "isWhitelisted(address)" <address>`

### Dune query timeouts
- Add filters: `AND block_time >= CURRENT_DATE - INTERVAL '30 days'`
- Use `DATE_TRUNC` for grouping instead of daily calculations
- Increase query refresh interval from 2 hours to 4-6 hours

