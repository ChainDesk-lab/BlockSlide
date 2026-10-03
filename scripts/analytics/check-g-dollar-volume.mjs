import { createPublicClient, http, getAddress } from 'viem';
import { celo } from 'viem/chains';

const GAME2048_ADDRESS = getAddress('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6');
const GDOLLAR_ADDRESS = getAddress('0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a'); // G$ token on Celo

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

async function main() {
  console.log('[G$ Volume] Connecting to Celo mainnet...\n');

  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  console.log('Fetching G$ volume data...\n');

  try {
    // Get Game2048 contract's G$ balance (UBI pool)
    const contractBalance = await client.readContract({
      address: GDOLLAR_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [GAME2048_ADDRESS],
    });

    // Get total G$ supply
    const totalSupply = await client.readContract({
      address: GDOLLAR_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'totalSupply',
      args: [],
    });

    // Convert from wei (18 decimals) to G$ tokens
    const contractBalanceG = Number(contractBalance) / 1e18;
    const totalSupplyG = Number(totalSupply) / 1e18;

    console.log('═'.repeat(60));
    console.log('📊 BLOCKSLIDE G$ VOLUME METRICS');
    console.log('═'.repeat(60));
    console.log(`\nGame2048 Contract G$ Balance: ${contractBalanceG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`);
    console.log(`Total G$ Supply (Celo): ${totalSupplyG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`);
    console.log(`\nContract Address: ${GAME2048_ADDRESS}`);
    console.log(`G$ Token Address: ${GDOLLAR_ADDRESS}`);
    console.log('\n═'.repeat(60));

    console.log('\nℹ️  For complete G$ distribution metrics, run Dune queries:');
    console.log('  - Query 7: Total G$ Rewards Paid Out (all-time)');
    console.log('  - Query 8: Daily G$ Rewards (trend)');
    console.log('  - Query 5: Total XP Distributed\n');

  } catch (err) {
    console.error('Error fetching G$ data:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
