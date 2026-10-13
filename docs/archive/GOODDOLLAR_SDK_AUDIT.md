# GoodDollar SDK Implementation Audit

## Executive Summary

The GoodDollar SDK packages ARE installed, but they are **NOT consistently used** across the codebase. There's a significant disconnect between:
- **IdentityGate**: Uses SDK properly ✅
- **ClaimUBI**: Bypasses SDK, uses manual REST API and hardcoded URLs ❌

---

## 1. Package Installation Status

### ✅ INSTALLED: Both GoodDollar SDK Packages

```json
"@goodsdks/citizen-sdk": "^1.2.5",
"@goodsdks/identity-sdk": "^1.0.5"
```

**However**: Only 1 of these is actually being used in the codebase.

---

## 2. Claim Button Implementation

### Current Implementation: REST API Bypass

**File**: `frontend/src/components/ClaimUBI.tsx` (lines 158-207)

**What it does:**
```typescript
const handleClaim = async () => {
  // Calls REST API directly, NOT the SDK
  const response = await fetch("https://api.gooddollar.org/v1/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  
  // Handles response and updates state
  const data = await response.json();
  // ... state updates ...
};
```

**Issues:**
1. ❌ **Does NOT use SDK**: Hardcoded REST endpoint
2. ❌ **No SDK initialization**: Doesn't create IdentitySDK instance
3. ❌ **No wallet signing**: Claims don't request user signature
4. ❌ **API-only approach**: Relies on centralized GoodDollar API

**Verification Status Check** (lines 56-100):
```typescript
// Placeholder check - also bypasses SDK
const isVerified = true; // Line 62 - HARDCODED!

// Calls GoodDollar API directly
const response = await fetch("https://api.gooddollar.org/v1/claim/entitlement", {
  // ...
});
```

---

## 3. Face Verification Flow

### Implementation Split: Two Different Approaches

#### A. IdentityGate (Used for main verification flow)

**File**: `frontend/src/components/IdentityGate.tsx` (lines 24-73)

**Uses SDK Properly** ✅:
```typescript
import { IdentitySDK } from "@goodsdks/citizen-sdk";

const handleVerify = async () => {
  // ✅ Creates SDK instance with wagmi clients
  const sdk = new IdentitySDK({
    publicClient: publicClient as any,
    walletClient: walletClient as any,
    env: "production",
  });

  // ✅ Generates verification link using SDK method
  const link = await sdk.generateFVLink(
    false,
    window.location.href,
    TARGET_CHAIN.id,
  );

  // ✅ Opens in popup
  if (popup) {
    popup.location.href = link;
    onStarted(); // Marks as pending
  }
};
```

**Characteristics:**
- Requests wallet signature before opening popup
- Uses SDK's `generateFVLink()` method
- Proper flow: SDK → Link generation → Popup → Return
- User can restart verification or check status

#### B. ClaimUBI (Verification for claiming)

**File**: `frontend/src/components/ClaimUBI.tsx` (lines 129-156)

**Bypasses SDK** ❌:
```typescript
const handleStartVerification = () => {
  // ❌ Hardcoded URL, NO SDK
  const verifyWindow = window.open(
    `${CELO_VERIFY_URL}?address=${address}`,  // CELO_VERIFY_URL = "https://celo-identity.org/verify"
    "GoodDollar Verification",
    `width=${width},height=${height},left=${left},top=${top}`,
  );

  // ❌ Just polls if popup is closed, no integration
  const checkVerification = setInterval(async () => {
    if (verifyWindow?.closed) {
      clearInterval(checkVerification);
      setState((prev) => ({ ...prev, isVerifying: false }));
      // Dispatches generic event, doesn't check actual status
      const event = new CustomEvent("verify:complete");
      window.dispatchEvent(event);
    }
  }, 500);
};
```

**Issues:**
- Hardcoded URL: `https://celo-identity.org/verify`
- No SDK integration
- No wallet signature request
- No verification status confirmation
- Just polls if window is closed (user could close it without completing)

---

## 4. Console Errors & SDK Initialization Issues

### Potential Issues (Not Directly Observed, But Concerning):

1. **IdentitySDK might fail** if:
   - `publicClient` or `walletClient` is undefined
   - Network is not Celo mainnet
   - Already has error handling (lines 60-72) for these cases

2. **ClaimUBI verification** might silently fail because:
   - No wallet.account requirement (unlike IdentityGate)
   - No signature proof of ownership
   - Window close doesn't mean verification succeeded

3. **citizen-sdk package unused**:
   - Imported only in IdentityGate
   - Never imported in ClaimUBI
   - Second SDK package `@goodsdks/identity-sdk` is imported in package.json but **never used anywhere in code**

---

## 5. Data Flow Comparison

