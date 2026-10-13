# Shop V6 UI Test Guide

## Test Environment Setup

### Prerequisites
- V6 contract deployed on testnet at: `0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6`
- Test wallet with G$ balance
- Frontend built with V6 changes

### Quick Setup
```bash
cd frontend
npm install
npm run dev
# Navigate to http://localhost:5173/?tab=shop
```

---

## Test Cases

### 1. Shop Page Display

#### 1.1 Existing Items Still Show
- [ ] Streak Shield displays correctly
- [ ] 2x XP Boost displays (check copy says "5 hours" not "24 hours")
- [ ] 5x XP Boost displays (check copy says "5 hours" not "24 hours")
- [ ] All prices load from contract

**Expected**: All V5 items visible and functional

#### 1.2 New Undo Move Item Shows
- [ ] Undo Move card appears in shop
- [ ] Shows icon (↶)
- [ ] Description: "Revert your last move during gameplay. Consumable — use within a game session."
- [ ] Shows current undo credits (0 for new player)
- [ ] Quantity selector (1-10) visible and working
- [ ] Price displays (should be 40 G$ based on contract default)

**Expected**: Undo Move item fully functional with quantity selector

#### 1.3 Cosmetics Section Appears
- [ ] "Cosmetics" section header visible
- [ ] Avatar Accessories subsection shows (at least 6 items)
- [ ] Each cosmetic displays:
  - Emoji icon
  - Name (Sunglasses, Top Hat, Crown, etc.)
  - Description
  - Price
  - Status (Available / ✓ Owned)
- [ ] Buy buttons for each

**Expected**: Cosmetics grid renders with proper layout

---

### 2. XP Boost Duration Copy

#### 2.1 Copy Verification
Search Shop page for any "24" references:
- [ ] 2x Boost desc: "Doubles all XP earned from games for 5 hours."
- [ ] 5x Boost desc: "Multiplies all XP earned from games by 5 for 5 hours."
- [ ] Boost status shows correct expiry countdown

**Expected**: No "24 hour" references remain

---

### 3. Undo Move Purchase Flow

#### 3.1 Purchase Without Wallet
- [ ] Undo Move card shows "Insufficient G$" if no balance
- [ ] Cannot purchase without approval

#### 3.2 Purchase With Wallet (Connected)
- [ ] Approval flow works if first purchase
- [ ] Set quantity to 5
- [ ] Click Buy
- [ ] Wallet approval prompt appears (if needed)
- [ ] Transaction sends successfully
- [ ] Credit count updates optimistically
- [ ] After confirmation, status shows "5 credits available"

**Expected**: Purchase completes, credits increase by quantity

#### 3.3 Multiple Purchases
- [ ] Buy 3 credits
- [ ] Buy 2 more credits
- [ ] Total shown as 5 credits available

**Expected**: Credits accumulate correctly

---

### 4. Avatar System

#### 4.1 Leaderboard Avatar Display
Navigate to Leaderboard:
- [ ] Top 3 players show emoji avatars (not letters)
- [ ] Each avatar is different (based on wallet address)
- [ ] Avatar size appropriate on podium
- [ ] Player names display correctly

#### 4.2 All Players List Avatars
- [ ] Each player row shows emoji avatar
- [ ] Avatars consistent (same address = same avatar)
- [ ] Avatar size smaller on list (sm size)

**Expected**: All avatars deterministic and properly sized

#### 4.3 Avatar Stability
- [ ] Refresh page: avatars unchanged
- [ ] Switch tabs (Home → Leaderboard → Shop → Game): avatars persist
- [ ] Different wallets show different avatars

**Expected**: Avatar generation is stable and deterministic

---

### 5. Cosmetics Purchase Flow

#### 5.1 Single Cosmetic Purchase
In Shop:
- [ ] Select a cosmetic (e.g., Sunglasses)
- [ ] Click Buy
- [ ] Approval flow (if needed)
- [ ] Transaction sends
- [ ] Status changes to "✓ Owned"
- [ ] Cannot buy same item twice (button disabled or "Already owned")

**Expected**: Cosmetic ownership tracked on contract

#### 5.2 Multiple Cosmetics
- [ ] Buy Sunglasses (status: ✓ Owned)
- [ ] Buy Top Hat (status: ✓ Owned)
- [ ] Buy Crown (status: ✓ Owned)
- [ ] All three remain marked as owned

**Expected**: Multiple cosmetics can be owned simultaneously

---

### 6. Undo Button In-Game

#### 6.1 Button Display During Gameplay
- [ ] Start new game
- [ ] Game board displays
- [ ] Undo button visible in controls
- [ ] Shows: "↶ Undo (X)" where X = credit count
- [ ] Button visible while playing

**Expected**: Undo button always visible during active game

#### 6.2 Undo Button States
- With 0 credits:
  - [ ] Button disabled (greyed out)
  - [ ] Tooltip: "No undo credits available"
  
- With 5 credits:
  - [ ] Button enabled (clickable)
  - [ ] Shows "↶ Undo (5)"
  - [ ] Tooltip shows "Undo move (5 credits left)"

**Expected**: Button state reflects current credits

#### 6.3 Undo During Gameplay
- [ ] Buy 3 undo credits in shop
- [ ] Start game
- [ ] Make 5 moves
- [ ] Click Undo button
- [ ] Last move reverts (board state changes)
- [ ] Undo button shows "↶ Undo (2)"
- [ ] Credit count decreased by 1

**Expected**: Undo works, credits consumed, move reverted

