import { createPublicClient, http, getAddress } from 'viem';
import { celo } from 'viem/chains';

const GAME2048_ADDRESS = getAddress('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6');

const GAME2048_ABI = [
  {
    inputs: [],
    name: 'shieldPrice',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'boost2xPrice',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'boost5xPrice',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

async function main() {
  console.log('\n📋 SHOP PRICES (Current)');
  console.log('─'.repeat(60));

  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  try {
    const [shieldPrice, boost2xPrice, boost5xPrice] = await Promise.all([
      client.readContract({
        address: GAME2048_ADDRESS,
        abi: GAME2048_ABI,
        functionName: 'shieldPrice',
      }),
      client.readContract({
        address: GAME2048_ADDRESS,
        abi: GAME2048_ABI,
        functionName: 'boost2xPrice',
      }),
      client.readContract({
        address: GAME2048_ADDRESS,
        abi: GAME2048_ABI,
        functionName: 'boost5xPrice',
      }),
    ]);

    const shieldG = Number(shieldPrice) / 1e18;
    const boost2xG = Number(boost2xPrice) / 1e18;
    const boost5xG = Number(boost5xPrice) / 1e18;

    console.log(`Shield Price:         ${shieldG.toFixed(2)} G$ (${shieldPrice.toString()} wei)`);
    console.log(`Boost 2x Price:       ${boost2xG.toFixed(2)} G$ (${boost2xPrice.toString()} wei)`);
    console.log(`Boost 5x Price:       ${boost5xG.toFixed(2)} G$ (${boost5xPrice.toString()} wei)`);
    console.log('─'.repeat(60) + '\n');

    // Store prices in JSON for use in calculations
    console.log('Use these prices to calculate shop spending:');
    console.log(`  Total Shield Spending = (shield_purchase_count) × ${shieldG.toFixed(2)} G$`);
    console.log(`  Total Boost Spending = (boost_2x_count × ${boost2xG.toFixed(2)}) + (boost_5x_count × ${boost5xG.toFixed(2)}) G$\n`);

  } catch (err) {
    console.error('Error fetching shop prices:', err.message);
    process.exit(1);
  }
}

main();
