# Game2048 Shop V6 UI Implementation Plan

## Overview
Implement complete shop UI for V6 contract with undo move (consumable), cosmetics (3 categories), avatar system, tile skins, and leaderboard flair.

## Scope
1. ✅ Contract V6 deployed at 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6
2. 🚀 **Frontend Implementation** (THIS DOCUMENT)
   - Update ABI with V6 functions
   - Extend useShop hook with new functions
   - Add undo tracking and consumption
   - Expand Shop component with new sections
   - Implement avatar system (base + accessories)
   - Add tile skin and leaderboard flair rendering
   - Update XP boost copy (24h → 5h)

## Files to Create/Modify

### 1. Update ABI (`frontend/src/lib/abi.ts`)
**Action**: Add V6 functions to GAME2048_ABI

**New functions to add**:
- `buyUndoMove(uint256 quantity)` - nonpayable
- `consumeUndo(address player)` - nonpayable
- `buyCosmetic(uint256 itemId)` - nonpayable
- `undoCredits(address)` - view, returns uint256
- `undoPrice()` - view, returns uint256
- `cosmeticCatalog(uint256)` - view, returns (uint256 price, bool exists)
- `cosmeticsOwned(address, uint256)` - view, returns bool
- `setCosmeticPrice(uint256 itemId, uint256 price)` - onlyOwner
- `removeCosmeticItem(uint256 itemId)` - onlyOwner
- `getCosmeticItem(uint256 itemId)` - view
- `getCosmeticsOwned(address player, uint256[] itemIds)` - view

**New events to add**:
- `UndoPurchased(indexed address player, uint256 quantity, uint256 pricePaid)`
- `UndoConsumed(indexed address player)`
- `CosmeticPurchased(indexed address player, indexed uint256 itemId, uint256 pricePaid)`
- `CosmeticCatalogUpdated(indexed uint256 itemId, uint256 price, bool exists)`

### 2. Create Avatar System (`frontend/src/lib/avatarSystem.ts`)
**Purpose**: Manage avatar rendering with base + accessories

```typescript
export type AccessoryType = 'hat' | 'sunglasses' | 'mask' | 'earring';
export type AccessoryId = number; // itemId from cosmetics

export interface AvatarState {
  baseColor: string; // derived from address
  accessories: Set<AccessoryId>;
  equippedAccessory?: AccessoryId;
}

export function getAvatarStyle(addr: string, ownedAccessories: number[]): AvatarState
export function renderAvatar(state: AvatarState): React.ReactNode
export function getAccessoryEmoji(itemId: number): string
```

### 3. Extend useShop Hook (`frontend/src/hooks/useShop.ts`)
**Add**:
- `undoPrice` - read from contract
- `undoCredits` - player's undo balance
- `cosmeticsOwned` - array of owned itemIds
- `buyUndoMove(quantity)` - purchase undo
- `consumeUndo()` - spend one undo credit
- `buyCosmetic(itemId)` - purchase cosmetic
- Optimistic updates with rollback for undo consumption

### 4. Update Shop Component (`frontend/src/components/Shop.tsx`)
**Add sections**:
1. **Undo Move** (consumable)
   - Shows owned credits
   - Quantity selector (1-10)
   - Buy button
   
2. **Cosmetics** (catalog)
   - 3 categories: Tile Skins, Leaderboard Flair, Avatar Accessories
   - Owned items show checkmark
   - Buy unavailable if already owned

### 5. Add Undo Button (Gameplay)
**Location**: `GameControls.tsx` or inline on board
**Behavior**:
- Disabled if credits = 0
- Click reverts last move
- Optimistically decrements credits
- Rolls back on failure
- Updates display immediately

### 6. Avatar Component (`frontend/src/components/Avatar.tsx`)
**Props**: `address: string, ownedAccessories?: number[], equippedId?: number`

**Renders**:
- Base avatar (deterministic from address)
- Equipped accessory overlay

**Used in**:
- Leaderboard rows
- Profile / Player card
- Score panel

### 7. Update Leaderboard (`frontend/src/components/Leaderboard.tsx`)
**Changes**:
- Replace `getAvatar()` letter-based system with Avatar component
- Show leaderboard flair next to names if owned
- Query cosmetics from subgraph (optional, for future)

### 8. Update XP Boost Copy (Everywhere)
**Search for**: "24 hours"
**Replace with**: "5 hours"

**Files affected**:
- Shop.tsx - boost descriptions
- Board.tsx - boost status
- GameControls.tsx - hints
- index.css - any hardcoded copy

---

## Implementation Priority

### Phase 1: Core Shop Functionality (Day 1)
- [x] ABI updated with V6 functions
- [ ] useShop hook extended with buyUndoMove, buyCosmetic
- [ ] Shop.tsx expanded with Undo + Cosmetics sections
- [ ] XP boost copy updated (24h → 5h)

### Phase 2: Undo Gameplay (Day 1-2)
- [ ] consumeUndo logic added to useShop
- [ ] Undo button added to GameControls or Board
- [ ] Optimistic updates + rollback

### Phase 3: Avatar System (Day 2)
- [ ] Avatar component created
- [ ] Base avatar replaces initials
- [ ] Leaderboard updated to use Avatar
- [ ] Accessory equipping logic (profile page)

### Phase 4: Cosmetics Rendering (Day 3)
- [ ] Tile skins applied to Board
- [ ] Leaderboard flair rendered
- [ ] Avatar accessories overlay

