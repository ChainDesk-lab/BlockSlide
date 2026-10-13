import { createPublicClient, http, getAddress } from 'viem';
import { celo } from 'viem/chains';

const GAME2048_ADDRESS = getAddress('0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6');
const GDOLLAR_ADDRESS = getAddress('0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a');

async function main() {
  console.log('\n📊 ON-CHAIN TRANSACTION COUNT');
  console.log('═'.repeat(70));

  const client = createPublicClient({
    chain: celo,
    transport: http('https://forno.celo.org'),
  });

  const latestBlock = await client.getBlockNumber();
  const chunkSize = 4000n;

  console.log(`\nScanning blocks 0 to ${latestBlock.toString()}...\n`);

  // Collect all unique transaction hashes
  const transactionHashes = new Set();
  let eventsFound = 0;

  // Scan for all events from Game2048 contract
  console.log('📋 Counting transactions with Game2048 contract events:');
  process.stdout.write('  ');

  let fromBlock = 0n;
  while (fromBlock < latestBlock) {
    const toBlock = fromBlock + chunkSize > latestBlock ? latestBlock : fromBlock + chunkSize;

    try {
      const logs = await client.getLogs({
        address: GAME2048_ADDRESS,
        fromBlock,
        toBlock,
      });

      logs.forEach(log => {
        transactionHashes.add(log.transactionHash);
        eventsFound++;
      });

      const pct = Math.round(Number(toBlock) / Number(latestBlock) * 100);
      if (pct % 10 === 0) process.stdout.write(`${pct}%... `);

      fromBlock = toBlock + 1n;
    } catch (err) {
      fromBlock = toBlock + 1n;
    }
  }

  console.log('✓\n');

  console.log(`  Total events emitted: ${eventsFound}`);
  console.log(`  Unique transactions: ${transactionHashes.size}`);

  console.log('\n' + '═'.repeat(70));
  console.log(`\n✓ TOTAL ON-CHAIN TRANSACTIONS: ${transactionHashes.size}`);
  console.log('\nBreakdown:');
  console.log(`  • Events generated: ${eventsFound}`);
  console.log(`  • Transactions involved: ${transactionHashes.size}`);
  console.log(`  • Avg events per transaction: ${(eventsFound / transactionHashes.size).toFixed(1)}`);
  console.log('');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
