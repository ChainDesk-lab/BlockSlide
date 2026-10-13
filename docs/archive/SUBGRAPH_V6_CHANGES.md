# BlockSlide Leaderboard Subgraph V6 Changes (Quick Reference)

## Summary

Upgraded blockslide-leaderboard from **v1.0.0** to **v3.0.0** to support Game2048 V6 events and shop items.

**Status**: ✅ Ready to deploy to staging  
**Target**: `blockslide-leaderboard-staging/3.0.0`  
**Production**: Unchanged (v1.0.0 remains live)

---

## Files Changed

### 1. `subgraph/schema.graphql`
**Added 2 fields to Player entity:**
```graphql
type Player @entity(immutable: false) {
  # ... existing fields ...
  undoCreditsPurchased: BigInt!      # Total undo credits purchased (V6+)
  cosmeticsOwned: [Int!]!            # Array of cosmetic itemIds owned (V6+)
}
```

### 2. `subgraph/subgraph.yaml`
**Updated event signatures** (now include prices):
- `ShieldPurchased(indexed address,uint256,uint256)` — added `pricePaid`
- `XpBoostPurchased(indexed address,uint8,uint64,uint256)` — added `pricePaid`

**Added 3 new event handlers**:
- `UndoPurchased(indexed address,uint256,uint256)` → handleUndoPurchased
- `UndoConsumed(indexed address)` → handleUndoConsumed
- `CosmeticPurchased(indexed address,indexed uint256,uint256)` → handleCosmeticPurchased

### 3. `subgraph/src/mapping.ts`
**Removed**: Game2048 contract import (no more contract calls)

**Updated `loadPlayer()`**:
```typescript
p.undoCreditsPurchased = BigInt.zero();
p.cosmeticsOwned = [];
```

**Refactored 2 handlers** (use `pricePaid` from events):
- `handleShieldPurchased()` — now reads `event.params.pricePaid` directly
- `handleXpBoostPurchased()` — now reads `event.params.pricePaid` directly

**Added 3 new handlers**:
- `handleUndoPurchased()` — tracks undo credit purchases
- `handleUndoConsumed()` — tracks undo consumption (updates timestamp)
- `handleCosmeticPurchased()` — tracks cosmetic ownership + spend

### 4. `subgraph/package.json`
```json
{
  "version": "3.0.0",
  "scripts": {
    "deploy:goldsky": "goldsky subgraph deploy blockslide-leaderboard-staging/3.0.0 --path ."
  }
}
```

---

## Key Improvements

| Aspect | Before (V1) | After (V3) | Benefit |
|--------|------------|-----------|---------|
| Shop spend tracking | Read prices from contract | Read `pricePaid` from event | No contract calls; faster & more reliable |
| Shield purchases | Tracked via count delta | Tracked with exact amount | Cleaner logic; fewer assumptions |
| XP boosts | Required multiplier parsing | Direct price from event | Simpler; works with any multiplier |
| Undo moves | Not indexed | Full tracking | Players can see their undo purchase history |
| Cosmetics | Not indexed | Tracked by itemId | Ownership queryable by player & item |

---

## Deployment

### Build & Deploy to Staging
```bash
cd /Users/oliviaimmanuel/BlockSlide/subgraph
npm run codegen  # Generate types
npm run build    # Compile
npm run deploy:goldsky  # Deploy to blockslide-leaderboard-staging/3.0.0
```

### Verify Staging
```graphql
query {
  players(first: 5, orderBy: xp, orderDirection: desc) {
    id
    username
    xp
    totalGSpent
    undoCreditsPurchased
    cosmeticsOwned
  }
}
```

### Promote to Production (After 24-48h Testing)
```
Goldsky Dashboard → blockslide-leaderboard-staging/3.0.0 → Promote → Production
```

---

## Testing Checklist

- [ ] `npm run build` succeeds without errors
- [ ] `npm run deploy:goldsky` completes successfully
- [ ] Staging endpoint syncs to recent blocks
- [ ] Old events (XpEarned, ScoreSubmitted) still indexed
- [ ] New players have `undoCreditsPurchased > 0` after buying undo
- [ ] New players have `cosmeticsOwned` non-empty after buying cosmetics
- [ ] `totalGSpent` reflects all shop purchases
- [ ] XP leaderboard ranking unchanged
- [ ] No query errors; all Player fields queryable
- [ ] Frontend can handle new schema fields

---

## Query Examples (After Promotion)

**Top spenders:**
```graphql
{
  players(first: 10, orderBy: totalGSpent, orderDirection: desc) {
    username
    xp
    totalGSpent
    undoCreditsPurchased
    cosmeticsOwned
  }
}
```

**Players with cosmetics:**
```graphql
{
  players(where: { cosmeticsOwned_not: [] }, orderBy: xp, orderDirection: desc) {
    username
    cosmeticsOwned
  }
}
```

**Leaderboard with shop data:**
```graphql
{
  players(first: 100, orderBy: xp, orderDirection: desc) {
    id
    username
    xp
    gamesPlayed
    bestScore
    totalGEarned
    totalGSpent
    undoCreditsPurchased
    cosmeticsOwned
    referralCount
  }
}
```

---

## Rollback (If Needed)

No action required:
- Production remains on v1.0.0 until explicitly promoted
- Staging queries use staging endpoint
- Historical data untouched

If production requires rollback after promotion:
- Keep pointing frontend to v1.0.0 endpoint
- Revert deployment reference in Goldsky dashboard

---

## Backwards Compatibility

✅ **Existing leaderboard queries**: Work unchanged  
✅ **Player XP rankings**: Same logic (based on cumulative `xp`)  
✅ **Shop spend tracking**: More accurate in V6 (prices from events, not contract calls)  
✅ **Old players**: `undoCreditsPurchased = 0`, `cosmeticsOwned = []` (unless they buy new items)  
✅ **New fields optional**: Frontend can safely ignore new fields if not needed yet

---

## Summary Table

| Change | Type | Impact | Status |
|--------|------|--------|--------|
| Price tracking | Mapping refactor | Eliminates contract calls | ✅ Complete |
| Undo move indexing | New handler | Tracks consumable purchases | ✅ Complete |
| Cosmetic ownership | New handler | Tracks item ownership | ✅ Complete |
| Schema update | Entity extension | New queryable fields | ✅ Complete |
| Event signatures | Mapping update | Events now include prices | ✅ Complete |
| Version bump | Metadata | 1.0.0 → 3.0.0 | ✅ Complete |

**Status**: 🚀 Ready for staging deployment
