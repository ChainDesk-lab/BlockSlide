import { network } from "hardhat";

const GAME2048_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

const GAME2048_ABI = [
  {
    name: "getSession",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "active", type: "bool" },
      { name: "startTime", type: "uint256" },
      { name: "seedHash", type: "bytes32" },
    ],
  },
  {
    name: "expireSession",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "player", type: "address" }],
  },
] as const;

async function main() {
  const { viem } = await network.create();
  const [walletClient] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  if (!walletClient?.account) {
    console.error("No wallet available");
    process.exit(1);
  }

  const playerAddress = walletClient.account.address;
  console.log(`Checking session for ${playerAddress}...`);

  // Get current session
  const session = await publicClient.readContract({
    address: GAME2048_ADDRESS as `0x${string}`,
    abi: GAME2048_ABI,
    functionName: "getSession",
    args: [playerAddress],
  });

  console.log("Current session:", {
    active: session[0],
    startTime: session[1].toString(),
    seedHash: session[2],
  });

  if (!session[0]) {
    console.log("✓ No active session to clear");
    return;
  }

  // Get current block timestamp
  const blockNumber = await publicClient.getBlockNumber();
  const block = await publicClient.getBlock({ blockNumber });
  const currentTime = block.timestamp;
  const sessionTimeout = 2n * 3600n; // 2 hours
  const expiryTime = session[1] + sessionTimeout;

  console.log(`\nCurrent time: ${currentTime}`);
  console.log(`Session expiry time: ${expiryTime.toString()}`);

  if (currentTime > expiryTime) {
    console.log("✓ Session already expired");
  } else {
    const timeToAdvance = Number(expiryTime - currentTime) + 1;
    console.log(`\n⏱️  Advancing time by ${timeToAdvance} seconds...`);
    await publicClient.request({
      method: "hardhat_mine",
      params: ["0x1", `0x${timeToAdvance.toString(16)}`],
    });
  }

  // Call expireSession
  console.log("\n🔄 Clearing session...");
  const hash = await walletClient.writeContract({
    account: walletClient.account,
    address: GAME2048_ADDRESS as `0x${string}`,
    abi: GAME2048_ABI,
    functionName: "expireSession",
    args: [playerAddress],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "success") {
    console.log("✅ Session cleared!");

    // Verify
    const newSession = await publicClient.readContract({
      address: GAME2048_ADDRESS as `0x${string}`,
      abi: GAME2048_ABI,
      functionName: "getSession",
      args: [playerAddress],
    });

    console.log("\nNew session state:", {
      active: newSession[0],
      startTime: newSession[1].toString(),
    });
  } else {
    console.error("❌ Failed to clear session");
    process.exit(1);
  }
}

main().catch(console.error);
