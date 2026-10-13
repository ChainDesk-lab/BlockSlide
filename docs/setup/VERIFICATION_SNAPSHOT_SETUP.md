# Verification Snapshot Job — Setup Guide

## Overview

The verification snapshot job runs daily to check GoodDollar identity verification status for all BlockSlide players and stores historical data for Dune analytics.

---

## Installation

### 1. Create Data Directory

```bash
mkdir -p backend/data/verification-snapshots
```

### 2. Install Dependencies (if not already installed)

```bash
npm install viem
```

### 3. Set Environment Variables

Add to your `.env` file:

```env
# Subgraph URL (required)
SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/blockslide/game2048

# RPC is hardcoded to forno.celo.org (Celo's official endpoint)
# but can be overridden if needed
```

### 4. Verify Subgraph URL

Test the subgraph is accessible:

```bash
curl -X POST https://api.thegraph.com/subgraphs/name/blockslide/game2048 \
  -H 'Content-Type: application/json' \
  -d '{"query": "{ players(first: 1) { id } }"}'
```

Should return: `{"data":{"players":[{"id":"0x..."}]}}`

---

## Running the Job

### Option 1: Manual Execution (for testing)

```bash
npx ts-node backend/jobs/verification-snapshot.ts
```

Expected output:
```
[Verification Snapshot] Starting verification snapshot job...
[Verification Snapshot] Connected to Celo RPC
[Verification Snapshot] Fetching players from subgraph...
[Verification Snapshot] Total players: 25187
[Verification Snapshot] Checking verification status...
[Verification Snapshot] Processed 50/25187 (12 verified)
...
[Verification Snapshot] ✓ Complete
  Date: 2026-08-21
  Total Players: 25187
  Verified: 8642 (34.33%)
  Time: 145.23s
```

### Option 2: Node.js Script (Production)

Create `/backend/scripts/run-verification-snapshot.js`:

```javascript
const { runVerificationSnapshot } = require('../jobs/verification-snapshot');

runVerificationSnapshot()
  .then(snapshot => {
    console.log('Snapshot saved successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('Snapshot failed:', err);
    process.exit(1);
  });
```

Run with:
```bash
node backend/scripts/run-verification-snapshot.js
```

### Option 3: Cron Job (Daily at 2 AM UTC)

Edit your crontab:

```bash
crontab -e
```

Add this line:

```cron
# Run verification snapshot daily at 2 AM UTC
0 2 * * * cd /path/to/BlockSlide && node backend/scripts/run-verification-snapshot.js >> /var/log/blockslide-verification-snapshot.log 2>&1
```

Or with NVM (if using Node Version Manager):

```cron
0 2 * * * source ~/.nvm/nvm.sh && cd /path/to/BlockSlide && node backend/scripts/run-verification-snapshot.js >> /var/log/blockslide-verification-snapshot.log 2>&1
```

### Option 4: PM2 (Daemon Process)

If using PM2 for process management:

```bash
pm2 start backend/scripts/run-verification-snapshot.js --cron "0 2 * * *" --name "verification-snapshot"
pm2 save
```

View logs:
```bash
pm2 logs verification-snapshot
```

### Option 5: Docker Cron Job

Add to your Dockerfile:

```dockerfile
# Install cron
RUN apt-get update && apt-get install -y cron

# Copy cron job
COPY crontab /etc/cron.d/blockslide-cron

# Run cron
CMD cron -f
```

Create `crontab` file:

```
0 2 * * * cd /app && node backend/scripts/run-verification-snapshot.js >> /var/log/verification-snapshot.log 2>&1
```

### Option 6: Backend API Endpoint

Add to your Express/Fastify backend routes:

```typescript
// routes/admin/verification-snapshot.ts
import { Router } from 'express';
import { runVerificationSnapshot, getLatestSnapshot, exportAsCSV } from '../../jobs/verification-snapshot';

const router = Router();

// Middleware: Verify API key or admin token
const requireAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// POST /api/admin/verification-snapshot/run
// Manually trigger snapshot job
router.post('/run', requireAuth, async (req, res) => {
  try {
    const snapshot = await runVerificationSnapshot();
    res.json({ status: 'success', snapshot });
  } catch (err) {
    res.status(500).json({ status: 'error', error: String(err) });
  }
});

// GET /api/admin/verification-snapshot/latest
// Get most recent snapshot
router.get('/latest', requireAuth, async (req, res) => {
  try {
    const snapshot = await getLatestSnapshot();
    res.json({ snapshot });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/admin/verification-snapshot/export
// Export all snapshots as CSV
router.get('/export', requireAuth, async (req, res) => {
  try {
    const csv = await exportAsCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=verification-snapshots.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
```

Usage:

```bash
# Run snapshot manually
curl -X POST http://localhost:3000/api/admin/verification-snapshot/run \
  -H "x-api-key: your-secret-key"

# Get latest snapshot
curl http://localhost:3000/api/admin/verification-snapshot/latest \
  -H "x-api-key: your-secret-key"

# Export as CSV
curl http://localhost:3000/api/admin/verification-snapshot/export \
  -H "x-api-key: your-secret-key" \
  -o snapshots.csv
```

---

## Monitoring

### Check if cron job ran successfully

```bash
# View cron logs (on Linux)
grep CRON /var/log/syslog

# Or check the dedicated log file
tail -f /var/log/blockslide-verification-snapshot.log
```

### Verify snapshot file is being created

```bash
ls -lh backend/data/verification-snapshots/snapshots.json
cat backend/data/verification-snapshots/snapshots.json | tail -1
```

### Check latest snapshot programmatically

```bash
curl http://localhost:3000/api/admin/verification-snapshot/latest \
  -H "x-api-key: your-secret-key" | jq '.'
```

---

## Dune Integration

### Step 1: Export Snapshots

```bash
curl http://localhost:3000/api/admin/verification-snapshot/export \
  -H "x-api-key: your-secret-key" \
  -o verification-snapshots.csv
```

Output format:
```csv
date,total_players,verified_players,verification_rate
2026-08-21,25187,8642,34.33
2026-08-20,25101,8589,34.21
2026-08-19,24998,8521,34.08
...
```

### Step 2: Upload to Dune

1. Go to Dune > Datasets > New Dataset
2. Upload `verification-snapshots.csv`
3. Name: `blockslide_verification_snapshots`
4. Make it public or private per your preference

### Step 3: Reference in Dune Queries

```sql
-- Query 16 from DUNE_DATA_PREPARATION.md
SELECT
  snapshot_date,
  total_players,
  verified_players,
  ROUND(verification_rate, 2) AS verification_percentage
FROM blockslide_verification_snapshots
ORDER BY snapshot_date DESC
LIMIT 30
```

Or set up automated Dune API integration:

```typescript
// Auto-upload to Dune after each snapshot
async function uploadToDuneAPI(snapshot: VerificationSnapshot) {
  const csv = await exportAsCSV();
  
  const response = await fetch('https://api.dune.com/api/v1/table/upload/csv', {
    method: 'POST',
    headers: {
      'X-Dune-API-Key': process.env.DUNE_API_KEY,
      'Content-Type': 'text/csv',
    },
    body: csv,
  });

  if (!response.ok) {
    throw new Error(`Dune upload failed: ${response.status}`);
  }

  console.log('[Verification Snapshot] Uploaded to Dune');
}
```

---

## Troubleshooting

### "No players found in subgraph"
- Verify SUBGRAPH_URL is correct
- Check if subgraph is healthy: `curl {SUBGRAPH_URL}/graphql?query={__schema{types{name}}}`
- Wait for subgraph to index if recently deployed

### "Subgraph HTTP 429" (rate limited)
- The job already batches requests, but if still rate-limited:
- Add delay between batches: Modify `checkWhitelistBatch()` to wait 200ms instead of 100ms
- Contact The Graph to increase rate limit

### "Verification status mismatch"
- Some addresses may fail RPC calls (network issues)
- These default to `isVerified: false` (conservative approach)
- Job logs which addresses failed: `[Verification Snapshot] Error checking batch at index X`

### Cron job not running
- Verify cron service is running: `sudo service cron status`
- Check cron is enabled: `sudo update-rc.d cron enable`
- Ensure log file has write permissions: `touch /var/log/blockslide-verification-snapshot.log && chmod 666 /var/log/blockslide-verification-snapshot.log`

### Memory issues (large player count)
- Current implementation: handles 25k+ players
- If > 50k players: increase `pageSize` in `fetchAllPlayers()` or split into multiple jobs

---

## File Structure

After setup, you should have:

```
BlockSlide/
├── backend/
│   ├── jobs/
│   │   └── verification-snapshot.ts          # Main job implementation
│   ├── scripts/
│   │   └── run-verification-snapshot.js      # CLI wrapper
│   ├── data/
│   │   └── verification-snapshots/
│   │       └── snapshots.json                # Output file (auto-created)
│   ├── setup/
│   │   └── VERIFICATION_SNAPSHOT_SETUP.md    # This file
│   └── routes/
│       └── admin/
│           └── verification-snapshot.ts      # Optional API endpoints
└── DUNE_DATA_PREPARATION.md                  # Dune SQL queries
```

---

## Next Steps

1. ✅ Copy job to `backend/jobs/verification-snapshot.ts`
2. ✅ Set up cron job or API endpoint
3. ✅ Test manually: `npx ts-node backend/jobs/verification-snapshot.ts`
4. ✅ Verify `snapshots.json` is created
5. ✅ Export to Dune as CSV
6. ✅ Add to Dune dashboard using Query 16

You're all set! 🚀

