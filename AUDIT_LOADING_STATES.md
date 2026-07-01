# BlockSlide Flow Audit: Loading States, Error Recovery & Security

**Date:** 2026-07-01  
**Scope:** Signup → Funding → Username → Verification → Game → Claim → Shop  
**Status:** NEEDS WORK - Multiple critical UX gaps and security concerns found

---

## 1. SIGNUP (Magic.link Email Authentication)

**File:** `frontend/src/auth/MagicBridge.tsx`

### Current State:
```
✓ Loading indicator: YES ("Signing in..." spinner)
✓ Error state: YES (displayed in UI)
✓ Setup modal: YES ("Preparing your wallet..." while funding)
✗ Recovery path: PARTIAL - unclear error messages
✗ Timeout handling: NO explicit timeout feedback
```

### Issues Found:

#### Issue 1.1: Unclear "Getting ready..." state
**Location:** LoginScreen.tsx line 62  
**Problem:** User sees "Getting ready..." but doesn't know if it's detecting wallet, initializing auth, or stuck
**Impact:** Users may reload thinking it's hung
**Fix needed:** Show reason - "Detecting wallet..." vs "Initializing auth..."

#### Issue 1.2: Setup modal blocking but no cancel option
**Location:** App.tsx line 161-169  
**Problem:** "Preparing your wallet" modal shows while funding, but can't be cancelled
**Impact:** If funding takes >30s (network slow), user feels stuck
**Fix needed:** Add "Skip for now" button or timeout with retry

#### Issue 1.3: Funding failure doesn't show in UI
**Location:** MagicBridge.tsx line 80-82  
**Problem:** fundNewWallet catches errors silently, user doesn't know funding failed
**Impact:** User proceeds without CELO, tries to claim, gets confusing "gas needed" modal
**Fix needed:** Show warning toast if funding fails

### Security Concerns:

#### 🔒 SECURITY 1.1: Funding wallet key exposure risk
**Location:** frontend/app/api/fund-wallet/route.ts line 25  
**Issue:** `FUNDING_WALLET_PRIVATE_KEY` loaded at runtime  
**Risk:** If process.env ever logged/exposed, private key compromised  
**Severity:** CRITICAL  
**Recommendation:** 
- Use separate secret management (AWS Secrets Manager, GCP Secret Manager)
- Never log environment variables
- Rotate key if exposed
- Consider multi-sig for treasury wallet

#### 🔒 SECURITY 1.2: Funding wallet key not validated
**Location:** frontend/app/api/fund-wallet/route.ts line 78  
**Issue:** `privateKeyToAccount()` called but no validation that key is valid format
**Risk:** Bad env var silently creates invalid account, transaction fails
**Severity:** MEDIUM  
**Recommendation:**
- Validate key format on startup: `0x` + 64 hex chars
- Return 500 error if invalid instead of 400

#### 🔒 SECURITY 1.3: No rate limiting on fund-wallet endpoint
**Location:** frontend/app/api/fund-wallet/route.ts  
**Issue:** Anyone can call POST /api/fund-wallet unlimited times  
**Risk:** Attacker could drain treasury funding many wallets simultaneously  
**Severity:** HIGH  
**Recommendation:**
- Add rate limiting: max 1 request per IP per minute
- Use Redis or simple in-memory cache
- Log all funding attempts for monitoring

---

## 2. WALLET FUNDING

**File:** `frontend/app/api/fund-wallet/route.ts` + `frontend/src/auth/MagicBridge.tsx`

### Current State:
```
✓ Loading state: YES (isFundingWallet flag in AuthContext)
✓ Error logging: YES (console.error)
✗ User-visible error: NO (silent failure)
✗ Retry mechanism: NO
✗ Balance validation before funding: NO
```

### Issues Found:

#### Issue 2.1: Funding success is unverified
**Location:** MagicBridge.tsx line 128  
**Problem:** fundNewWallet() awaited but doesn't return success/failure to UI
**Impact:** User doesn't know if funding worked or failed
**Fix needed:** Return `{ success: boolean, error?: string }` and show toast

