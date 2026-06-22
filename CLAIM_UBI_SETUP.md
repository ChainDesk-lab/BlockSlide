# Native In-App UBI Claiming System

## Overview

BlockSlide now features native in-app UBI claiming using GoodDollar's official SDK, replacing the external redirect to GoodWallet.

**What changed:**
- ❌ Removed external redirect to `wallet.gooddollar.org`
- ✅ Added native in-app claiming component
- ✅ Face verification flow in-app (optional popup)
- ✅ Real-time entitlement checking
- ✅ Countdown timer for next eligible claim
- ✅ Live G$ balance display

---

## Installation

### 1. GoodDollar SDK Package

The identity SDK is already installed:

```bash
npm install @goodsdks/identity-sdk
```

**Installed version:** `@goodsdks/identity-sdk@1.0.5`

### 2. Component Setup

The `ClaimUBI.tsx` component is ready to use. It's already integrated in `src/components/Home.tsx`.

---

## Component: ClaimUBI.tsx

### Location
`frontend/src/components/ClaimUBI.tsx`

### Features

#### 1. **Wallet Connection Check**
- Prompts user to connect wallet if not connected
- Button shows "Connect Wallet" when no wallet is active

#### 2. **Verification Status**
- Checks if user is a verified GoodDollar human
- If not verified, shows "Verify to Claim G$" message
- "Verify Identity" button opens in-app verification flow

#### 3. **Entitlement Checking**
- Calls GoodDollar API to check daily eligibility
- Shows "Ready to claim" or "Already claimed today"
- Displays countdown to next available claim time

#### 4. **Claiming Process**
- One-click claiming (no external redirect)
- Calls native `https://api.gooddollar.org/v1/claim` endpoint
- Shows loading state during transaction
- Displays success message with updated balance
- Auto-refreshes page after successful claim

#### 5. **Balance Display**
- Shows current G$ balance in real-time
- Updates after successful claim
- Fetches from on-chain ERC-20 contract

#### 6. **Countdown Timer**
- Shows time until next claim available
- Updates every minute
- Auto-clears when claim window opens
- Format: "2h 35m"

### States

```
idle          → User not connected or loading
verifying     → User verifying identity (popup open)
loading       → Checking entitlement status
ready         → Eligible to claim, button active
claiming      → Claim in progress
claimed       → Already claimed today, disabled
verified      → Identity verified
error         → Any error occurred
success       → Claim successful
```

### Styling

All styles are defined in `frontend/src/index.css`:

**Classes:**
- `.daily-claim` - Main container
- `.daily-claim--verify-needed` - Verification required state
- `.daily-claim--claimed` - Already claimed state
- `.daily-claim--ready` - Ready to claim state
- `.daily-claim__balance` - Balance display
- `.daily-claim__countdown` - Countdown timer
- `.daily-claim__error` - Error messages
- `.daily-claim__error-message` - Alert message

---

## API Endpoints Used

### 1. Check Entitlement
```
POST https://api.gooddollar.org/v1/claim/entitlement
Body: { address: "0x..." }
Response: { entitlement: { amount: 100 }, nextClaimTime: "2026-06-21T14:00:00Z" }
```

### 2. Execute Claim
```
POST https://api.gooddollar.org/v1/claim
Body: { address: "0x..." }
Response: { txHash: "0x...", nextClaimTime: "2026-06-21T14:00:00Z" }
```

### 3. Verification Flow
```
GET https://celo-identity.org/verify?address=0x...
Opens in popup for face verification
```

---

## Production Configuration

### Celo Network
- **Mainnet:** ✅ Configured
- **RPC:** Celo Forno (public)
- **Chain ID:** 42220
- **G$ Token:** `0x62B8B11039FcfE5aB0C56E502b1C372A3D2a9c7A`

### Environment
- **Environment:** Production
- **GoodDollar API:** `api.gooddollar.org`
- **Identity Service:** `celo-identity.org`

---

## Error Handling

### Error Cases

| Error | Message | Solution |
|-------|---------|----------|
| No wallet connected | "Please connect your wallet" | Connect wallet via RainbowKit |
| Not verified | "Verify your identity to unlock daily G$ claims" | Click "Verify Identity" button |
| API unreachable | "Could not check claim status" | Check internet connection, retry |
| Verification failed | "Claim failed" | Try verification again |
| Already claimed | "Already claimed today" | Wait until next claim window (24h) |

