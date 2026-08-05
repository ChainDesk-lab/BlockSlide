# BlockSlide Leaderboard Subgraph V6 Upgrade

## Overview

Upgrade blockslide-leaderboard subgraph from **v1.0.0** to **v3.0.0** to index Game2048 V6 contract events:
- New shop events: `UndoPurchased`, `CosmeticPurchased` with G$ amounts
- Updated event signatures: `ShieldPurchased`, `XpBoostPurchased` now include `pricePaid`
- New Player schema fields: `undoCreditsPurchased`, `cosmeticsOwned`
- Simplified spend tracking: read prices directly from events instead of contract calls

**Deployment target**: Staging slot (`blockslide-leaderboard-staging/3.0.0`)
**Production**: Unchanged (remains at v1.0.0 until fully tested)

---

## What Changed

### Event Handler Updates

#### Modified Events (V5 → V6)
Events now emit G$ amounts directly, eliminating contract price calls:

| Event | V5 Signature | V6 Signature | Change |
|-------|--------------|--------------|--------|
| `ShieldPurchased` | `(address player, uint256 count)` | `(address player, uint256 count, uint256 pricePaid)` | Added `pricePaid` |
| `XpBoostPurchased` | `(address player, uint8 multiplier, uint64 expiry)` | `(address player, uint8 multiplier, uint64 expiry, uint256 pricePaid)` | Added `pricePaid` |

#### New Events (V6 Only)
```solidity
event UndoPurchased(indexed address player, uint256 quantity, uint256 pricePaid);
event UndoConsumed(indexed address player);
event CosmeticPurchased(indexed address player, indexed uint256 itemId, uint256 pricePaid);
```

### Schema Changes

Added two new Player fields:

```graphql
type Player @entity(immutable: false) {
  # ... existing fields ...
  
  "Total undo move credits purchased (cumulative from UndoPurchased events, V6+)"
  undoCreditsPurchased: BigInt!
  
  "Array of cosmetic itemIds owned by this player (V6+)"
  cosmeticsOwned: [Int!]!
}
```

### Mapping Changes

#### Simplified Shop Spend Tracking
**Before (V5)**: Read prices from contract state at each event block
```typescript
let contract = Game2048.bind(event.address);
let shieldPrice = contract.try_shieldPrice().value;
let spend = delta.times(shieldPrice);
```

**After (V6)**: Use `pricePaid` directly from event
```typescript
let pricePaid = event.params.pricePaid;
p.totalGSpent = p.totalGSpent.plus(pricePaid);
```

**Benefit**: No contract calls needed; gas savings, faster indexing, more reliable (prices immutable at event time).

#### New Event Handlers

