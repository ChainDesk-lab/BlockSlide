# Email Login Integration Testing Guide

## Architecture

**Authentication Flow:**
```
User clicks "Sign in with Email"
    ↓
useWeb3Auth hook initializes Web3Auth modal
    ↓
Web3Auth modal opens (email/social login)
    ↓
User completes authentication
    ↓
Web3Auth creates embedded wallet & returns provider
    ↓
Provider injected into window.ethereum
    ↓
wagmi's useAccount() detects address from provider
    ↓
App proceeds to username setup and main interface
```

Both "Connect Wallet" (RainbowKit) and "Sign in with Email" (Web3Auth) use the same wagmi hooks for transactions.

## Setup Required

### 1. Get Web3Auth Client ID

1. Visit https://dashboard.web3auth.io
2. Create a new account or sign in
3. Create a new **Plug and Play** project (type: Web)
4. Copy the **Client ID** from project settings
5. Add to `frontend/.env.local`:
   ```
   VITE_WEB3AUTH_CLIENT_ID=your_client_id_here
   ```

### 2. Configure Web3Auth Dashboard

In Web3Auth dashboard, project settings → Allowed Origins:
1. Add your dev domains:
   - `http://localhost:5175`
   - `http://localhost:5174`
   - `http://localhost:5173`
2. Leave as `localhost:*` for development
3. For production, add your actual domain

### 3. Start Dev Server

```bash
cd frontend
npm run dev
```

App will run on `http://localhost:5175` (or similar, check terminal output)

---

## Test Cases

### Test 1: Login Screen Appears When Disconnected

**Expected:**
- Page loads and shows BlockSlide login screen
- Two buttons visible: "Connect Wallet" and "Sign in with Email"
- GoodDollar disclaimer shown at bottom

**Steps:**
1. Open http://localhost:5175
2. Verify LoginScreen is displayed
3. Verify no wallet is connected (header shows wallet icon)

---

### Test 2: Wallet Connect Flow (Existing)

**Expected:**
- User can connect via MetaMask/MiniPay
- Address appears in header
- App proceeds to main interface

**Steps:**
1. Click "Connect Wallet"
2. Select MetaMask (or MiniPay on Celo)
3. Approve connection
4. Verify address shows in header top-right
5. Verify username modal appears (or main app if username already set)

---

### Test 3: Email Login Flow

**Expected:**
- Web3Auth modal opens for email/social login
- User can sign up with email or social account
- Embedded wallet is created
- Address appears in header
- App is fully functional with email wallet

**Steps:**
1. Click "Sign in with Email"
2. Web3Auth modal should open
3. Choose "Email Passwordless" or social login
4. Complete authentication
5. Verify address shows in header
6. Verify it's a valid address (0x... format)

---

### Test 4: Email Wallet Can Start Game Sessions

**Expected:**
- Email wallet user can create new game sessions
- Session seed is generated
- Session appears as "active" with countdown

**Steps:**
1. Complete email login (Test 3)
2. Go to Home tab → "Play Game"
3. Click "New Game"
4. Game board should appear
5. Session should be active (verify in game controls)

---

### Test 5: Email Wallet Can Submit Scores

**Expected:**
- User can play a game to completion
- Score is submitted on-chain
- Transaction succeeds
- Score appears on leaderboard

**Steps:**
1. Complete email login
2. Start a game (Test 4)
3. Play until game ends
4. Click "Submit Score"
5. Approve transaction in wallet
6. Transaction should complete
7. Navigate to Leaderboard
8. Verify your score appears

---

### Test 6: Email Wallet Can Claim G$

**Expected:**
- User can initiate G$ claim
- GoodDollar identity verification happens
- G$ balance updates after claim

**Steps:**
1. Complete email login
2. Go to Home tab
3. Click "Claim G$" button
4. If not verified: complete face verification
5. If eligible: claim should process
6. G$ balance should update in ClaimUBI component

---

### Test 7: Header Display Consistency

**Expected:**
- Header shows same info for both login methods
- Wallet address display is identical
- Username handling is identical

**Steps:**
1. Login via wallet (Test 2), note:
   - Address in top-right
   - Username display (if set)
   - Verified badge (if verified with GoodDollar)
2. Logout or clear account
3. Login via email (Test 3)
4. Compare header display — should be identical

---

### Test 8: Leaderboard Shows Both User Types

**Expected:**
- Leaderboard displays users who logged in via wallet AND email
- Scores are on equal footing
- No distinction between auth methods

**Steps:**
1. Have one wallet-connect user and one email user with scores
2. Go to Leaderboard tab
3. Verify both appear in rankings
4. Verify scores are correctly ordered