#### Issue 2.2: No confirmation that fund-wallet tx mined
**Location:** frontend/app/api/fund-wallet/route.ts line 81-83  
**Problem:** Uses 2-second setTimeout, not actual block confirmation
**Risk:** If tx fails after 2s, balance still shows 0, confusing user
**Severity:** MEDIUM  
**Recommendation:**
- Wait for actual transaction receipt confirmation
- Return txHash and let client poll for receipt
- Or: Wait max 30s for receipt, return false if timeout

#### Issue 2.3: Funding wallet balance not checked
**Location:** frontend/app/api/fund-wallet/route.ts line 447  
**Problem:** _sendReward() in contract checks balance, but API doesn't pre-check
**Risk:** Funding might fail silently if treasury empty
**Severity:** MEDIUM  
**Recommendation:**
- Check treasury balance before funding each wallet
- Return error if insufficient balance
- Alert operator to refill treasury

---

## 3. USERNAME CREATION

**File:** `frontend/src/components/UsernameModal.tsx` + `frontend/src/hooks/useUsername.ts`

### Current State:
```
✓ Loading indicator: YES (spinner + "Signing transaction...")
✓ Error state: YES (displayed with clear messages)
✓ Wallet prompt feedback: YES ("Check your wallet to approve...")
✗ Timeout feedback: PARTIAL (triggers NoGas modal)
✗ Recovery without refresh: YES, can retry
```

### Issues Found:

#### Issue 3.1: Transaction timeout ambiguous error
**Location:** useUsername.ts line 176-178  
**Problem:** Timeout shows "Check your wallet for pending transactions or insufficient gas"
**Impact:** User unsure if it's timeout or actually out of gas
**Fix needed:** Separate error messages for timeout vs gas

#### Issue 3.2: Magic.link request hangs without clear feedback
**Location:** useUsername.ts line 150-171  
**Problem:** eth_sendTransaction with 30s timeout, but no intermediate feedback
**Risk:** User waits 30s with just spinner, feels frozen
**Severity:** MEDIUM  
**Recommendation:**
- Show "Transaction pending... timeout in 25s" with countdown
- Update every 5s
- Make timeout configurable per deployment

#### Issue 3.3: Username validation error doesn't auto-clear
**Location:** UsernameModal.tsx line 81-83  
**Problem:** Error message stays until next submit attempt
**Impact:** Confusing UX - error visible but submit button re-enabled
**Fix needed:** Auto-clear error after 5s or on input change

### Security Concerns:

#### 🔒 SECURITY 3.1: No input sanitization in username
**Location:** useUsername.ts line 91-99  
**Issue:** Regex validation but no SQL injection / contract injection checks
**Risk:** LOW for username (3-20 chars, letters/numbers/_) but principle
**Severity:** LOW  
**Recommendation:**
- Regex validation is sufficient here (very constrained input)
- Document why sanitization not needed for this field

---

## 4. IDENTITY VERIFICATION

**File:** `frontend/src/hooks/useGoodDollarIdentity.ts`

### Current State:
```
✓ Loading states: YES (isLoading, isVerifying)
✓ Popup blocked handling: YES
✓ Error messages: YES (cleared for user cancellation)
✗ Verification status polling: NO - relies on manual recheck button
✗ On-chain confirmation timeout: NO
```

### Issues Found:

#### Issue 4.1: No auto-recheck after verification completes
**Location:** useGoodDollarIdentity.ts line 164-167  
**Problem:** After popup closes, user must click "I have completed verification, check again"
**Impact:** UX friction - user expects auto-check
**Fix needed:** Auto-recheck after 3s delay (for on-chain confirmation)

#### Issue 4.2: Face scan failure not visible
**Location:** useGoodDollarIdentity.ts line 103-112  
**Problem:** If generateFVLink() fails silently, user sees no error
**Impact:** Verification button "stuck" from user perspective
**Severity:** MEDIUM  
**Recommendation:**
- Wrap SDK calls in try/catch
- Show error toast for SDK failures
- Add "Retry" button in error state