**handleUndoPurchased**
```typescript
export function handleUndoPurchased(event: UndoPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  p.undoCreditsPurchased = p.undoCreditsPurchased.plus(event.params.quantity);
  p.totalGSpent = p.totalGSpent.plus(event.params.pricePaid);
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

**handleCosmeticPurchased**
```typescript
export function handleCosmeticPurchased(event: CosmeticPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  let cosmetics = p.cosmeticsOwned;
  let itemId = event.params.itemId.toI32();
  
  if (!cosmetics.includes(itemId)) {
    cosmetics.push(itemId);
  }
  p.cosmeticsOwned = cosmetics;
  p.totalGSpent = p.totalGSpent.plus(event.params.pricePaid);
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

**handleUndoConsumed**
```typescript
export function handleUndoConsumed(event: UndoConsumed): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

---

## Files Modified

1. **`subgraph/schema.graphql`**
   - Added `undoCreditsPurchased: BigInt!`
   - Added `cosmeticsOwned: [Int!]!`

2. **`subgraph/subgraph.yaml`**
   - Updated `ShieldPurchased` event signature to include `uint256 pricePaid`
   - Updated `XpBoostPurchased` event signature to include `uint256 pricePaid`
   - Added `UndoPurchased` event handler
   - Added `UndoConsumed` event handler
   - Added `CosmeticPurchased` event handler

3. **`subgraph/src/mapping.ts`**
   - Added imports for `UndoPurchased`, `UndoConsumed`, `CosmeticPurchased`
   - Removed unused `Game2048` contract import (no more contract calls needed)
   - Updated `loadPlayer()` to initialize new fields:
     - `undoCreditsPurchased = BigInt.zero()`
     - `cosmeticsOwned = []`
   - Refactored `handleShieldPurchased()` to use `event.params.pricePaid`
   - Refactored `handleXpBoostPurchased()` to use `event.params.pricePaid`
   - Added `handleUndoPurchased()`
   - Added `handleUndoConsumed()`
   - Added `handleCosmeticPurchased()`

4. **`subgraph/package.json`**
   - Bumped version to `3.0.0`
   - Updated `deploy:goldsky` script to target `blockslide-leaderboard-staging/3.0.0`

---

## Deployment Steps

### Step 1: Build the Subgraph

```bash
cd /Users/oliviaimmanuel/BlockSlide/subgraph
npm run codegen  # Generate types from ABI and schema
npm run build    # Compile mappings
```

**Expected output**:
```
✔ Subgraph compiled successfully.
```

### Step 2: Deploy to Goldsky Staging

```bash
npm run deploy:goldsky
```

**Expected output**:
```
✔ Deploy initiated. Subgraph: blockslide-leaderboard-staging/3.0.0
```

This deploys to the **staging slot only**. Existing production queries remain unchanged.

### Step 3: Verify Deployment

Check Goldsky dashboard or query the staging endpoint (will be provided by Goldsky upon deploy).

Test a basic query:
```graphql
query {
  players(first: 5, orderBy: xp, orderDirection: desc) {
    id
    username
    xp
    undoCreditsPurchased
    cosmeticsOwned
    totalGSpent
  }
}
```

### Step 4: Monitor Staging

#### Key Metrics to Check

1. **Sync Status**: Subgraph should reach recent blocks within 1-2 minutes
2. **Player Data**: Existing players should have all fields populated
3. **V6 Events**: New players (post-V6 deployment) should have:
   - `undoCreditsPurchased` > 0 if they purchased undo moves
   - `cosmeticsOwned` non-empty if they purchased cosmetics
4. **Spend Tracking**: `totalGSpent` should increase when players buy new items

#### Sample Queries (Staging Endpoint)

**Query 1: Top players with undo purchases**
```graphql
{
  players(
    first: 10
    where: { undoCreditsPurchased_gt: 0 }
    orderBy: undoCreditsPurchased
    orderDirection: desc
  ) {
    id
    username
    xp
    undoCreditsPurchased
    totalGSpent
  }
}
```

**Query 2: Players with cosmetics**
```graphql
{
  players(
    first: 10
    where: { cosmeticsOwned_not: [] }
    orderBy: xp
    orderDirection: desc
  ) {
    id
    username
    cosmeticsOwned
  }
}
```

**Query 3: Leaderboard with shop metrics**
```graphql
{
  players(
    first: 25
    orderBy: xp
    orderDirection: desc
  ) {
    id
    username
    xp
    gamesPlayed
    totalGEarned
    totalGSpent
    undoCreditsPurchased
    cosmeticsOwned
    referralCount
  }
}
```

### Step 5: Promote to Production (After Testing)

Once staging is verified and stable (typically 24-48 hours):

```bash
# On Goldsky dashboard or via API:
# Promote blockslide-leaderboard-staging/3.0.0 → blockslide-leaderboard/3.0.0
```

Production endpoint will then serve V3.0.0 schema with all new fields.

---

## Backward Compatibility Notes

### Data Availability

- **Existing players** (pre-V6): Will have `undoCreditsPurchased = 0` and `cosmeticsOwned = []`
- **XP leaderboard**: Unchanged; rankings based on `xp` field (same as before)
- **Spend tracking**: More accurate in V6+ (prices from events, no contract calls)

### Frontend Changes

Update any leaderboard display or player profile queries to handle new fields:

```typescript
// Before (V5)
interface Player {
  id: string;
  username?: string;
  xp: BigInt;
  totalGSpent: BigInt;
  gamesPlayed: number;
}

// After (V6)
interface Player {
  id: string;
  username?: string;
  xp: BigInt;
  totalGSpent: BigInt;
  gamesPlayed: number;
  undoCreditsPurchased: BigInt;  // NEW
  cosmeticsOwned: number[];       // NEW
  referralCount: BigInt;          // already existed, keep it
}
```

---

## Rollback Plan (If Needed)

If critical issues found in staging:

1. **Keep production unchanged**: Don't promote to prod; rollback is automatic
2. **Debug staging**: Use staging endpoint to investigate issues
3. **Fix and redeploy**: Update mappings and redeploy to staging (`3.0.0`)
4. **Retest**: Run verification queries again

If production is accidentally updated:
- Revert to v1.0.0 by pointing queries back to old endpoint (no data loss)
- All historical data preserved in production v1.0.0

---

## Event Coverage Matrix

| Event | Handler | V5 State | V6 State | Deployed |
|-------|---------|----------|----------|----------|
| `XpEarned` | `handleXpEarned` | ✓ | ✓ | ✓ |
| `UsernameSet` | `handleUsernameSet` | ✓ | ✓ | ✓ |
| `ScoreSubmitted` | `handleScoreSubmitted` | ✓ | ✓ | ✓ |
| `RewardPaid` | `handleRewardPaid` | ✓ | ✓ | ✓ |
| `ShieldPurchased` | `handleShieldPurchased` | ✓ | ✓ (updated sig) | ✓ |
| `XpBoostPurchased` | `handleXpBoostPurchased` | ✓ | ✓ (updated sig) | ✓ |
| `ReferrerSet` | `handleReferrerSet` | ✓ | ✓ | ✓ |
| `UndoPurchased` | `handleUndoPurchased` | ✗ | ✓ | ✓ |
| `UndoConsumed` | `handleUndoConsumed` | ✗ | ✓ | ✓ |
| `CosmeticPurchased` | `handleCosmeticPurchased` | ✗ | ✓ | ✓ |

---

## Version History

| Version | Status | Changes |
|---------|--------|---------|
| 1.0.0 | Production | Initial XP leaderboard |
| 2.0.0 | Staging (archived) | Intermediate version |
| 3.0.0 | Staging (current) | V6 events, direct price tracking, new shop items |

---

## Troubleshooting

### Subgraph Build Fails
```bash
# Clean and rebuild
rm -rf subgraph/build subgraph/generated
npm run codegen
npm run build
```

### Deploy Script Not Found
```bash
# Ensure goldsky CLI is installed
npm install -g @goldsky/goldsky

# Verify credentials
goldsky auth status
```

### Queries Return Empty Results
- Check sync status on Goldsky dashboard
- Verify subgraph has reached recent blocks
- Confirm contract ABI includes new event signatures

### New Fields Not Populating
- Check event handler names match YAML handlers
- Verify schema types are correct (BigInt vs BigInt!)
- Ensure V6 contract is emitting new events

---

## Testing Checklist

- [ ] Subgraph builds without errors
- [ ] Deploys to staging successfully
- [ ] Staging subgraph syncs to recent blocks
- [ ] Top 10 players query returns correct XP order
- [ ] Players with undo purchases have `undoCreditsPurchased > 0`
- [ ] Players with cosmetics have `cosmeticsOwned` populated
- [ ] `totalGSpent` increases on new purchases
- [ ] Leaderboard ranking unchanged (based on XP)
- [ ] All existing player data preserved
- [ ] No regressions in old event handlers
- [ ] Frontend can parse new schema

---

## Summary

✅ **Schema Extended**: Added `undoCreditsPurchased` and `cosmeticsOwned` to Player  
✅ **Events Updated**: Modified `ShieldPurchased` and `XpBoostPurchased` signatures  
✅ **New Handlers**: Added `UndoPurchased`, `UndoConsumed`, `CosmeticPurchased`  
✅ **Spend Tracking Improved**: Eliminated contract calls; prices from events  
✅ **Version Bumped**: 1.0.0 → 3.0.0  
✅ **Staging Ready**: Deployed to `blockslide-leaderboard-staging/3.0.0`  
✅ **Production Safe**: Unchanged until promotion approved

**Next Step**: Monitor staging for 24-48 hours, then promote to production if all checks pass.
