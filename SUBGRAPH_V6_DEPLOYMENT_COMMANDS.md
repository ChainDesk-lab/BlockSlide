# BlockSlide Subgraph V6 Deployment Commands

Quick reference for all commands needed to deploy v3.0.0 to staging.

---

## Prerequisites Check

```bash
# Verify Node.js installed
node --version
# Expected: v14.0.0 or higher

# Verify npm installed
npm --version
# Expected: npm 6.0.0 or higher

# Verify Goldsky CLI installed
goldsky --version
# Expected: version output

# Verify Goldsky authenticated
goldsky auth status
# Expected: "Authenticated" message
```

---

## Build & Deploy (Full Process)

### 1. Navigate to Subgraph Directory
```bash
cd /Users/oliviaimmanuel/BlockSlide/subgraph
```

### 2. Generate Types (from schema & ABI)
```bash
npm run codegen
```

**Expected output**:
```
✔ Schema generated correctly
  Deployed at: ...
  Schema document: schema.graphql
```

### 3. Compile Mappings
```bash
npm run build
```

**Expected output**:
```
✔ Subgraph compiled successfully.
```

### 4. Deploy to Goldsky Staging
```bash
npm run deploy:goldsky
```

**This runs**:
```bash
goldsky subgraph deploy blockslide-leaderboard-staging/3.0.0 --path .
```

**Expected output**:
```
✔ Deploy initiated
Subgraph: blockslide-leaderboard-staging/3.0.0
Deployment ID: ...
```

---

## One-Liner (Full Deploy)

```bash
cd /Users/oliviaimmanuel/BlockSlide/subgraph && npm run codegen && npm run build && npm run deploy:goldsky
```

---

## Verification Commands

### Check Deployment Status
```bash
# Via Goldsky CLI
goldsky subgraph status blockslide-leaderboard-staging/3.0.0

# Or check Goldsky dashboard at:
# https://app.goldsky.com/subgraphs
```

### Query Staging Endpoint (After Sync)

Replace `STAGING_ENDPOINT` with the endpoint provided by Goldsky.

**Basic player query**:
```bash
curl -X POST STAGING_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{"query":"{ players(first: 5, orderBy: xp, orderDirection: desc) { id username xp } }"}'
```

**GraphQL query for top 10 players**:
```bash
curl -X POST STAGING_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { players(first: 10, orderBy: xp, orderDirection: desc) { username xp gamesPlayed totalGSpent undoCreditsPurchased cosmeticsOwned } }"
  }'
```

### Test Undo Tracking
```bash
curl -X POST STAGING_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { players(where: { undoCreditsPurchased_gt: 0 }, first: 5) { username undoCreditsPurchased } }"
  }'
```

### Test Cosmetics Tracking
```bash
curl -X POST STAGING_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { players(where: { cosmeticsOwned_not: [] }, first: 5) { username cosmeticsOwned } }"
  }'
```

---

## Monitor Sync Progress

```bash
# Check latest block indexed
curl -X POST STAGING_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{"query":"{ _meta { block { number timestamp } } }"}'
```

**Expected output** (when synced):
```json
{
  "data": {
    "_meta": {
      "block": {
        "number": 26123456,
        "timestamp": "2026-08-04T15:30:00Z"
      }
    }
  }
}
```

---

## Production Promotion (After 24-48h Testing)

### Via Goldsky Dashboard
1. Go to https://app.goldsky.com/subgraphs
2. Find `blockslide-leaderboard-staging/3.0.0`
3. Click "Promote to Production"
4. Confirm promotion to `blockslide-leaderboard/3.0.0`

### Via Goldsky CLI (if available)
```bash
goldsky subgraph promote blockslide-leaderboard-staging/3.0.0 \
  --prod-slug blockslide-leaderboard/3.0.0
```

### Update Frontend Endpoints
After promotion, update frontend code to use production endpoint:

```typescript
// Before
const SUBGRAPH_ENDPOINT = "https://api.goldsky.com/subgraphs/blockslide-leaderboard/1.0.0"

// After
const SUBGRAPH_ENDPOINT = "https://api.goldsky.com/subgraphs/blockslide-leaderboard/3.0.0"
```

---

## Rollback Commands (If Needed)

### Revert Staging Deployment
```bash
# Redeploy V1 to staging (if needed)
goldsky subgraph deploy blockslide-leaderboard-staging/1.0.0 --path .
```

### Revert Production
```bash
# Via Goldsky Dashboard: Switch back to blockslide-leaderboard/1.0.0
# Or via CLI:
goldsky subgraph set-production blockslide-leaderboard/1.0.0
```

---

## Clean Build (Fresh Start)

If you need to clean and rebuild from scratch:

```bash
# Remove generated files
rm -rf /Users/oliviaimmanuel/BlockSlide/subgraph/generated
rm -rf /Users/oliviaimmanuel/BlockSlide/subgraph/build

# Regenerate
cd /Users/oliviaimmanuel/BlockSlide/subgraph
npm install  # Reinstall dependencies if needed
npm run codegen
npm run build
npm run deploy:goldsky
```