### Loading States

- **Initial load:** "Checking eligibility..."
- **Verifying:** "Verifying..." (popup open)
- **Claiming:** "Claiming..."
- **Success:** "✓ Claimed!" (5 second display)

---

## User Flow

### First Time User (Not Verified)

```
1. User connects wallet
2. App checks identity registry
3. Shows "Verify to Claim G$" message
4. User clicks "Verify Identity" button
5. GoodDollar face verification popup opens
6. User completes verification
7. Popup closes, app checks status
8. Status updates to "Ready to claim"
```

### Returning User (Verified, Eligible)

```
1. User connects wallet (if disconnected)
2. App checks eligibility
3. Shows "Ready to claim your UBI"
4. User clicks "Claim Daily G$" button
5. Claim is executed on-chain
6. Shows "✓ Claim successful!"
7. G$ balance updates
8. Countdown timer shows next claim time
```

### Already Claimed Today

```
1. User connects wallet
2. App checks eligibility
3. Shows "Already Claimed!" with countdown
4. Button is disabled
5. Shows: "Next claim available in 2h 35m"
6. Shows current G$ balance
```

---

## Testing Locally

### Prerequisites
```bash
cd frontend
npm install
npm run dev
```

### Test Scenarios

#### 1. Wallet Not Connected
- Open http://localhost:5174
- See "Connect Wallet" button

#### 2. Wallet Connected, Not Verified
- Connect wallet via RainbowKit
- See "Verify to Claim G$" section
- Click "Verify Identity" (opens popup)

#### 3. Verified & Eligible
- After verification completes
- See "Claim Daily G$" button
- Can click to execute claim

#### 4. Already Claimed
- After claiming once
- Button shows "Already Claimed Today"
- Shows countdown: "Next claim available in 23h 55m"

---

## Customization

### Change Claim API Endpoints

Edit `src/components/ClaimUBI.tsx`:

```typescript
const CELO_IDENTITY_SERVICE = "https://celo-identity.org";
const CELO_VERIFY_URL = `${CELO_IDENTITY_SERVICE}/verify`;

// And in handleClaim():
const response = await fetch("https://api.gooddollar.org/v1/claim", {
  // ...
});
```

### Change Update Interval

Change countdown update frequency:

```typescript
// Currently updates every minute (60000ms)
const interval = setInterval(updateCountdown, 60000);
```

### Customize UI Text

Edit messages in component return statements:

```typescript
<p className="daily-claim__status">
  Your custom message here
</p>
```

---

## Troubleshooting

### Component Not Loading
- Check that ClaimUBI is imported in `Home.tsx`
- Verify CSS is loaded (`index.css`)
- Check browser console for errors

### Balance Not Showing
- Confirm G_DOLLAR_ADDRESS is correct in constants
- Verify user has connected wallet on Celo
- Check that wagmi `useBalance` hook is working

### Claim Button Disabled
- User may have already claimed today
- Check countdown timer message
- Verify user is verified (see verification message if not)

### Verification Popup Not Opening
- Check browser popup blocker
- Verify identity service URL is correct
- Check network tab for CORS issues

---

## Next Steps

1. **Testing:** Test on Celo testnet before mainnet
2. **Monitoring:** Monitor claim success rates in analytics
3. **Analytics:** Track verification completions
4. **Feedback:** Gather user feedback on UX
5. **Optimization:** Adjust UI based on user testing

---

## Related Files

- **Component:** `frontend/src/components/ClaimUBI.tsx`
- **Styles:** `frontend/src/index.css` (lines 415+)
- **Integration:** `frontend/src/components/Home.tsx`
- **Constants:** `frontend/src/lib/constants.ts`
- **Old Component:** `frontend/src/components/DailyClaim.tsx` (deprecated)

---

## Support

For issues with:
- **GoodDollar SDK:** See [@goodsdks/identity-sdk docs](https://github.com/GoodDollar/GoodDollarSDK)
- **Celo Network:** See [Celo docs](https://docs.celo.org)
- **BlockSlide:** Check GitHub issues or project README