---

### Test 9: Username System Works for Email Users

**Expected:**
- Email user sees username setup modal after login
- Username can be set and saved
- Username appears in header and leaderboard

**Steps:**
1. Complete email login (Test 3)
2. Username modal should appear
3. Enter a username
4. Click "Set Username"
5. Modal closes, username shows in header
6. Go to Leaderboard
7. Verify your username appears with your score

---

### Test 10: Error Handling - Email Login Cancelled

**Expected:**
- If user cancels email login modal, error is shown
- Error can be dismissed
- User can try again

**Steps:**
1. Click "Sign in with Email"
2. Web3Auth modal opens
3. Click cancel/close
4. Error message should appear on login screen
5. Click the X to dismiss error
6. Click "Sign in with Email" again — should work

---

### Test 11: Error Handling - No Web3Auth Client ID

**Expected:**
- If VITE_WEB3AUTH_CLIENT_ID is not set
- Email login button should still show
- Clicking it should show clear error message

**Steps:**
1. Remove `VITE_WEB3AUTH_CLIENT_ID` from `.env.local`
2. Restart dev server
3. Click "Sign in with Email"
4. Error message should say "not configured"
5. Set the env var and rebuild

---

### Test 12: Loading States During Authentication

**Expected:**
- Button text changes during auth
- Arrow changes to hourglass emoji (⏳)
- Buttons are disabled while connecting
- Loading state clears after success/error

**Steps:**
1. Click "Sign in with Email"
2. Observe button: text → "Signing in..." and arrow → "⏳"
3. Button should be disabled
4. Complete or cancel auth
5. Button should return to normal state

---

## Comparison Table: Wallet vs Email

| Feature | Wallet Connect | Email Login |
|---------|---|---|
| Connection method | MetaMask/MiniPay modal | Web3Auth modal |
| Wallet type | User's existing wallet | Embedded wallet |
| Key storage | User's device | Web3Auth encrypted |
| Supported on | All EVM chains | Web3Auth supported chains |
| Address format | 0x... (same) | 0x... (same) |
| Game sessions | ✅ Same via wagmi | ✅ Same via wagmi |
| Score submission | ✅ Same signing flow | ✅ Same signing flow |
| G$ claiming | ✅ Same balance hooks | ✅ Same balance hooks |
| Username | ✅ Same system | ✅ Same system |
| Leaderboard | ✅ Equal ranking | ✅ Equal ranking |

---

## Troubleshooting

### Email login button shows but Web3Auth modal doesn't open

**Check:**
1. `VITE_WEB3AUTH_CLIENT_ID` is set in `.env.local`
2. Dev server restarted after setting env var
3. Browser console for errors
4. Web3Auth dashboard has your dev domain in allowed origins

### Embedded wallet address doesn't show in header

**Check:**
1. Web3Auth authentication succeeded (no error shown)
2. Browser console for wagmi errors
3. Try refreshing page after email login
4. Check that `useAccount()` hook is firing

### Can't submit scores after email login

**Check:**
1. Address is showing in header
2. You're on Celo network (check header banner)
3. Account has enough CELO for gas
4. Browser console for transaction errors

### G$ claiming fails for email wallet

**Check:**
1. Address is verified with GoodDollar
2. Address has been verified for 12+ hours
3. Not already claimed today
4. Have completed face verification

---

## Debug Mode

To enable verbose logging:

1. Add to `frontend/src/hooks/useWeb3Auth.ts`:
   ```typescript
   const login = useCallback(async () => {
     console.log('[Web3Auth] Login initiated, isAvailable:', isAvailable);
     console.log('[Web3Auth] web3AuthConnector:', web3AuthConnector?.name);
     // ... rest of function
   }, [isAvailable, web3AuthConnector, connect]);
   ```

2. Check browser console for logs prefixed with `[Web3Auth]`

---

## Acceptance Criteria

All of the following must pass:

- [x] LoginScreen shows when no wallet is connected
- [x] "Connect Wallet" button works (existing feature)
- [ ] "Sign in with Email" button opens Web3Auth modal
- [ ] Email login creates embedded wallet with address
- [ ] Address flows through wagmi's useAccount() hook
- [ ] Game sessions work with email wallet
- [ ] Scores can be submitted with email wallet
- [ ] G$ can be claimed with email wallet
- [ ] Username system works for email users
- [ ] Leaderboard includes email wallet users
- [ ] Header display is consistent between methods
- [ ] Error messages are clear and dismissible
- [ ] Loading states show during authentication
- [ ] No errors in browser console for normal flows
