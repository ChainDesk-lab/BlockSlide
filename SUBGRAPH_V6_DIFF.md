# BlockSlide Subgraph V1 → V3 Code Diff

## Schema Changes

### Before (V1)
```graphql
type Player @entity(immutable: false) {
  id: Bytes!
  xp: BigInt!
  username: String
  bestScore: BigInt!
  gamesPlayed: Int!
  isVerified: Boolean!
  firstSeen: BigInt!
  lastUpdated: BigInt!
  totalGEarned: BigInt!
  totalGSpent: BigInt!
  lastShieldCount: BigInt!
  referredBy: Bytes
  referralCount: BigInt!
}
```

### After (V3)
```graphql
type Player @entity(immutable: false) {
  id: Bytes!
  xp: BigInt!
  username: String
  bestScore: BigInt!
  gamesPlayed: Int!
  isVerified: Boolean!
  firstSeen: BigInt!
  lastUpdated: BigInt!
  totalGEarned: BigInt!
  totalGSpent: BigInt!
  lastShieldCount: BigInt!
  referredBy: Bytes
  referralCount: BigInt!
  undoCreditsPurchased: BigInt!              # NEW
  cosmeticsOwned: [Int!]!                    # NEW
}
```

---

## Event Handler Signatures

### Updated Events (V1 → V3)

#### ShieldPurchased
**V1**:
```yaml
- event: ShieldPurchased(indexed address,uint256)
  handler: handleShieldPurchased
```

**V3**:
```yaml
- event: ShieldPurchased(indexed address,uint256,uint256)
  handler: handleShieldPurchased
```

#### XpBoostPurchased
**V1**:
```yaml
- event: XpBoostPurchased(indexed address,uint8,uint64)
  handler: handleXpBoostPurchased
```

**V3**:
```yaml
- event: XpBoostPurchased(indexed address,uint8,uint64,uint256)
  handler: handleXpBoostPurchased
```

### New Events (V3 Only)

```yaml
- event: UndoPurchased(indexed address,uint256,uint256)
  handler: handleUndoPurchased
- event: UndoConsumed(indexed address)
  handler: handleUndoConsumed
- event: CosmeticPurchased(indexed address,indexed uint256,uint256)
  handler: handleCosmeticPurchased
```

---

## Mapping Changes

### Imports

**V1**:
```typescript
import {
  XpEarned,
  UsernameSet,
  ScoreSubmitted,
  RewardPaid,
  ShieldPurchased,
  XpBoostPurchased,
  ReferrerSet,
  Game2048,  // REMOVED IN V3
} from "../generated/Game2048/Game2048";
```

**V3**:
```typescript
import {
  XpEarned,
  UsernameSet,
  ScoreSubmitted,
  RewardPaid,
  ShieldPurchased,
  XpBoostPurchased,
  ReferrerSet,
  UndoPurchased,       // NEW
  UndoConsumed,        // NEW
  CosmeticPurchased,   // NEW
} from "../generated/Game2048/Game2048";
```

### loadPlayer Function

**V1**:
```typescript
function loadPlayer(addr: Address, ts: BigInt): Player {
  let p = Player.load(addr);
  if (p == null) {
    p = new Player(addr);
    p.xp = BigInt.zero();
    p.bestScore = BigInt.zero();
    p.gamesPlayed = 0;
    p.isVerified = false;
    p.firstSeen = ts;
    p.lastUpdated = ts;
    p.totalGEarned = BigInt.zero();
    p.totalGSpent = BigInt.zero();
    p.lastShieldCount = BigInt.zero();
    p.referralCount = BigInt.zero();
  }
  return p as Player;
}
```

**V3**:
```typescript
function loadPlayer(addr: Address, ts: BigInt): Player {
  let p = Player.load(addr);
  if (p == null) {
    p = new Player(addr);
    p.xp = BigInt.zero();
    p.bestScore = BigInt.zero();
    p.gamesPlayed = 0;
    p.isVerified = false;
    p.firstSeen = ts;
    p.lastUpdated = ts;
    p.totalGEarned = BigInt.zero();
    p.totalGSpent = BigInt.zero();
    p.lastShieldCount = BigInt.zero();
    p.referralCount = BigInt.zero();
    p.undoCreditsPurchased = BigInt.zero();  // NEW
    p.cosmeticsOwned = [];                   // NEW
  }
  return p as Player;
}
```

### handleShieldPurchased

