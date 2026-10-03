# Game2048 V5 → V6 Detailed Diff

## Contract Constants

```diff
- uint256 public constant BOOST_DURATION  = 24 hours;
+ uint256 public constant BOOST_DURATION_V6  = 5 hours;
```

## Storage Variables (Appended at End)

```diff
  // ─── Referral state (appended in V5 — keep at end for UUPS layout safety) ──
  mapping(address => address) public referrerOf;
  mapping(address => uint256) public referralCount;
+
+  // ─── V6: New shop items — appended after referral state ─────────────────────
+  mapping(address => uint256) public undoCredits;
+  uint256 public undoPrice;
+  mapping(uint256 => CosmeticItem) public cosmeticCatalog;
+  mapping(address => mapping(uint256 => bool)) public cosmeticsOwned;
```

## Structs

```diff
  struct XpBoost {
    uint8  multiplier;
    uint64 expiry;
  }
+
+  struct CosmeticItem {
+    uint256 price;
+    bool    exists;
+  }
```

## Events

```diff
  event ShieldPurchased(address indexed player, uint256 count);
- event XpBoostPurchased(address indexed player, uint8 multiplier, uint64 expiry);
+ event XpBoostPurchased(address indexed player, uint8 multiplier, uint64 expiry, uint256 pricePaid);

+ event UndoPurchased(address indexed player, uint256 quantity, uint256 pricePaid);
+ event UndoConsumed(address indexed player);
+ event CosmeticPurchased(address indexed player, uint256 indexed itemId, uint256 pricePaid);
  
- event ShopPricesUpdated(uint256 shield, uint256 boost2x, uint256 boost5x);
+ event ShopPricesUpdated(uint256 shield, uint256 boost2x, uint256 boost5x, uint256 undo);
+
+ event CosmeticCatalogUpdated(uint256 indexed itemId, uint256 price, bool exists);
```

## Errors

```diff
+ error ZeroPriceNotAllowed();
+ error CosmeticDoesNotExist();
+ error InsufficientUndoCredits();
+ error ReferrerAlreadySet();
+ error CannotReferSelf();
+ error InvalidReferrer();
```

## Critical Function Changes

### submitScore() - Verification Gate Repositioned

**V5:**
```solidity
function submitScore(uint256 score, uint32 highestTile, uint256 moveCount, bytes32 seed, uint256 comboMoves) external {
    if (!identity.isWhitelisted(msg.sender)) revert NotVerifiedHuman();  // ← GATE HERE
    // ... rest of function
}
```

**V6:**
```solidity
function submitScore(uint256 score, uint32 highestTile, uint256 moveCount, bytes32 seed, uint256 comboMoves) external {
    // NO verification check — anyone can submit
    // ... rest of function
}

function _payMilestoneRewards(uint32 highestTile) internal {
    if (!identity.isWhitelisted(msg.sender)) return;  // ← GATE MOVED HERE
    // Only verified players receive G$ rewards
}
```

**Impact**: Unverified players can now submit scores and earn XP, but don't receive G$ milestone rewards.

### buyXpBoost() - Duration Changed

**V5:**
```solidity
function buyXpBoost(uint8 multiplier) external {
    uint256 price = multiplier == 2 ? boost2xPrice : boost5xPrice;
    gDollar.transferFrom(msg.sender, address(this), price);
-   uint64 expiry = uint64(block.timestamp + BOOST_DURATION);  // 24 hours
    xpBoost[msg.sender] = XpBoost({ multiplier: multiplier, expiry: expiry });
    emit XpBoostPurchased(msg.sender, multiplier, expiry);  // No price!
}
```

**V6:**
```solidity
function buyXpBoost(uint8 multiplier) external {
    if (multiplier != 2 && multiplier != 5) revert InvalidBoostMultiplier();
    uint256 price = multiplier == 2 ? boost2xPrice : boost5xPrice;
+   if (price == 0) revert ZeroPriceNotAllowed();  // NEW GUARD
    gDollar.transferFrom(msg.sender, address(this), price);
+   uint64 expiry = uint64(block.timestamp + BOOST_DURATION_V6);  // 5 hours
    xpBoost[msg.sender] = XpBoost({ multiplier: multiplier, expiry: expiry });
+   emit XpBoostPurchased(msg.sender, multiplier, expiry, price);  // NEW: includes price
}
```

### buyStreakShield() - Price Guard Added

**V5:**
```solidity
function buyStreakShield() external {
    gDollar.transferFrom(msg.sender, address(this), shieldPrice);
    uint256 count = ++shieldCount[msg.sender];
    emit ShieldPurchased(msg.sender, count);
}
```

**V6:**
```solidity
function buyStreakShield() external {
+   if (shieldPrice == 0) revert ZeroPriceNotAllowed();  // NEW GUARD
    gDollar.transferFrom(msg.sender, address(this), shieldPrice);
    uint256 count = ++shieldCount[msg.sender];
+   emit ShieldPurchased(msg.sender, count, shieldPrice);  // NEW: includes price
}
```

## New Functions (V6 Only)

### buyUndoMove()
```solidity
function buyUndoMove(uint256 quantity) external {
    if (quantity == 0) revert("Quantity must be > 0");
    if (undoPrice == 0) revert ZeroPriceNotAllowed();
    uint256 totalCost = undoPrice * quantity;
    gDollar.transferFrom(msg.sender, address(this), totalCost);
    undoCredits[msg.sender] += quantity;
    emit UndoPurchased(msg.sender, quantity, totalCost);
}
```