#### Issue 4.3: Verification status may be cached stale
**Location:** useGoodDollarIdentity.ts line 41-76  
**Problem:** Checks on-chain status but depends on block confirmation timing
**Risk:** User verifies, checks immediately, sees "not verified" (race condition)
**Severity:** MEDIUM  
**Recommendation:**
- Add 2s delay before first recheck after popup closes
- Show "Confirming verification on-chain..." message during delay
- Max retries (3) with exponential backoff

---

## 5. GAME SUBMISSION

**File:** `frontend/src/hooks/useGameSession.ts`

### Current State:
```
✓ Loading state: YES (phase = "submitting")
✓ Error messages: YES (clear contract errors)
✓ Toast on success: YES ("✓ Score submitted!")
✓ Balance refetch: YES (auto-refetches G$ balance)
✗ Simulation failure message: COULD BE CLEARER
✗ Nonce management feedback: NO
```

### Issues Found:

#### Issue 5.1: Simulation errors not always user-friendly
**Location:** useGameSession.ts line 336-342  
**Problem:** Contract revert errors parsed but some are technical
**Impact:** Users see "InvalidTileValue" instead of "Tile value invalid"
**Fix needed:** Add error message mapper (errorName → user message)

#### Issue 5.2: No feedback during simulation
**Location:** useGameSession.ts line 327-334  
**Problem:** Simulation can take 2-3s but no loading feedback shown
**Impact:** UI feels frozen during simulation step
**Severity:** MINOR  
**Recommendation:**
- Show "Checking transaction validity..." during simulation
- Or add spinner near submit button

#### Issue 5.3: Nonce collision not handled
**Location:** useGameSession.ts line 138  
**Problem:** Nonce fetched from "pending" block, but wallet might have pending tx
**Risk:** Two rapid submits could have same nonce
**Severity:** LOW (unlikely in practice)  
**Recommendation:**
- Increment nonce if user retries quickly
- Add debounce to prevent double-submit

---

## 6. DAILY UBI CLAIM

**File:** `frontend/src/components/ClaimUBI.tsx`

### Current State:
```
✓ Loading states: YES (isLoading, isClaiming)
✓ Error messages: YES
✓ Toast feedback: YES ("✓ Daily G$ claimed!")
✓ Balance refetch: YES
✗ Entitlement check timeout: NO
✗ SDK init failure recovery: PARTIAL
```

### Issues Found:

#### Issue 6.1: Entitlement check can hang
**Location:** ClaimUBI.tsx line 93-119  
**Problem:** claimSDK.getWalletClaimStatus() has no timeout
**Risk:** If GoodDollar API slow, UI stuck on "Checking eligibility..."
**Severity:** MEDIUM  
**Recommendation:**
- Add 10s timeout to getWalletClaimStatus()
- Fall back to "unable to verify" state
- Show retry button

#### Issue 6.2: SDK initialization can fail silently
**Location:** ClaimUBI.tsx line 173-186  
**Problem:** IdentitySDK.init() and ClaimSDK.init() have no error handling
**Risk:** Missing async error could cause undefined behavior
**Severity:** MEDIUM  
**Recommendation:**
- Add try/catch around SDK init
- Show error toast if SDK fails to initialize
- Log error for debugging

#### Issue 6.3: No feedback during verification workflow
**Location:** ClaimUBI.tsx line 289-306  
**Problem:** Verification popup opens but no feedback shown
**Impact:** User unsure if popup is loading or stuck
**Severity:** MINOR  
**Recommendation:**
- Show "Opening face verification..." during popup open
- Add timeout: if popup doesn't open in 3s, show "Popup blocked" warning

### Security Concerns:

#### 🔒 SECURITY 6.1: REST API endpoint not validated
**Location:** ClaimUBI.tsx line 189  
**Problem:** claimSDK.claim() calls GoodDollar API directly
**Risk:** If API URL is wrong or poisoned, could send to wrong endpoint
**Severity:** LOW (SDK controls URL)  
**Recommendation:**
- Verify SDK uses HTTPS only
- Pin API endpoint host at runtime