**V1** (reads price from contract):
```typescript
export function handleShieldPurchased(event: ShieldPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // Calculate delta: the quantity purchased is the difference from last seen count
  let delta = event.params.count.minus(p.lastShieldCount);

  // Read shield price from contract at the event block
  let contract = Game2048.bind(event.address);
  let shieldPrice: BigInt;
  let priceCall = contract.try_shieldPrice();
  if (priceCall.reverted) {
    shieldPrice = BigInt.zero();
  } else {
    shieldPrice = priceCall.value;
  }

  // Add delta * price to totalGSpent
  let spend = delta.times(shieldPrice);
  p.totalGSpent = p.totalGSpent.plus(spend);

  // Update last seen count
  p.lastShieldCount = event.params.count;
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

**V3** (reads price from event):
```typescript
export function handleShieldPurchased(event: ShieldPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // In V6+, pricePaid is emitted directly in the event
  let pricePaid = event.params.pricePaid;

  // Add total price paid to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(pricePaid);

  // Update last seen count
  p.lastShieldCount = event.params.count;
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

**Difference**: Eliminated contract call; use event parameter directly.

### handleXpBoostPurchased

**V1** (reads price from contract based on multiplier):
```typescript
export function handleXpBoostPurchased(event: XpBoostPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // Read boost price from contract, selected by multiplier
  let contract = Game2048.bind(event.address);
  let boostPrice: BigInt;

  let multiplier = event.params.multiplier;
  if (multiplier == 2) {
    let priceCall = contract.try_boost2xPrice();
    if (priceCall.reverted) {
      boostPrice = BigInt.zero();
    } else {
      boostPrice = priceCall.value;
    }
  } else if (multiplier == 5) {
    let priceCall = contract.try_boost5xPrice();
    if (priceCall.reverted) {
      boostPrice = BigInt.zero();
    } else {
      boostPrice = priceCall.value;
    }
  } else {
    boostPrice = BigInt.zero();
  }

  // Add price to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(boostPrice);
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

**V3** (reads price from event):
```typescript
export function handleXpBoostPurchased(event: XpBoostPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // In V6+, pricePaid is emitted directly in the event
  let pricePaid = event.params.pricePaid;

  // Add price to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(pricePaid);
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

**Difference**: Eliminated multiplier parsing and contract call; use event parameter.

### New Handlers (V3 Only)

**handleUndoPurchased**:
```typescript
export function handleUndoPurchased(event: UndoPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // Add quantity to total undo credits purchased
  p.undoCreditsPurchased = p.undoCreditsPurchased.plus(event.params.quantity);

  // Add total amount paid to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(event.params.pricePaid);
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

**handleUndoConsumed**:
```typescript
export function handleUndoConsumed(event: UndoConsumed): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

**handleCosmeticPurchased**:
```typescript
export function handleCosmeticPurchased(event: CosmeticPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // Track cosmetic ownership
  let cosmetics = p.cosmeticsOwned;
  let itemId = event.params.itemId.toI32();

  // Add itemId if not already owned
  if (!cosmetics.includes(itemId)) {
    cosmetics.push(itemId);
  }
  p.cosmeticsOwned = cosmetics;

  // Add amount paid to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(event.params.pricePaid);
  p.lastUpdated = event.block.timestamp;
  p.save();
}
```

---

## Package.json Changes

**V1**:
```json
{
  "version": "1.0.0",
  "scripts": {
    "deploy:goldsky": "goldsky subgraph deploy blockslide-leaderboard-staging/2.0.0 --path ."
  }
}
```

**V3**:
```json
{
  "version": "3.0.0",
  "scripts": {
    "deploy:goldsky": "goldsky subgraph deploy blockslide-leaderboard-staging/3.0.0 --path ."
  }
}
```

---

## Summary of Changes

| Component | V1 | V3 | Change Type | Reason |
|-----------|----|----|-------------|--------|
| Schema fields | 14 | 16 | +2 fields | Support V6 shop items |
| Event handlers | 7 | 10 | +3 handlers | Index new V6 events |
| Contract calls | 2 | 0 | -2 calls | Prices now in events |
| Import statements | 8 | 11 | +3 imports | New event types |
| Lines of code | ~100 | ~150 | +50 LOC | New handlers & fields |

---

## Migration Impact

| Scenario | Impact | Notes |
|----------|--------|-------|
| Old players | No change | `undoCreditsPurchased = 0`, `cosmeticsOwned = []` |
| New players (V6) | Full tracking | All new shop items indexed from day 1 |
| Leaderboard | No change | Ranking still by XP (unchanged logic) |
| Shop spend | More accurate | Prices from events, no approximation |
| Contract calls | Eliminated | Faster sync; no state reads needed |

---

## Breaking Changes

**None for queries**: All old queries continue to work.

**For consumers**: 
- New optional fields available in Player queries
- Frontend can ignore them if not needed yet
- No required changes to existing leaderboard code

**For production deployment**:
- Deploy to staging first (blockslide-leaderboard-staging/3.0.0)
- Test for 24-48 hours
- Promote to production only after validation
- Production endpoint will switch to V3 schema when promoted