### consumeUndo()
```solidity
function consumeUndo(address player) external {
    if (undoCredits[player] == 0) revert InsufficientUndoCredits();
    undoCredits[player]--;
    emit UndoConsumed(player);
}
```

### buyCosmetic()
```solidity
function buyCosmetic(uint256 itemId) external {
    CosmeticItem storage item = cosmeticCatalog[itemId];
    if (!item.exists) revert CosmeticDoesNotExist();
    if (item.price == 0) revert ZeroPriceNotAllowed();
    gDollar.transferFrom(msg.sender, address(this), item.price);
    cosmeticsOwned[msg.sender][itemId] = true;
    emit CosmeticPurchased(msg.sender, itemId, item.price);
}
```

### setCosmeticPrice() / removeCosmeticItem()
```solidity
function setCosmeticPrice(uint256 itemId, uint256 price) external onlyOwner {
    if (price == 0) revert ZeroPriceNotAllowed();
    cosmeticCatalog[itemId] = CosmeticItem({ price: price, exists: true });
    emit CosmeticCatalogUpdated(itemId, price, true);
}

function removeCosmeticItem(uint256 itemId) external onlyOwner {
    delete cosmeticCatalog[itemId];
    emit CosmeticCatalogUpdated(itemId, 0, false);
}
```

### getCosmeticItem() / getCosmeticsOwned()
```solidity
function getCosmeticItem(uint256 itemId) external view returns (CosmeticItem memory) {
    return cosmeticCatalog[itemId];
}

function getCosmeticsOwned(address player, uint256[] calldata itemIds)
    external view returns (bool[] memory owned) {
    owned = new bool[](itemIds.length);
    for (uint256 i = 0; i < itemIds.length; i++) {
        owned[i] = cosmeticsOwned[player][itemIds[i]];
    }
}
```

## Modified Owner Functions

### setShopPrices()

**V5:**
```solidity
function setShopPrices(uint256 _shieldPrice, uint256 _boost2xPrice, uint256 _boost5xPrice)
    external onlyOwner {
    shieldPrice  = _shieldPrice;
    boost2xPrice = _boost2xPrice;
    boost5xPrice = _boost5xPrice;
    emit ShopPricesUpdated(_shieldPrice, _boost2xPrice, _boost5xPrice);
}
```

**V6:**
```solidity
function setShopPrices(
    uint256 _shieldPrice,
    uint256 _boost2xPrice,
    uint256 _boost5xPrice,
    uint256 _undoPrice  // NEW parameter
) external onlyOwner {
    shieldPrice  = _shieldPrice;
    boost2xPrice = _boost2xPrice;
    boost5xPrice = _boost5xPrice;
    undoPrice    = _undoPrice;
    emit ShopPricesUpdated(_shieldPrice, _boost2xPrice, _boost5xPrice, _undoPrice);
}
```

## Lines of Code Comparison

| Aspect | V5 | V6 | Delta |
|--------|----|----|-------|
| Total LOC | ~518 | ~848 | +330 (+64%) |
| Shop functions | 2 | 4 | +2 |
| Cosmetics management | 0 | 3 (setCosmeticPrice, removeCosmeticItem, getCosmeticItem, getCosmeticsOwned) | +4 |
| Events | 10 | 14 | +4 |
| Storage mappings | 18 | 22 | +4 |
| Errors | 8 | 14 | +6 |

## Backward Compatibility Summary

| Feature | V5 | V6 | Breaking? |
|---------|----|----|-----------|
| Score submission | Verification required | No verification required | ✓ Breaking in scope |
| G$ rewards | Awarded if verified | Awarded if verified | ✓ Compatible |
| XP tracking | Tracked for all | Tracked for all | ✓ Compatible |
| Streak shields | 24h duration via constant | 24h duration via constant | ✓ Compatible |
| XP boosts | 24h duration | **5h duration** | ✓ Breaking in behavior |
| Shop events | No price emitted | Price emitted | ✓ Breaking in events |
| Shop prices | 3 prices | 4 prices | ✓ Breaking in function signature |
| Leaderboard | All submitters | All submitters | ✓ Compatible |
| Usernames | Same logic | Same logic | ✓ Compatible |
| Referrals | Same logic | Same logic | ✓ Compatible |

## Breaking Changes Summary

1. **Verification Gate Moved**: Score submission no longer requires verification. XP is earned by all; G$ only for verified. This is intentional and documented.

2. **XP Boost Duration**: Changed from 24 hours to 5 hours. Existing boosts don't change; only new purchases use new duration.

3. **Event Signatures**: `ShieldPurchased`, `XpBoostPurchased`, and `ShopPricesUpdated` now include price information. Requires frontend log parsing updates.

4. **setShopPrices() Signature**: Now requires 4 parameters instead of 3 (added undoPrice). Owner function calls must be updated.

## Migration Checklist

- [x] V6 contract written with all features
- [x] Storage layout preserved (no existing variables relocated)
- [x] Comprehensive upgrade tests (storage, features, guards)
- [x] Deployment module (Game2048V6Upgrade.ts)
- [x] Event enhancements (prices included)
- [x] Zero-price guards on all functions
- [x] Verification gate repositioning (documented)
- [ ] Frontend event parsing updates (owner task)
- [ ] Cosmetics catalog initial data (owner task post-deploy)
- [ ] Testing on testnet before mainnet (owner task)
