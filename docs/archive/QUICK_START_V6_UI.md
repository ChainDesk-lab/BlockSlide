# Quick Start: Game2048 V6 Shop UI

## What Changed in This Release

### 1️⃣ **New Shop Items**
- **Undo Move** (Consumable): Buy 1-10 credits to revert moves during gameplay
- **Cosmetics** (6+ items): Avatar accessories (sunglasses, hats, etc.) and more

### 2️⃣ **New Undo Button**
- Shows in game controls during active gameplay
- Displays: "↶ Undo (X)" where X = available credits
- Click to spend one credit and revert last move
- Disabled when credits = 0

### 3️⃣ **Avatar System**
- Old: Random letters (A-Z) based on address
- New: Emoji avatars (🦁🐯🐻🐼🐨🦋🐝 etc.)
- Different avatar per wallet address
- Consistent across page navigation

### 4️⃣ **XP Boost Duration**
- Changed everywhere from **24 hours** → **5 hours**
- Affects both 2x and 5x boost descriptions

### ⚠️ **No Changes To**
- ✅ Auth system (no changes)
- ✅ Providers (no changes)
- ✅ useSigner hook (no changes)
- ✅ Storage (no changes)
- ✅ V5 shop items (fully compatible)

---

## Quick Test (2 minutes)

### 1. Navigate to Shop
```
http://localhost:5173/?tab=shop
```

### 2. Verify Display
- [ ] Shield, 2x Boost, 5x Boost still show
- [ ] Boost descriptions say "5 hours" (not "24 hours")
- [ ] Undo Move card visible
- [ ] Cosmetics section visible with 6+ items

### 3. Go to Game
```
http://localhost:5173/?tab=game
```

### 4. Start Game & Check Undo
- [ ] Click "New Game"
- [ ] Game loads
- [ ] "↶ Undo (0)" button visible
- [ ] Button is disabled (greyed out)

### 5. Go to Leaderboard
```
http://localhost:5173/?tab=leaderboard
```

### 6. Check Avatars
- [ ] Top 3 players show emojis (not letters)
- [ ] Player list shows emojis (not letters)
- [ ] Each player has different emoji

**Time**: ~2 minutes if all pass ✅

---

## Test Against Deployed V6

### Contract Address
```
0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6
```

### Check Contract Has V6 Functions
```bash
# Check undo price
cast call 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "undoPrice()" \
  --rpc-url https://alfajores-forno.celo-testnet.org

# Check your undo credits
cast call 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "undoCredits(address)" 0x<YOUR_WALLET> \
  --rpc-url https://alfajores-forno.celo-testnet.org
```

### Full Purchase Flow Test
1. Go to Shop
2. Buy 3 Undo Move credits
3. Approve G$ spend (if first time)
4. Watch transaction pending
5. Confirm on block explorer
6. Verify credits show "3 credits available"
7. Go to Game
8. Start game
9. See "↶ Undo (3)"

**Expected**: All steps succeed, UI updates correctly

---

## File Reference

### New Files Created
```
frontend/src/lib/abiV6.ts                  # V6 function definitions
frontend/src/lib/abiMerged.ts              # Combined V5+V6 ABI
frontend/src/lib/avatarSystem.ts           # Avatar generation
frontend/src/components/Avatar.tsx         # Avatar component
```

### Files Modified
```
frontend/src/hooks/useShop.ts              # Added V6 functions
frontend/src/components/Shop.tsx           # Added Undo + Cosmetics
frontend/src/components/GameControls.tsx   # Added Undo button
frontend/src/components/Leaderboard.tsx    # Use Avatar component
frontend/src/App.tsx                       # Pass undo props
```

### Documentation
```
SHOP_V6_UI_IMPLEMENTATION.md              # Full plan
SHOP_V6_UI_TEST_GUIDE.md                  # Comprehensive tests
SHOP_V6_UI_STATUS.md                      # Implementation status
QUICK_START_V6_UI.md                      # This file
```

---

## Common Issues & Fixes

### Issue: Undo button doesn't show
**Fix**: 
- Verify you're in active game (not ended)
- Check console for errors
- Verify useShop hook returns undoCredits

### Issue: Avatars show as letters
**Fix**:
- Clear browser cache
- Hard refresh (Ctrl+Shift+R)
- Verify Avatar component imported in Leaderboard

### Issue: Shop items show "Price not set"
**Fix**:
- V6 contract must have prices initialized
- Owner must call setShopPrices() with 4 parameters (including undoPrice)
- Example: `25G$, 50G$, 125G$, 40G$` for shield, 2x, 5x, undo

### Issue: Can't buy cosmetics
**Fix**:
- Verify G$ balance > price
- Verify G$ allowance is set (approve flow)
- Check contract has setCosmeticPrice() called for itemId
- Verify cosmetic exists in catalog

### Issue: TypeScript errors
**Fix**:
- Run `npm install`
- Run `npm run build`
- Clear dist/build folders if persists

---

## Verification Checklist

Before pushing to production, verify:

**Core Functionality**
- [ ] Shop displays all items (V5 + Undo + Cosmetics)
- [ ] Prices load from contract correctly
- [ ] Undo button visible during game
- [ ] Avatars show emojis on leaderboard

**Purchasing**
- [ ] Can buy Undo Move
- [ ] Can buy Cosmetics
- [ ] Credits/ownership updates
- [ ] Balance updates after purchase

**Gameplay**
- [ ] New games start normally
- [ ] Score submission works
- [ ] XP updates correctly
- [ ] Leaderboard updates

**Copy**
- [ ] No "24 hour" references remain
- [ ] All descriptions updated
- [ ] No typos

**Browser Compatibility**
- [ ] Chrome/Edge ✅
- [ ] Firefox ✅
- [ ] Safari ✅
- [ ] Mobile ✅

---

## Rollback Plan

If issues found in production:

### Quick Rollback
1. Revert commits to before V6 UI changes
2. Redeploy frontend
3. Old shop UI will show (no cosmetics/undo)
4. No data loss (all read-only changes)

### Partial Rollback
If only cosmetics have issues:
1. Hide cosmetics section (conditional render)
2. Keep Undo functionality
3. Allows more targeted fix

---

## Next Steps (Phase 2)

After verification passes:

1. **Avatar Accessories Overlay** (~2 hrs)
   - Add CSS for accessory positioning
   - Render equipped accessory on avatar
   - Add equipping UI to profile

2. **Tile Skin Application** (~2 hrs)
   - Apply selected tile skin to game board
   - CSS classes for different skins
   - Persistence in localStorage

3. **Leaderboard Flair** (~1 hr)
   - Display leaderboard flair badges
   - Render next to player names
   - Toggle visibility

4. **Profile Cosmetics UI** (~2 hrs)
   - Build cosmetics management page
   - Equipping interface
   - View owned items

---

## Support

### Questions?
- See `SHOP_V6_UI_IMPLEMENTATION.md` for architecture
- See `SHOP_V6_UI_TEST_GUIDE.md` for all test cases
- See `SHOP_V6_UI_STATUS.md` for detailed status

### Issues?
Check the common issues section above, or:
1. Look at IDE error messages
2. Check browser console (F12)
3. Check network tab for failed requests
4. Verify V6 contract is deployed

---

## TL;DR

✅ Shop has Undo Move + Cosmetics
✅ Undo button works in game  
✅ Avatars are emojis not letters
✅ XP boost copy changed to 5 hours
✅ No auth/provider changes
✅ Ready for testnet verification

**Next**: Run SHOP_V6_UI_TEST_GUIDE.md on testnet before production