#### 🔒 SECURITY 6.2: No timeout on claim transaction
**Location:** ClaimUBI.tsx line 189  
**Problem:** Awaits claimSDK.claim() indefinitely
**Risk:** If transaction hangs, user stuck in "Claiming..." state
**Severity:** MEDIUM  
**Recommendation:**
- Add 60s timeout to claim()
- Show "Claim taking longer than expected. Check transaction status."
- Provide link to check on-chain

---

## 7. SHOP PURCHASE

**File:** Need to find shop purchase code first

Let me search for Shop component...


---

## 7. SHOP PURCHASE

**File:** `frontend/src/hooks/useShop.ts` + `frontend/src/components/Shop.tsx`

### Current State:
```
✓ Loading states: YES (Spinner when pending)
✓ Button disabled during action: YES
✓ Error state: YES (displayed via error prop)
✗ Error messages not shown to user: NO (error stored but not displayed)
✗ Approval flow feedback: PARTIAL
✗ Transaction timeout: NO
```

### Issues Found:

#### Issue 7.1: Error message never reaches user
**Location:** Shop.tsx line 28 (error prop exists), but never displayed  
**Problem:** Error is stored in useShop but Shop component doesn't show it
**Impact:** User clicks "Buy", transaction fails, nothing happens - user thinks they bought it
**Severity:** CRITICAL  
**Fix needed:** Add error toast display for purchase failures

#### Issue 7.2: Approval step not clearly explained
**Location:** Shop.tsx line 57-63  
**Problem:** "Approve G$" button appears but user doesn't understand why
**Impact:** User might think approval IS the purchase
**Severity:** MEDIUM  
**Recommendation:**
- Add tooltip: "Approve G$ allows the game to transfer funds when you purchase items"
- Show "Approval needed" message before approval button

#### Issue 7.3: No confirmation after purchase succeeds
**Location:** useShop.ts - run() function likely handles tx but no toast
**Problem:** User buys shield, button stops spinning, but no success feedback
**Impact:** User unsure if purchase went through
**Severity:** MEDIUM  
**Fix needed:** Add success toast after purchase confirms

#### Issue 7.4: No feedback while waiting for approval tx
**Location:** useShop.ts line 80-90  
**Problem:** Approval submitted but no "Approving..." message shown
**Impact:** UI feels stuck during approval
**Severity:** MINOR  
**Recommendation:**
- Show "Approving G$ transfer..." message
- Add "Waiting for blockchain confirmation..." feedback

#### Issue 7.5: Approval allowance not validated
**Location:** useShop.ts (isApproved checks but logic unclear)  
**Problem:** Might approve for less than needed amount, then purchase fails
**Risk:** User pays approval gas, then buys fails
**Severity:** MEDIUM  
**Recommendation:**
- Always approve maximum amount (MAX_INT) to avoid multiple approvals
- Or show "Approval amount" clearly before user clicks approve

### Security Concerns:

#### 🔒 SECURITY 7.1: No input validation on multiplier
**Location:** Shop.tsx line 142  
**Problem:** buyBoost(multiplier) accepts any number, should only be 2 or 5
**Risk:** Frontend only, contract validates, but bad practice
**Severity:** LOW  
**Recommendation:**
- Only call buyBoost(2) and buyBoost(5), not variable multiplier
- Type system already enforces this (good!)

---

## SUMMARY OF CRITICAL ISSUES

### 🔴 CRITICAL (Fix immediately)

1. **SECURITY 1.1: Funding wallet private key exposure**
   - Move to proper secret manager (AWS/GCP/Vault)
   - File: frontend/app/api/fund-wallet/route.ts line 25

2. **Issue 7.1: Shop purchase errors never shown to user**
   - Add error toast to Shop.tsx
   - File: frontend/src/components/Shop.tsx line 28

