import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';

const IDENTITY_ADDRESS = '0xc361a6e67822a0edc17d899227dd9fc50bd62f42';

// Known verified wallets from the system (we'll use a sample approach)
// For demo purposes, checking a few common addresses that are likely to be verified

const IDENTITY_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'isWhitelisted',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
];

async function main() {
  console.log('[Verified Count] Connecting to Celo mainnet...\n');

  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  console.log('[Verified Count] Testing identity contract verification...\n');
  console.log(`Identity Contract: ${IDENTITY_ADDRESS}\n`);

  // Test a sample of addresses to show the system is working
  const sampleAddresses = [
    '0x0d3da768080949947380eaff0daa768080949947', // sample
    '0x189c6cd820f697eb8767cd9672ed6d7172d7d584', // sample
    '0xea5156lf5599e630ec55dbc70dbad0fe4bc56089', // sample
  ];

  console.log('Testing sample addresses:');
  console.log('─'.repeat(60));

  let verifiedCount = 0;
  for (const addr of sampleAddresses) {
    try {
      const result = await client.readContract({
        address: IDENTITY_ADDRESS,
        abi: IDENTITY_ABI,
        functionName: 'isWhitelisted',
        args: [addr],
      });
      console.log(`${addr}: ${result ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
      if (result) verifiedCount++;
    } catch (err) {
      console.error(`${addr}: ❌ ERROR -`, err.message);
    }
  }

  console.log('─'.repeat(60));
  console.log(`\nSample results: ${verifiedCount}/${sampleAddresses.length} verified\n`);

  console.log('NOTE: To get TOTAL verified users, you need:');
  console.log('1. Your actual Goldsky subgraph endpoint URL');
  console.log('2. Run: SUBGRAPH_URL="..." node run-snapshot.mjs\n');
  console.log('The subgraph URL is available in:');
  console.log('- frontend/.env.local (NEXT_PUBLIC_SUBGRAPH_URL)');
  console.log('- Goldsky dashboard (after deploying /subgraph)\n');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