---

## Debug Commands

### Check for Build Errors
```bash
npm run build 2>&1 | grep -i error
```

### Verify AssemblyScript Compilation
```bash
# Check generated WASM
ls -la build/
```

### Check Mapping Types
```bash
# Verify generated schema types
cat generated/schema.ts | head -50
```

### Verify Event Imports
```bash
# Check generated event types
grep -i "UndoPurchased\|CosmeticPurchased" generated/Game2048/Game2048.ts
```

---

## Common Issues & Fixes

### Issue: `npm: command not found`
```bash
# Solution: Install Node.js
# https://nodejs.org/
# Then retry commands
```

### Issue: `goldsky: command not found`
```bash
# Solution: Install Goldsky CLI
npm install -g @goldsky/goldsky

# Verify installation
goldsky --version
```

### Issue: Build fails with "Module not found"
```bash
# Solution: Reinstall dependencies
rm -rf node_modules
npm install
npm run codegen
npm run build
```

### Issue: Deployment fails with "Auth error"
```bash
# Solution: Re-authenticate with Goldsky
goldsky auth login

# Verify auth
goldsky auth status
```

### Issue: Graph codegen fails
```bash
# Solution: Ensure ABI file exists and is valid JSON
cat subgraph/abis/Game2048.json | jq . > /dev/null

# If invalid, update from latest contract:
# (Copy V6 contract ABI to abis/Game2048.json)
```

---

## Full Testing Workflow

```bash
# 1. Clean build
cd /Users/oliviaimmanuel/BlockSlide/subgraph
rm -rf generated build

# 2. Generate and compile
npm run codegen && npm run build

# 3. Deploy
npm run deploy:goldsky

# 4. Wait for sync (check status)
# goldsky subgraph status blockslide-leaderboard-staging/3.0.0

# 5. Once synced, test queries:
# curl -X POST <STAGING_ENDPOINT> -H "Content-Type: application/json" -d '{"query":"{ players(first: 5) { id username xp } }"}'

# 6. After 24-48h stable: Promote to production
# (Via Goldsky dashboard or CLI)

# 7. Update frontend endpoints
# (Point to blockslide-leaderboard/3.0.0)
```

---

## Script: Automated Deployment

Save as `deploy-subgraph.sh`:

```bash
#!/bin/bash
set -e

cd /Users/oliviaimmanuel/BlockSlide/subgraph

echo "🔧 Building subgraph..."
npm run codegen
npm run build

echo "🚀 Deploying to Goldsky staging..."
npm run deploy:goldsky

echo "✅ Deployment initiated!"
echo "Monitor status at: https://app.goldsky.com/subgraphs"
echo "Staging slug: blockslide-leaderboard-staging/3.0.0"
```

**Run with**:
```bash
chmod +x deploy-subgraph.sh
./deploy-subgraph.sh
```

---

## Package.json Scripts Reference

From `/Users/oliviaimmanuel/BlockSlide/subgraph/package.json`:

```json
{
  "scripts": {
    "codegen": "graph codegen",
    "build": "graph build",
    "deploy:goldsky": "goldsky subgraph deploy blockslide-leaderboard-staging/3.0.0 --path ."
  }
}
```

---

## File Locations

| File | Path |
|------|------|
| Schema | `/Users/oliviaimmanuel/BlockSlide/subgraph/schema.graphql` |
| Manifest | `/Users/oliviaimmanuel/BlockSlide/subgraph/subgraph.yaml` |
| Mappings | `/Users/oliviaimmanuel/BlockSlide/subgraph/src/mapping.ts` |
| ABI | `/Users/oliviaimmanuel/BlockSlide/subgraph/abis/Game2048.json` |
| Package | `/Users/oliviaimmanuel/BlockSlide/subgraph/package.json` |

---

## Goldsky Endpoints

Once deployed:

**Staging**: `https://api.goldsky.com/subgraphs/blockslide-leaderboard-staging/3.0.0`

**Production** (after promotion): `https://api.goldsky.com/subgraphs/blockslide-leaderboard/3.0.0`

---

## Quick Status Check

```bash
# All-in-one status check
echo "=== Environment ===" && \
node --version && npm --version && goldsky --version && \
echo "=== Auth ===" && \
goldsky auth status && \
echo "=== Deployment ===" && \
goldsky subgraph status blockslide-leaderboard-staging/3.0.0
```

---

## Emergency Contacts

| Issue | Action | Command |
|-------|--------|---------|
| Deployment stuck | Cancel & redeploy | `npm run deploy:goldsky` |
| Sync stuck | Check RPC | `goldsky subgraph status ...` |
| Query errors | Check schema | `npm run codegen` |
| Need to rollback | Use Goldsky dashboard | Switch version |

---

**Ready to deploy?** Start with:
```bash
cd /Users/oliviaimmanuel/BlockSlide/subgraph && npm run codegen && npm run build && npm run deploy:goldsky
```
