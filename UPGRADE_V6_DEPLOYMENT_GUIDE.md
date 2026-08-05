# Game2048 V6 Deployment Guide

## Pre-Deployment Checklist

- [ ] All tests pass on local network
- [ ] V6 implementation compiled successfully
- [ ] Proxy owner account has sufficient CELO for gas
- [ ] Existing V5 state backed up (leaderboard, players, etc.)
- [ ] Deployment team reviewed all changes in UPGRADE_V6_DIFF.md
- [ ] Frontend team ready for event parsing updates
- [ ] Social media team notified of XP boost duration change

## Deployment Steps

### 1. Compile the Contract

```bash
cd /Users/oliviaimmanuel/BlockSlide
npx hardhat compile
```

**Expected output**: Game2048V6 compiled successfully

### 2. Run Local Tests (Optional but Recommended)

```bash
# If using hardhat's test runner with forge-std remapped:
npx hardhat test contracts/Game2048V6.upgrade.t.sol

# Or using forge directly (if installed):
forge test --match-contract Game2048V6UpgradeTest -vv
```

**Expected outcome**: All upgrade tests pass
- Storage layout preservation: ✓
- XP boost duration: ✓
- Shop events with prices: ✓
- Undo move functionality: ✓
- Cosmetics catalog: ✓
- Zero-price guards: ✓
- Verification gate repositioning: ✓

### 3. Deploy to Testnet (Celo Alfajores)

**Option A: Using Ignition (Recommended)**

```bash
npx hardhat ignition deploy ./ignition/modules/Game2048V6Upgrade.ts \
  --network celo-alfajores \
  --verify \
  --artifact-dir artifacts
```

**Option B: Manual Deployment (If Ignition unavailable)**

```bash
# 1. Deploy V6 implementation
IMPLEMENTATION=$(cast create6 \
  contracts/Game2048V6.sol:Game2048V6 \
  --legacy \
  --from $OWNER_ADDRESS \
  --rpc-url https://alfajores-forno.celo-testnet.org)

# 2. Upgrade proxy
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "upgradeToAndCall(address,bytes)" \
  "$IMPLEMENTATION" \
  0x \
  --from $OWNER_ADDRESS \
  --legacy \
  --rpc-url https://alfajores-forno.celo-testnet.org
```

**Expected output**: Deployment transaction hash, e.g., `0x1234...`

### 4. Verify Upgrade Success (Testnet)

```bash
# Check implementation pointer changed
cast storage 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  0x360894a13ba1a3210667c828492db98dca3e2848cc3735a19cf27b5a7b407340 \
  --rpc-url https://alfajores-forno.celo-testnet.org

# Should output new implementation address (not the old V5 address)
```

### 5. Initialize V6 State (Testnet)

```bash
# Set shop prices (undo price is new in V6)
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "setShopPrices(uint256,uint256,uint256,uint256)" \
  25000000000000000000 \
  50000000000000000000 \
  125000000000000000000 \
  40000000000000000000 \
  --from $OWNER_ADDRESS \
  --legacy \
  --rpc-url https://alfajores-forno.celo-testnet.org
```

### 6. Test New Features (Testnet)

```bash
# Test buyUndoMove
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "buyUndoMove(uint256)" 3 \
  --from $TEST_PLAYER_ADDRESS \
  --legacy \
  --rpc-url https://alfajores-forno.celo-testnet.org

# Test setCosmeticPrice (owner only)
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "setCosmeticPrice(uint256,uint256)" \
  1 \
  100000000000000000000 \
  --from $OWNER_ADDRESS \
  --legacy \
  --rpc-url https://alfajores-forno.celo-testnet.org

# Test buyCosmetic
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "buyCosmetic(uint256)" 1 \
  --from $TEST_PLAYER_ADDRESS \
  --legacy \
  --rpc-url https://alfajores-forno.celo-testnet.org

# Test score submission without verification (new in V6)
# Unverified player should be able to submit and earn XP
```

### 7. Verify All Old Features Still Work (Testnet)

```bash
# Buy shield
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "buyStreakShield()" \
  --from $TEST_PLAYER_ADDRESS \
  --legacy \
  --rpc-url https://alfajores-forno.celo-testnet.org

# Buy XP boost (should set 5-hour expiry, not 24h)
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "buyXpBoost(uint8)" 2 \
  --from $TEST_PLAYER_ADDRESS \
  --legacy \
  --rpc-url https://alfajores-forno.celo-testnet.org

# Set username
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "setUsername(string)" "testplayer123" \
  --from $TEST_PLAYER_ADDRESS \
  --legacy \
  --rpc-url https://alfajores-forno.celo-testnet.org
```

### 8. Monitor Transaction Fees (Testnet)

After each transaction, check gas used:

```bash
# Get transaction receipt
cast receipt $TX_HASH --rpc-url https://alfajores-forno.celo-testnet.org
```

Expected gas costs:
- `buyStreakShield()`: ~60,000 gas
- `buyXpBoost(2)`: ~65,000 gas
- `buyUndoMove(3)`: ~75,000 gas
- `buyCosmetic(1)`: ~80,000 gas
- `setCosmeticPrice()`: ~50,000 gas

### 9. Testnet Acceptance Criteria

