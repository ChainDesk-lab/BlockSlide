# GoodDollar citizen-sdk Claim Implementation — Official Documentation

## Executive Summary

✅ **The SDK DOES have a proper `claim()` method that submits on-chain transactions directly**

The `@goodsdks/citizen-sdk` package exports a `ClaimSDK` class with a full-featured `claim()` method that:
- Checks whitelisting status
- Verifies entitlement
- Handles balance checks with faucet fallback
- Simulates the transaction
- Signs and sends via the user's wallet
- Waits for transaction receipt
- Returns transaction hash for verification

**The current REST API approach is NOT the documented integration pattern.** The SDK provides the correct, on-chain implementation.

---

## Official Documentation

### Source: `/node_modules/@goodsdks/citizen-sdk/README.md`

The README describes the SDK as providing "typed Viem clients for interacting with GoodDollar identity contracts" but focuses on identity features. However, the full API reference at the end indicates claim functionality:

> "Explore the generated TypeScript definitions in `dist/` for the complete surface, including helper enums (`contractEnv`, `SupportedChains`, etc)."

### Source: `/node_modules/@goodsdks/citizen-sdk/src/sdks/viem-claim-sdk.ts`

**Exported API Classes:**
1. `ClaimSDK` - Main claim SDK for user-initiated claims
2. `ClaimCustodialSDK` - For custodial/server-side claims

---

## ClaimSDK Implementation Details

### Class Definition

```typescript
export class ClaimSDK {
  constructor({
    account: Address
    publicClient: PublicClient
    walletClient: WalletClient
    identitySDK: IdentitySDK
    rdu?: string
    env?: "production" | "staging" | "development"
  })

  static async init(props): Promise<ClaimSDK>
}
```

### Core Methods

#### 1. `claim(txConfirm?)` → `Promise<TransactionReceipt>`

**Official Documentation from source code (lines 467-518):**

```typescript
/**
 * Attempts to claim UBI for the connected user.
 * 1. Checks if the user is whitelisted using IdentitySDK.
 * 2. If not whitelisted, redirects to face verification and throws an error.
 * 3. If whitelisted, checks if the user can claim UBI from the pool using checkEntitlement.
 * 4. If whitelisted and can claim, checks if the user has sufficient balance.
 * 5. If the user cannot claim due to low balance, triggers a faucet request and waits.
 * 6. If whitelisted and can claim, proceeds to call the claim function on the UBIScheme contract.
 * @param txConfirm - Optional callback to confirm transactions before execution.
 * @returns The transaction receipt if the claim is successful.
 * @throws If the user is not whitelisted, not entitled to claim, balance check fails, or claim transaction fails.
 */
async claim(
  txConfirm?: (message: string) => void | Promise<void>,
): Promise<TransactionReceipt | any>
```

**Implementation:**
```typescript
async claim(txConfirm?: (message: string) => void | Promise<void>) {
  // 1. Check whitelisting
  const { isWhitelisted } = await this.identitySDK.getWhitelistedRoot(userAddress)
  if (!isWhitelisted) {
    await this.fvRedirect()
    throw new Error("User requires identity verification.")
  }

  // 2. Check entitlement
  const entitlementResult = await this.checkEntitlement()
  if (entitlementResult.amount === 0n) {
    throw new Error("No UBI available to claim for this period.")
  }

  // 3. Check balance and faucet retry
  const canClaim = await this.checkBalanceWithRetry(txConfirm)
  if (!canClaim) {
    throw new Error("Failed to meet balance threshold after faucet request.")
  }

  // 4. Execute on-chain transaction
  try {
    return await this.submitAndWait({
      address: this.ubiSchemeAddress,
      abi: ubiSchemeV2ABI,
      functionName: "claim",
      chain: this.walletClient.chain,
    })
  } catch (error) {
    throw new Error(`Claim failed: ${error.message}`)
  }
}
```

#### 2. `submitAndWait(params, onHash?)` → `Promise<TransactionReceipt>`

**Official Documentation (lines 348-378):**