### Phase 5: Testing & Polish (Day 3-4)
- [ ] Test against V6 contract on testnet
- [ ] Verify all flows (purchase, use, display)
- [ ] Check responsive design
- [ ] Performance optimization

---

## Cosmetics Catalog Design

### Format
- **itemId 1-9**: Tile Skins (apply to board)
  - 1: Dark Mode
  - 2: Neon
  - 3: Retro
  - etc.
  
- **itemId 10-19**: Leaderboard Flair (badges/emoji)
  - 10: 🔥 Fire (rare achievement)
  - 11: 🎯 Marksman (accuracy streak)
  - 12: ⚡ Speed (fast gameplay)
  - etc.
  
- **itemId 20-29**: Avatar Accessories
  - 20: 😎 Sunglasses
  - 21: 🎩 Top Hat
  - 22: 👑 Crown
  - 23: 🕶️ Cool Shades
  - 24: 🥽 Goggles
  - etc.

### Storage
- `cosmeticsOwned[player][itemId]` = bool (owned)
- `equippedAccessory[player]` = itemId (currently equipped)
- Local state for tile skin selection

---

## Testing Strategy

### Unit Tests
- Avatar generation (deterministic from address)
- Undo optimistic updates
- Shop affordability checks

### Integration Tests
- Purchase flow (shop → contract → balance)
- Consume undo (gameplay → contract → balance)
- Cosmetics ownership tracking

### E2E Tests
- Full shop purchase flow
- Undo move during gameplay
- Avatar + flair rendering on leaderboard
- Tile skin application

### Manual Testing on Testnet
1. Deploy V6 to testnet
2. Mint test G$ to wallet
3. Buy each shop item
4. Verify cosmetics owned
5. Test undo during game
6. Check leaderboard display
7. Equip accessories and verify rendering

---

## UI/UX Considerations

### Shop Layout
- Grid layout (3 columns on desktop, 1-2 mobile)
- Card-based items (icon, name, desc, price, status, button)
- "Already owned" badge on cosmetics
- Quantity selector for consumables

### Undo Button
- Large, prominent (part of game HUD)
- Shows credit count next to it
- Tooltip: "Revert last move (X credits left)"
- Disabled state when X = 0

### Avatar Display
- 24x24px on leaderboard
- 64x64px on profile
- Animated emoji overlay for accessories
- Fallback to letter if asset fails

### Cosmetics Selection
- Profile/Settings page
- Tile skin radio buttons
- Avatar accessory dropdown
- Leaderboard flair toggle (enable/disable)

---

## Error Handling

**User-facing errors**:
- "Insufficient G$ balance"
- "Price not configured"
- "Item doesn't exist"
- "Already owns this cosmetic"
- "Insufficient undo credits"
- "Transaction failed"

**Rollback scenarios**:
- Undo consumption fails → restore credit count
- Cosmetic purchase fails → remove from owned list
- Price query fails → fall back to last known price

---

## Performance Considerations

- Lazy-load cosmetics catalog (only fetch on Shop open)
- Cache avatar styles (address → colors)
- Batch cosmetic ownership queries (subgraph pagination)
- Memoize cosmetics list components
- Debounce undo button (prevent double-spend)

---

## Storage & State

### Contract Storage (read-only in UI)
- `undoCredits[player]` - cumulative
- `cosmeticsOwned[player][itemId]` - boolean
- `cosmeticCatalog[itemId]` - (price, exists)

### Local UI State (React)
- Selected tile skin
- Equipped accessory
- Optimistic undo credit count
- Cosmetics being purchased

### Persistent Storage (localStorage)
- Equipped accessory per address
- Tile skin preference per address
- Hidden cosmetics (toggle visibility)

---

## API Changes Summary

### New useShop Returns
```typescript
{
  // Existing
  shieldPrice, boost2xPrice, boost5xPrice,
  shieldCount, xpBoost, boostActive,
  playerXp, streakCount, gdBalance,
  
  // NEW V6
  undoPrice,
  undoCredits,
  cosmeticsOwned,  // number[] (itemIds)
  buyUndoMove: (qty: number) => Promise<void>,
  consumeUndo: () => Promise<void>,
  buyCosmetic: (itemId: number) => Promise<void>,
}
```

### New Avatar Component Props
```typescript
<Avatar
  address={address}
  ownedAccessories={[20, 21]}  // optional
  equippedId={20}              // optional
  size="sm" | "md" | "lg"       // optional
/>
```

---

## Rollback Plan (If V6 Issues Found)

- Revert ABI changes (keep V5 only)
- Hide Shop new sections (conditional render)
- Keep Undo button disabled
- Use fallback avatar (initials)
- No data loss (all read-only)

---

## Success Criteria

✅ All V6 shop items purchasable  
✅ Undo moves during gameplay  
✅ Avatar system working  
✅ Cosmetics rendering correctly  
✅ XP boost copy updated  
✅ No auth/provider changes  
✅ Works on testnet V6  
✅ Responsive on mobile  
✅ Gas costs reasonable  

---

## Estimated Effort

- ABI update: 1 hour
- useShop extension: 2 hours
- Shop UI expansion: 2 hours
- Undo gameplay: 1.5 hours
- Avatar system: 2 hours
- Cosmetics rendering: 1.5 hours
- Copy updates: 0.5 hours
- Testing: 2 hours

**Total: ~13 hours of focused work**

---

**Status**: Ready to implement Phase 1 starting with ABI update and useShop extension.
