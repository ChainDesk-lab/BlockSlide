import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, http, parseEther } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

/**
 * POST /api/fund-wallet
 *
 * Auto-funds newly created Magic.link wallets with a small amount of CELO for gas.
 * This is a serverless function that runs once per new wallet signup.
 *
 * Request body:
 * {
 *   address: "0x...",      // New wallet address to fund
 *   email: "user@example.com", // User email (for logging/tracking)
 * }
 *
 * Returns:
 * { success: true, txHash: "0x..." }
 * OR
 * { success: false, error: "...", alreadyFunded: boolean }
 */

const FUNDING_AMOUNT = "0.05"; // 0.05 CELO = ~50 tx worth of gas
const FUNDING_WALLET_KEY = process.env.FUNDING_WALLET_PRIVATE_KEY;

// Track funded wallets in memory (in production, use a database)
// This prevents accidental duplicate funding due to retry logic
const fundedWallets = new Set<string>();

async function isFundingRequired(address: `0x${string}`): Promise<boolean> {
  if (fundedWallets.has(address)) {
    return false;
  }

  try {
    // Check if wallet already has > 0.02 CELO (enough for gas)
    const response = await fetch("https://forno.celo.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBalance",
        params: [address, "latest"],
        id: 1,
      }),
    });

    const data = await response.json() as { result?: string };
    const balance = BigInt(data.result || "0");
    const minThreshold = parseEther("0.02");

    return balance < minThreshold;
  } catch (err) {
    console.error("Error checking wallet balance:", err);
    // On error, assume funding is needed (safe default)
    return true;
  }
}

async function fundWallet(
  toAddress: `0x${string}`,
  email: string
): Promise<{ txHash: `0x${string}` } | { error: string; alreadyFunded: boolean }> {
  if (!FUNDING_WALLET_KEY) {
    return {
      error: "Funding wallet not configured. Set FUNDING_WALLET_PRIVATE_KEY env var.",
      alreadyFunded: false,
    };
  }

  const fundingKey = FUNDING_WALLET_KEY.startsWith("0x")
    ? (FUNDING_WALLET_KEY as `0x${string}`)
    : (`0x${FUNDING_WALLET_KEY}` as `0x${string}`);

  try {
    const account = privateKeyToAccount(fundingKey);

    const client = createWalletClient({
      account,
      chain: celo,
      transport: http("https://forno.celo.org"),
    });

    // Send funding transaction
    const txHash = await client.sendTransaction({
      to: toAddress,
      value: parseEther(FUNDING_AMOUNT),
    });

    // Mark as funded in memory
    fundedWallets.add(toAddress);

    console.log(
      `✅ Funded wallet ${toAddress} (${email}) with ${FUNDING_AMOUNT} CELO. Tx: ${txHash}`
    );

    return { txHash };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Check if error is due to already being funded
    if (errorMsg.includes("nonce") || errorMsg.includes("known")) {
      console.warn(`⚠️  Possible duplicate funding attempt for ${toAddress}`);
      return { error: "Wallet may already be funded", alreadyFunded: true };
    }

    console.error(`❌ Funding failed for ${toAddress} (${email}):`, errorMsg);
    return { error: errorMsg, alreadyFunded: false };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { address, email } = (await request.json()) as {
      address?: string;
      email?: string;
    };

    // Validate input
    if (!address || !email) {
      return NextResponse.json(
        { success: false, error: "Missing address or email" },
        { status: 400 }
      );
    }

    if (!address.startsWith("0x") || address.length !== 42) {
      return NextResponse.json(
        { success: false, error: "Invalid Ethereum address" },
        { status: 400 }
      );
    }

    const checksumAddress = address.toLowerCase() as `0x${string}`;

    // Check if funding is needed
    const needsFunding = await isFundingRequired(checksumAddress);

    if (!needsFunding) {
      console.log(`ℹ️  Wallet ${checksumAddress} already has sufficient balance`);
      return NextResponse.json({
        success: true,
        message: "Wallet already funded",
        txHash: null,
      });
    }

    // Perform funding
    const result = await fundWallet(checksumAddress, email);

    if ("error" in result) {
      return NextResponse.json(
        { success: false, ...result },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      amount: FUNDING_AMOUNT,
      message: `Wallet funded with ${FUNDING_AMOUNT} CELO`,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Fund wallet API error:", errorMsg);

    return NextResponse.json(
      { success: false, error: "Internal server error: " + errorMsg },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: "Wallet funding API. POST to fund a new wallet.",
    endpoint: "/api/fund-wallet",
    method: "POST",
    body: { address: "0x...", email: "user@example.com" },
  });
}