### IdentityGate (Proper SDK Integration)
```
User clicks "Start verification"
    ↓
IdentityGate.handleVerify() called
    ↓
Request wallet signature (wallet modal)
    ↓
IdentitySDK.generateFVLink() returns link
    ↓
Open link in popup window
    ↓
User completes face scan in popup
    ↓
User returns to app / popup closes
    ↓
App checks on-chain identity registry via useIdentity hook
    ↓
useIdentity calls useReadContract(IDENTITY_ABI, "isWhitelisted")
    ↓
Verification status confirmed on-chain
    ↓
Verified badge appears in header
```

### ClaimUBI (Manual URL + REST API)
```
User clicks "Verify Identity"
    ↓
ClaimUBI.handleStartVerification() called
    ↓
Hardcoded URL opened in popup (https://celo-identity.org/verify)
    ↓
User completes face scan in popup
    ↓
Popup closes OR user closes it
    ↓
ClaimUBI polls if popup.closed === true
    ↓
Dispatches custom "verify:complete" event (NO STATUS CHECK)
    ↓
Claim button still shows "Verify" because state.isVerified is hardcoded to true
    ↓
When user clicks Claim, REST API call made to https://api.gooddollar.org/v1/claim
    ↓
Response determines success/entitlement
```

**Problem**: ClaimUBI doesn't actually verify that the user completed verification. It just checks if the popup closed.

---

## 6. Verification Status Check Inconsistency

### In ClaimUBI:
```typescript
// Line 62: HARDCODED!
const isVerified = true; // Placeholder - in production this checks the identity registry
```

**This is a placeholder that was never replaced with actual contract checking!**

Should be:
```typescript
// Use the same pattern as the app header
const { isVerified } = useIdentity();
const isVerified = isVerified; // From hook
```

---

## 7. Package Usage Summary

| Package | Location | Usage | Status |
|---------|----------|-------|--------|
| `@goodsdks/citizen-sdk` | IdentityGate.tsx | SDK method `generateFVLink()` | ✅ Used |
| `@goodsdks/identity-sdk` | package.json only | Never imported anywhere | ❌ Unused |
| REST API | ClaimUBI.tsx | Direct fetch to api.gooddollar.org | ✅ Used but not SDK |

---

## 8. Issues Found

### Critical
1. **❌ isVerified Placeholder**: Line 62 of ClaimUBI.tsx has `const isVerified = true` as a placeholder
2. **❌ No Verification Confirmation**: ClaimUBI doesn't check if user actually completed verification
3. **❌ Hardcoded Verification URL**: ClaimUBI uses hardcoded `https://celo-identity.org/verify` instead of SDK

### High
4. **⚠️ Unused Package**: `@goodsdks/identity-sdk` is installed but never used
5. **⚠️ Two Different Flows**: IdentityGate and ClaimUBI use completely different verification approaches
6. **⚠️ No Wallet Signature**: ClaimUBI verification doesn't require wallet signature (unlike IdentityGate)

### Medium
7. **⚠️ REST API Dependency**: Claim function depends on GoodDollar API endpoint (no fallback)
8. **⚠️ No Error Recovery**: If GoodDollar API is down, claim fails silently

---

## 9. Recommendations (For When You're Ready to Fix)

**Option 1: Use IdentitySDK Consistently**
- Replace ClaimUBI verification with same IdentityGate flow
- Use `sdk.generateFVLink()` for consistency
- Check identity status via `useIdentity()` hook

**Option 2: Simplify to REST API Only**
- Remove both SDK packages (unused)
- Keep REST API calls for claim
- Use `useIdentity()` hook for verification status

**Option 3: Hybrid (Current State)**
- Keep IdentityGate using SDK
- Make ClaimUBI verification use same hook
- Keep REST API for claim execution

---

## Current State Assessment

✅ **What's Working**:
- IdentityGate verification opens and prompts user
- Claim API endpoint accepts requests
- Balance query works via wagmi

❌ **What's Broken**:
- ClaimUBI verification doesn't actually verify
- Hardcoded `isVerified = true` placeholder
- CLI verification URL is manual, not SDK-generated
- No way to know if user completed verification before claim

⚠️ **What's Unused**:
- `@goodsdks/identity-sdk` package
- `@goodsdks/citizen-sdk` in ClaimUBI (used in IdentityGate though)

---

## Files to Review

1. `frontend/src/components/ClaimUBI.tsx` - Main issue location
   - Line 62: `isVerified` placeholder
   - Line 138: Hardcoded verification URL
   - Line 168: REST API claim endpoint

2. `frontend/src/components/IdentityGate.tsx` - Reference implementation
   - Shows proper SDK usage
   - Shows proper verification flow

3. `frontend/src/hooks/useIdentity.ts` - Status source of truth
   - Checks on-chain identity registry
   - Manages cached verification state

4. `frontend/package.json` - Dependency mismatch
   - `@goodsdks/identity-sdk` never used
