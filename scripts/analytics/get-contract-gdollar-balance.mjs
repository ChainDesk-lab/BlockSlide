import { createPublicClient, http, getAddress } from 'viem';
import { celo } from 'viem/chains';

const GAME2048_ADDRESS = getAddress('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6');
const GDOLLAR_ADDRESS = getAddress('0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a');

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

async function main() {
  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  console.log('\n📊 Game2048 Contract G$ Balance (Current)');
  console.log('─'.repeat(60));

  try {
    const balance = await client.readContract({
      address: GDOLLAR_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [GAME2048_ADDRESS],
    });

    const balanceG = Number(balance) / 1e18;

    console.log(`Contract Address: ${GAME2048_ADDRESS}`);
    console.log(`G$ Balance: ${balanceG.toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`);
    console.log(`Raw Wei: ${balance.toString()}\n`);

    console.log('This balance represents:');
    console.log('  - Shop proceeds not yet distributed');
    console.log('  - UBI pool funds pending transfer');
    console.log('  - Any other G$ held by the contract\n');

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
