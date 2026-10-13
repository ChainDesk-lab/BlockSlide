# BlockSlide Dune Analytics — Quick Start

Complete guide to set up your Game2048 analytics dashboard on Dune.

---

## 📋 What You Have

**3 complete documents:**

1. **DUNE_DATA_PREPARATION.md** — Complete reference with:
   - Task 1: Identity contract event analysis
   - Task 2: Verification snapshot job code
   - Task 3: 16 ready-to-paste SQL queries

2. **backend/jobs/verification-snapshot.ts** — Production-ready job that:
   - Fetches all players from subgraph daily
   - Checks `isWhitelisted()` for each address
   - Stores snapshots with verification stats
   - Exports to CSV for Dune

3. **VERIFICATION_SNAPSHOT_SETUP.md** — Installation guide with:
   - 6 ways to run the job (manual, cron, Docker, API, PM2, etc.)
   - Monitoring & debugging
   - Dune integration steps

---

## 🚀 Quick Setup (5 Steps)

### Step 1: Copy Job to Backend
```bash
mkdir -p backend/data/verification-snapshots
# Copy verification-snapshot.ts to backend/jobs/
```

### Step 2: Run Test
```bash
npm install viem
npx ts-node backend/jobs/verification-snapshot.ts
```

Expected output: Shows player counts, verification rate, and creates `snapshots.json`

### Step 3: Set Up Cron Job (Daily at 2 AM UTC)
```bash
crontab -e
# Add: 0 2 * * * cd /path/to/BlockSlide && node backend/scripts/run-verification-snapshot.js
```

### Step 4: Export to Dune
```bash
# Get the CSV file
node backend/scripts/run-verification-snapshot.js
cat backend/data/verification-snapshots/snapshots.json | node -e "console.log(...)" > export.csv
```

### Step 5: Add Queries to Dune
1. Log into Dune.com
2. Create new queries using the 16 SQL blocks from `DUNE_DATA_PREPARATION.md`
3. Reference verification snapshots table in Query 16

---

## 📊 What You Get

### Key Metrics (automated daily)
- ✅ Total verified users (from snapshot job)
- ✅ Daily/Weekly/Monthly active users
- ✅ Total XP distributed
- ✅ Total G$ paid out
- ✅ On-chain transaction volume
- ✅ Top 50 earners by G$ rewards
- ✅ Top players by XP
- ✅ Game session trends
- ✅ Score submission stats
- ✅ Verification rate trend

### Dashboard Sections (from reorganization guide)
1. **Key Metrics** — 6 cards with top-line numbers
2. **Player Engagement** — DAU, WAU, MAU trends
3. **Rewards & Economics** — G$ distribution, UBI pool health
4. **On-Chain Activity** — Transaction volume, sessions, scores
5. **Verification & Identity** — Verified user counts & trend
6. **Gameplay Metrics** — XP distribution, score trends
7. **Leaderboards** — Top earners, top by XP

---

## 🔧 Configuration

### Environment Variables (.env)
```env
SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/blockslide/game2048
ADMIN_API_KEY=your-secret-key  # For manual API endpoint
```

### Contracts
- **Game2048:** `0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6` (Celo Mainnet)
- **Identity:** `0xc361a6e67822a0edc17d899227dd9fc50bd62f42` (Celo Mainnet)

---

## 📈 Data Flow

```
Subgraph (all players)
         ↓
Verification Job (runs daily at 2 AM)
         ↓
Snapshots JSON (backend/data/verification-snapshots/)
         ↓
Export as CSV (for Dune upload)
         ↓
Dune Table (blockslide_verification_snapshots)
         ↓
Dashboard Query 16 (verification trend)
         ↓
Dune Dashboard (displays all metrics)
```

---

## ✅ Verification Checklist

- [ ] Job copied to `backend/jobs/verification-snapshot.ts`
- [ ] Test run successful: `npx ts-node backend/jobs/verification-snapshot.ts`
- [ ] `snapshots.json` created with data
- [ ] Cron job added to system: `crontab -e`
- [ ] First daily snapshot runs at scheduled time
- [ ] CSV exported from `snapshots.json`
- [ ] Dune dataset created: `blockslide_verification_snapshots`
- [ ] All 16 SQL queries added to Dune
- [ ] Dashboard visualizations created
- [ ] Dashboard organized into sections (per reorganization guide)

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| "No players found" | Check SUBGRAPH_URL is valid and subgraph is synced |
| Job takes > 10 min | Normal for 25k+ players; can be optimized later |
| Cron doesn't run | Check: `sudo service cron status`, `crontab -l`, log file exists |
| Dune queries timeout | Add `AND block_time >= CURRENT_DATE - INTERVAL '30 days'` to query |
| RPC rate limit errors | Already handled with batching & delays in job |

---

## 📚 File Reference

| File | Purpose |
|------|---------|
| `backend/jobs/verification-snapshot.ts` | Main job with player check logic |
| `backend/scripts/run-verification-snapshot.js` | CLI wrapper for cron/PM2 |
| `backend/data/verification-snapshots/snapshots.json` | Output data (auto-created daily) |
| `VERIFICATION_SNAPSHOT_SETUP.md` | Detailed setup instructions |
| `DUNE_DATA_PREPARATION.md` | Complete reference: events, job, 16 queries |
| `DUNE_DASHBOARD_REORGANIZATION_GUIDE.md` | Dashboard layout & structure |
| `DUNE_QUICKSTART.md` | This file |

---

## 🎯 Next: Dune Dashboard Organization

After queries are added, follow the dashboard reorganization guide:

1. **Group queries into sections** (Engagement, Rewards, Activity, etc.)
2. **Choose visualizations** per metric (number cards, line charts, tables)
3. **Arrange layout** (3-column for numbers, 2-column for charts)
4. **Add colors & styling** (match FocusPets aesthetic)
5. **Set refresh intervals** (2-6 hours depending on metric type)

---

## 💡 Pro Tips

- **Test query first:** Dune has a "Run" button to test SQL before saving
- **Date filters:** Use `CURRENT_DATE - INTERVAL '30 days'` for performance
- **Sorting:** Query results can be sorted by clicking column headers
- **Cache:** Dune caches results, so 2-4 hour refresh is typical
- **Alerts:** Set up Dune alerts if verification rate drops below threshold
- **Export:** All queries can be exported as CSV from Dune UI

---

## 📞 Support

For issues:
1. Check logs: `tail -f /var/log/blockslide-verification-snapshot.log`
2. Verify job file: `ls -lh backend/data/verification-snapshots/`
3. Test RPC: `curl https://forno.celo.org -X POST -d '{"jsonrpc":"2.0","id":1,"method":"web3_clientVersion"}'`
4. Test subgraph: `curl -X POST SUBGRAPH_URL -d '{"query":"{ players(first:1) { id } }"}'`

---

## 🎉 You're All Set!

Your BlockSlide analytics dashboard is ready to track:
- Player engagement trends
- Verification adoption rates
- Reward distribution metrics
- On-chain activity
- Top earners & gameplay patterns

**Total setup time:** ~30 minutes (including test & verification)

**Daily data freshness:** Snapshots update at 2 AM UTC (can be adjusted)

**Dashboard readiness:** Use within 24 hours of first job run (1 day of data needed for trends)

---

Questions? Check:
- `DUNE_DATA_PREPARATION.md` — Detailed explanations & SQL
- `VERIFICATION_SNAPSHOT_SETUP.md` — Installation help
- `DUNE_DASHBOARD_REORGANIZATION_GUIDE.md` — Dashboard design

Happy analyzing! 📊