#### 6.4 Undo Multiple Times
- [ ] Start with 3 credits
- [ ] Make 5 moves
- [ ] Undo once → 2 credits left, last move reverts
- [ ] Undo again → 1 credit left, previous move reverts
- [ ] Undo again → 0 credits left, another move reverts
- [ ] Undo button now disabled

**Expected**: Can undo multiple times, credits consumed each time

#### 6.5 Undo After Game Ends
- [ ] Play until game ends (win or lose)
- [ ] Undo button should not show after game ends
- [ ] Submit score flow works normally

**Expected**: Undo only available during active gameplay

---

### 7. Error Scenarios

#### 7.1 Insufficient Balance
- [ ] Buy with only 50 G$ when item costs 100 G$
- [ ] Button shows "Insufficient G$"
- [ ] Click does nothing

**Expected**: Proper error state

#### 7.2 Price Not Set
- [ ] If contract has price = 0 for an item
- [ ] Button shows "Price not set"
- [ ] Cannot purchase

**Expected**: Zero-price guard active

#### 7.3 Network Error
- [ ] Attempt purchase with network error
- [ ] Error message displays
- [ ] Can retry

**Expected**: Graceful error handling

#### 7.4 Transaction Rejection
- [ ] Initiate purchase
- [ ] Reject in wallet
- [ ] Error message: "Transaction rejected" or similar
- [ ] State rolls back (credits not deducted)

**Expected**: Optimistic updates roll back correctly

---

### 8. Performance

#### 8.1 Shop Page Load
- [ ] Shop page loads in < 3 seconds
- [ ] All items render
- [ ] No layout shift

#### 8.2 Cosmetics Grid
- [ ] Grid renders smoothly (no jank)
- [ ] Scrolling smooth
- [ ] Images/emojis load quickly

#### 8.3 Purchase Transaction
- [ ] UI responsive during transaction (not frozen)
- [ ] Spinner shows for pending state
- [ ] Button state updates immediately after tx

**Expected**: No performance issues

---

### 9. Responsive Design

#### 9.1 Desktop (1920px)
- [ ] Shop grid: 3 columns
- [ ] All items visible
- [ ] No horizontal scroll

#### 9.2 Tablet (768px)
- [ ] Shop grid: 2 columns
- [ ] All items visible
- [ ] Cosmetics section visible

#### 9.3 Mobile (375px)
- [ ] Shop grid: 1 column
- [ ] All items stack vertically
- [ ] Buttons clickable (large touch targets)
- [ ] Undo button accessible during game
- [ ] Leaderboard avatars visible

**Expected**: Works on all screen sizes

---

### 10. Integration With Existing Features

#### 10.1 XP Tracking
- [ ] Play game, submit score
- [ ] XP updates on leaderboard
- [ ] Undo doesn't break XP tracking

#### 10.2 Leaderboard Updates
- [ ] Buy cosmetics
- [ ] Refresh leaderboard
- [ ] Your name still shows with avatar
- [ ] Cosmetics display correctly

#### 10.3 Account Switching
- [ ] Switch to different wallet
- [ ] Shop shows different prices (if owner-set differently)
- [ ] Different avatar on leaderboard
- [ ] Undo credits for new wallet (should be 0)

**Expected**: Multi-wallet support works

---

## Test Checklist Summary

### Must Pass
- [ ] All V5 shop items work unchanged
- [ ] XP boost copy updated (24h → 5h)
- [ ] Undo Move item purchasable
- [ ] Undo button works during gameplay
- [ ] Avatars display correctly (not letters)
- [ ] Cosmetics purchasable
- [ ] No errors in console
- [ ] Responsive design works

### Should Pass
- [ ] Undo optimistic updates rollback on failure
- [ ] Cosmetics status ("✓ Owned") accurate
- [ ] Performance acceptable
- [ ] Integration with leaderboard smooth

### Nice to Have
- [ ] Cosmetics rendering on avatar (visual equipping)
- [ ] Tile skin application to board
- [ ] Leaderboard flair display
- [ ] Profile page cosmetics equipping UI

---

## Testnet Verification Commands

```bash
# Check V6 contract functions
cast call 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "undoPrice()" \
  --rpc-url https://alfajores-forno.celo-testnet.org

cast call 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "undoCredits(address)" 0x<your-wallet> \
  --rpc-url https://alfajores-forno.celo-testnet.org

# Check cosmetics catalog
cast call 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6 \
  "getCosmeticItem(uint256)" 20 \
  --rpc-url https://alfajores-forno.celo-testnet.org
```

---

## Known Issues / Limitations

- [ ] Undo move revert needs integration with game board logic (currently only tracks contract state)
- [ ] Cosmetics rendering (accessories on avatar, tile skins on board) not yet implemented
- [ ] Leaderboard flair display not yet implemented
- [ ] Profile page cosmetics equipping UI not yet built
- [ ] Subgraph queries for cosmetics ownership not yet integrated (using mock data)

---

## Sign-Off

**Date Tested**: _______________
**Tester**: _______________
**Testnet**: Celo Alfajores
**V6 Contract**: 0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6

**All Core Tests Passed**: [ ] Yes [ ] No

**Issues Found**:
```
[List any issues discovered during testing]
```

**Ready for Production**: [ ] Yes [ ] No

---

## Next Steps (Phase 2)

- [ ] Integrate undo move revert with game board logic
- [ ] Implement tile skin rendering
- [ ] Implement avatar accessory overlay
- [ ] Implement leaderboard flair
- [ ] Build profile page cosmetics UI
- [ ] Connect subgraph for cosmetics queries