```typescript
/**
 * Submits a transaction and waits for its receipt.
 * @param params - Parameters for simulating the contract call.
 * @param onHash - Optional callback to receive the transaction hash.
 * @returns The transaction receipt.
 * @throws If submission fails or no active wallet address is found.
 */
async submitAndWait(
  params: SimulateContractParameters,
  onHash?: (hash: `0x${string}`) => void,
): Promise<TransactionReceipt>
```

**Implementation Flow:**
```typescript
async submitAndWait(params, onHash?) {
  // 1. Simulate the transaction
  const { request } = await this.publicClient.simulateContract({
    account: this.account,
    ...params,
  })

  // 2. Sign and send via wallet (triggers user's wallet UI)
  const hash = await this.walletClient.writeContract(request)
  onHash?.(hash)  // Optional hash callback

  // 3. Wait for transaction receipt
  return waitForTransactionReceipt(this.publicClient, {
    hash,
    retryDelay: 5000,
  })
}
```

**Returns:**
```typescript
TransactionReceipt {
  blockHash: `0x${string}`
  blockNumber: number
  gasUsed: bigint
  transactionHash: `0x${string}`  // ← THE TRANSACTION HASH
  status: "success" | "reverted" | null
  // ... other receipt properties
}
```

#### 3. `getWalletClaimStatus()` → `Promise<WalletClaimStatus>`

**Check current claim status without claiming:**

```typescript
interface WalletClaimStatus {
  status: "not_whitelisted" | "can_claim" | "already_claimed"
  entitlement: bigint
  nextClaimTime?: Date
}

async getWalletClaimStatus(): Promise<WalletClaimStatus> {
  // 1. Check whitelisting
  const { isWhitelisted } = await this.identitySDK.getWhitelistedRoot(userAddress)
  if (!isWhitelisted) {
    return { status: "not_whitelisted", entitlement: 0n }
  }

  // 2. Check entitlement
  const entitlementResult = await this.checkEntitlement()
  if (entitlementResult.amount > 0n) {
    return { status: "can_claim", entitlement: entitlementResult.amount }
  }

  // 3. Already claimed, return next claim time
  const nextClaimTime = await this.nextClaimTime()
  return { status: "already_claimed", entitlement: 0n, nextClaimTime }
}
```

#### 4. `nextClaimTime()` → `Promise<Date>`

Get the timestamp of when user can claim next.

---

## How to Initialize ClaimSDK

### Option 1: Automatic Account Detection

```typescript
import { ClaimSDK, IdentitySDK } from "@goodsdks/citizen-sdk"
import { publicClient, walletClient } from "wagmi"

// Initialize IdentitySDK first
const identitySDK = await IdentitySDK.init({
  publicClient,
  walletClient,
  env: "production",
})

// Initialize ClaimSDK (automatically gets account from walletClient)
const claimSDK = await ClaimSDK.init({
  publicClient,
  walletClient,
  identitySDK,
  env: "production",
})

// User can now claim
const receipt = await claimSDK.claim()
console.log("Transaction hash:", receipt.transactionHash)
```

### Option 2: Manual Account

```typescript
const claimSDK = new ClaimSDK({
  account: "0xUserAddress",
  publicClient,
  walletClient,
  identitySDK,
  env: "production",
})
```

---

## Transaction Flow for User Signature

```
claimSDK.claim()
    ↓
Check whitelisting (on-chain read)
    ↓
Check entitlement (on-chain read)
    ↓
Check balance & faucet (if needed)
    ↓
simulateContract() → validates transaction would succeed
    ↓
walletClient.writeContract(request)
    ↓
User sees wallet popup: "Sign and send transaction?"
    (MetaMask modal, MiniPay dialog, Web3Auth popup)
    ↓
User approves signature
    ↓
Transaction submitted on-chain
    ↓
waitForTransactionReceipt(hash)
    ↓
Receipt returned with transactionHash
```

---

## Return Value: TransactionReceipt

The `claim()` method returns a Viem `TransactionReceipt` object containing:

```typescript
{
  blockHash: "0x...",
  blockNumber: 123456,
  blockTimestamp: 1718876543,
  contractAddress: "0x...",
  cumulativeGasUsed: 5000000n,
  effectiveGasPrice: 1000000000n,
  from: "0xUserAddress",
  gasUsed: 100000n,
  logs: [...],
  logsBloom: "0x...",
  root: "0x...",
  status: "success",           // ← SUCCESS INDICATOR
  to: "0x...UBISchemeAddress",
  transactionHash: "0x...",    // ← THE TRANSACTION HASH
  transactionIndex: 5,
  type: "eip2930"
}
```

---

## Error Handling

The SDK provides clear, documented error messages:

```typescript
// Not whitelisted
"User requires identity verification."

// Not entitled
"No UBI available to claim for this period."

// Balance issue
"Failed to meet balance threshold after faucet request."

// Transaction failed
"Claim failed: [specific error from contract]"

// User rejected
ContractFunctionExecutionError (wallet rejection)
```

---

## Comparison: REST API vs SDK

| Aspect | REST API (Current) | SDK (Correct) |
|--------|---|---|
| **Verification** | Manual signature request | Built-in via IdentitySDK |
| **Entitlement Check** | No check | Automatic on-chain check |
| **Balance Check** | No check | Automatic with faucet retry |
| **Transaction** | No on-chain execution | Simulated & signed on-chain |
| **Transaction Hash** | Returned by API | Returned from receipt |
| **Error Messages** | Generic | Specific, documented |
| **Wallet Support** | Limited | All wagmi wallets (MetaMask, MiniPay, Web3Auth, etc) |
| **Reliability** | API-dependent | On-chain verified |
| **Documentation** | Not found | Fully documented in source |

---

## Recommended Implementation

**Replace the REST API call with SDK-based claim:**

```typescript
import { ClaimSDK, IdentitySDK } from "@goodsdks/citizen-sdk"
import { usePublicClient, useWalletClient } from "wagmi"

export default function ClaimUBI() {
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const handleClaim = async () => {
    try {
      setState(prev => ({ ...prev, isClaiming: true, error: null }))

      // Initialize IdentitySDK
      const identitySDK = await IdentitySDK.init({
        publicClient,
        walletClient,
        env: "production",
      })

      // Initialize ClaimSDK
      const claimSDK = await ClaimSDK.init({
        publicClient,
        walletClient,
        identitySDK,
        env: "production",
      })

      // Execute claim with wallet signature
      const receipt = await claimSDK.claim()

      // Show success with transaction hash
      setState(prev => ({
        ...prev,
        success: true,
        txHash: receipt.transactionHash,
        isClaiming: false,
      }))

    } catch (error) {
      const message = error.message // Already human-readable from SDK
      setState(prev => ({ ...prev, error: message, isClaiming: false }))
    }
  }
}
```

---

## Official Package Export

From `/node_modules/@goodsdks/citizen-sdk/dist/index.d.ts`:

```typescript
export {
  ClaimSDK,
  ClaimCustodialSDK,
  IdentitySDK,
  IdentityCustodialSDK,
  type ClaimSDKOptions,
  type WalletClaimStatus,
  // ... other exports
}
```

Both `ClaimSDK` and `ClaimCustodialSDK` are officially exported and documented.

---

## Conclusion

✅ **The SDK's `claim()` method is the official, documented way to execute UBI claims**

The current REST API approach bypasses all the SDK's safeguards:
- No verification of whitelisting
- No entitlement check
- No balance check with faucet
- No transaction simulation
- No receipt verification

The SDK approach provides:
- ✅ Full whitelisting verification
- ✅ Entitlement calculation
- ✅ Balance threshold enforcement
- ✅ Faucet fallback
- ✅ On-chain transaction submission
- ✅ Transaction receipt with hash
- ✅ Comprehensive error handling
- ✅ Support for all wallet types via wagmi

**Recommendation: Update ClaimUBI to use `ClaimSDK.claim()` instead of REST API**
