import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const IDENTITY_ADDRESS = "0xc361a6e67822a0edc17d899227dd9fc50bd62f42";

// Test addresses from the leaderboard logs (full checksummed addresses)
const TEST_ADDRESSES = [
  "0xcb6f72152DB12546b21ef0dD5F614Ca532531838", // The verified wallet from screenshots
];

const IDENTITY_ABI = [
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "isWhitelisted",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function testVerification() {
  const publicClient = createPublicClient({
    chain: celo,
    transport: http("https://forno.celo.org"), // Official Celo RPC
  });

  console.log(
    `Testing isWhitelisted on contract ${IDENTITY_ADDRESS} via https://forno.celo.org\n`
  );

  for (const addr of TEST_ADDRESSES) {
    try {
      const result = await publicClient.readContract({
        address: IDENTITY_ADDRESS as `0x${string}`,
        abi: IDENTITY_ABI,
        functionName: "isWhitelisted",
        args: [addr as `0x${string}`],
      });

      console.log(`✓ ${addr.padEnd(42)} → isWhitelisted = ${result}`);
    } catch (err) {
      console.error(
        `✗ ${addr.padEnd(42)} → ERROR: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

testVerification().catch(console.error);