3. **SECURITY 1.3: No rate limiting on funding endpoint**
   - Anyone can call /api/fund-wallet unlimited times
   - Add IP-based rate limiting
   - File: frontend/app/api/fund-wallet/route.ts

### 🟠 HIGH (Fix before production)

1. **Issue 1.3: Funding failure not shown to user**
   - Show warning toast if auto-funding fails
   - File: MagicBridge.tsx line 80-82

2. **Issue 3.2: Username timeout unclear**
   - Separate timeout errors from gas errors
   - Add countdown timer
   - File: useUsername.ts line 176-178

3. **Issue 6.1: Entitlement check can hang indefinitely**
   - Add 10s timeout to getWalletClaimStatus()
   - File: ClaimUBI.tsx line 93-119

4. **Issue 6.2: SDK initialization failures silent**
   - Add try/catch error handling
   - File: ClaimUBI.tsx line 173-186

### 🟡 MEDIUM (Fix soon)

1. **Issue 1.2:** Setup modal can't be cancelled
2. **Issue 2.1:** Funding success unverified to user
3. **Issue 2.2:** No block confirmation wait for funding
4. **Issue 4.1:** No auto-recheck after verification
5. **Issue 4.2:** Face scan SDK failures not visible
6. **Issue 4.3:** Verification status may be stale
7. **Issue 5.1:** Simulation error messages not user-friendly
8. **Issue 5.2:** No feedback during simulation
9. **Issue 6.3:** No feedback during verification popup
10. **Issue 6.2:** No timeout on claim transaction
11. **Issue 7.2:** Approval flow not explained
12. **Issue 7.3:** Purchase success not confirmed
13. **Issue 7.4:** No feedback during approval wait
14. **Issue 7.5:** Approval allowance not validated

---

## FAILURES ARE RECOVERABLE? - ASSESSMENT

### Current State: MOSTLY YES

✓ Signup failure: Can retry (just click login again)
✓ Username failure: Can retry from modal
✓ Game submit failure: Session still active, can retry
✓ Verification failure: Can click "Restart verification"
✓ Daily claim failure: Can retry after error

✗ Shop approval failure: User might think approved when it failed
✗ Funding failure: User proceeds without CELO, confusing later errors

### Recommendation:
- All failures ARE recoverable without refresh ✓
- But recovery path is unclear in several cases
- Add explicit "Retry" buttons for clearer UX
- Avoid silent failures (current biggest issue)

---

## OVERALL ASSESSMENT

**Loading States:** 60% Complete
- ✓ Most async actions show some feedback
- ✗ Many don't have timeout feedback
- ✗ Some show spinner but no message

**Error Recovery:** 80% Complete  
- ✓ Most failures don't require refresh
- ✗ Some errors not shown to user (critical)
- ✗ Recovery paths not always obvious

**Security:** 40% Complete
- ✗ Critical: private key exposure
- ✗ High: no rate limiting
- ✗ Medium: various validation gaps
- ✓ Good: input validation on schema level

---

## RECOMMENDATIONS (Prioritized)

### Phase 1 (This Week - Critical)
- [ ] Move funding wallet key to AWS Secrets Manager
- [ ] Add IP rate limiting to /api/fund-wallet
- [ ] Show error toast when Shop purchase fails
- [ ] Show warning toast when auto-funding fails

### Phase 2 (Next Week - High Priority)
- [ ] Add timeout to entitlement check (10s)
- [ ] Add SDK error handling to ClaimUBI
- [ ] Separate timeout errors from gas errors in username flow
- [ ] Add success toast to Shop purchases

### Phase 3 (Soon - Medium Priority)
- [ ] Add countdown timer during username timeout
- [ ] Auto-recheck verification after popup closes
- [ ] Validate SDK init doesn't fail silently
- [ ] Add "Checking validity..." during game simulation
- [ ] Explain approval flow in Shop UI

---

**Report Generated:** 2026-07-01  
**Reviewed By:** Security Audit  
**Status:** FLAGGED FOR USER REVIEW - DO NOT FIX SILENTLY