- [ ] All old features work without modification
- [ ] New features callable without errors
- [ ] Events emitted with correct data (including prices)
- [ ] Storage layout preserved (old state readable)
- [ ] Zero-price guards working (revert on price=0)
- [ ] Verification gate moved (unverified can submit, no G$ reward)
- [ ] XP boost duration changed (5h instead of 24h)
- [ ] Gas costs reasonable (within ~10% of V5)

## Mainnet Deployment (Celo Mainnet)

Once testnet testing complete and approved:

### 1. Repeat Steps 3-9 on Mainnet

```bash
# Deploy to mainnet
npx hardhat ignition deploy ./ignition/modules/Game2048V6Upgrade.ts \
  --network celo \
  --verify \
  --artifact-dir artifacts

# Verify implementation changed
cast storage 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  0x360894a13ba1a3210667c828492db98dca3e2848cc3735a19cf27b5a7b407340 \
  --rpc-url https://rpc.ankr.com/celo
```

### 2. Update Frontend Event Parsing

Frontend must be updated to handle new event signatures:

**V5 Events (Legacy — will stop appearing)**
```typescript
ShieldPurchased(address indexed player, uint256 count)
XpBoostPurchased(address indexed player, uint8 multiplier, uint64 expiry)
ShopPricesUpdated(uint256 shield, uint256 boost2x, uint256 boost5x)
```

**V6 Events (New Signatures)**
```typescript
ShieldPurchased(address indexed player, uint256 count, uint256 pricePaid)
XpBoostPurchased(address indexed player, uint8 multiplier, uint64 expiry, uint256 pricePaid)
UndoPurchased(address indexed player, uint256 quantity, uint256 pricePaid)
UndoConsumed(address indexed player)
CosmeticPurchased(address indexed player, uint256 indexed itemId, uint256 pricePaid)
ShopPricesUpdated(uint256 shield, uint256 boost2x, uint256 boost5x, uint256 undo)
CosmeticCatalogUpdated(uint256 indexed itemId, uint256 price, bool exists)
```

### 3. Populate Initial Cosmetics (Owner Task)

```bash
# Add tile skin cosmetics
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "setCosmeticPrice(uint256,uint256)" 1 100000000000000000000 \
  --from $OWNER_ADDRESS --rpc-url https://rpc.ankr.com/celo

# Add avatar cosmetics
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "setCosmeticPrice(uint256,uint256)" 2 75000000000000000000 \
  --from $OWNER_ADDRESS --rpc-url https://rpc.ankr.com/celo

# Continue adding more as needed...
```

### 4. Update Official Docs/README

- Mention 5-hour XP boost duration in shop page
- Document new "Undo Move" item
- Document new "Cosmetics" catalog system
- Note: Score submission no longer requires verification; XP awards to all; G$ rewards verification-gated

### 5. Community Announcement

Notify players of:
- XP boost duration reduced from 24 hours to 5 hours (existing boosts unaffected)
- New "Undo Move" consumable item available in shop (40 G$ per credit)
- New cosmetics system launching (tile skins, avatar accessories, etc.)
- Unverified players can now submit scores (but won't receive G$ rewards)

## Rollback Plan

If critical issues discovered after mainnet deployment:

### Quick Rollback (V6 → V5)

1. Keep V5 implementation deployed separately (do not delete)
2. Call `upgradeToAndCall()` again, pointing proxy back to V5 implementation
3. No data loss (all storage preserved in proxy)

```bash
# Rollback to V5
cast send 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "upgradeToAndCall(address,bytes)" \
  "$V5_IMPLEMENTATION_ADDRESS" \
  0x \
  --from $OWNER_ADDRESS \
  --rpc-url https://rpc.ankr.com/celo
```

### Data Recovery

No migration scripts needed; all state remains in proxy storage:
- All player XP, scores, usernames intact
- All shop prices preserved
- All leaderboard data preserved
- All referral data intact
- All new cosmetics/undo state discarded (acceptable for rollback)

## Post-Deployment Monitoring

### Week 1: Close Monitoring
- Monitor gas costs of new functions (ensure reasonable)
- Check event emissions (verify price data included)
- Verify unverified players can submit and earn XP
- Verify verified players receive G$ rewards only
- Monitor shop usage (shield/boosts behavior unchanged)

### Week 2-4: Ongoing
- Track cosmetics purchase patterns
- Monitor undo move usage
- Verify no storage corruption or unexpected state changes
- Watch for any contract revert patterns

## Emergency Contacts

| Role | Responsibility | Contact |
|------|-----------------|---------|
| Owner | Deploy, upgrade, set prices | `$OWNER_ADDRESS` |
| Frontend | Update event parsing, UI | Backend team |
| DevOps | Monitor mainnet, gas costs | DevOps team |
| Community | Announcement, support | Marketing team |

## Deployment Timeline

| Phase | Duration | Trigger |
|-------|----------|---------|
| Testnet testing | 2-3 days | All tests pass locally |
| Mainnet deployment | 1 day | Testnet acceptance criteria met |
| Post-deployment monitoring | 1 week | Deployment successful |
| Full release | After 1 week | No critical issues detected |

## Success Criteria

✅ All old features working identically to V5
✅ All new features (Undo, Cosmetics) callable
✅ Events emitted with prices
✅ Zero-price guards enforced
✅ Storage layout preserved (no data loss)
✅ Verification gate moved (unverified can submit)
✅ XP boost duration changed to 5 hours
✅ Gas costs reasonable
✅ Frontend updated for new events
✅ Initial cosmetics catalog seeded
✅ No contract reverts or unexpected behavior
✅ Community notified of changes
