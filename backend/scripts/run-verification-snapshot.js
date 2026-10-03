#!/usr/bin/env node

// Simple wrapper to run the verification snapshot job
require('ts-node').register({
  project: require('path').join(__dirname, '../../tsconfig.json'),
  transpileOnly: true,
});

const { runVerificationSnapshot } = require('../jobs/verification-snapshot');

runVerificationSnapshot()
  .then(snapshot => {
    console.log('\n✅ Snapshot completed successfully!\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Snapshot failed:', err, '\n');
    process.exit(1);
  });
