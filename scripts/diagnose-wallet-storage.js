/**
 * Diagnostic script to examine wagmi storage during connect/logout cycle.
 *
 * Run this in the browser console to capture localStorage states:
 * 1. After page load
 * 2. After connecting wallet
 * 3. After logout
 * 4. After failed reconnect attempt
 */

function dumpStorage(label) {
  console.log(`\n📍 === ${label} ===`);
  const keys = Object.keys(localStorage);

  console.log(`Total keys: ${keys.length}`);

  // Show all wagmi and auth-related keys
  const relevantKeys = keys.filter(k =>
    k.startsWith('wagmi') ||
    k.startsWith('bs_') ||
    k.includes('auth') ||
    k.includes('connector') ||
    k.includes('wallet')
  );

  if (relevantKeys.length === 0) {
    console.log('(no auth/wagmi keys found)');
  } else {
    relevantKeys.forEach(key => {
      let value = localStorage.getItem(key);
      // Truncate long values
      if (value && value.length > 100) {
        value = value.substring(0, 100) + '...';
      }
      console.log(`  ${key}: ${value}`);
    });
  }

  console.log('');
}

function watchConsoleErrors(label) {
  console.log(`\n🔴 === ${label} - Console errors ===`);
  // This just logs what errors appear in the console naturally
}

// Usage instructions:
console.log(`
DIAGNOSTIC PROCEDURE:
=====================

1. Page load - run:
   dumpStorage('AFTER PAGE LOAD')

2. Connect wallet via modal, use app - run:
   dumpStorage('AFTER SUCCESSFUL WALLET CONNECT')

3. Click logout button - run:
   dumpStorage('AFTER LOGOUT')

4. Click Connect Wallet again, click MetaMask entry, watch console - run:
   watchConsoleErrors('AFTER FAILED RECONNECT ATTEMPT')
   dumpStorage('AFTER FAILED RECONNECT')

5. Share the console output with the developer.
`);

// Make functions global
window.dumpStorage = dumpStorage;
window.watchConsoleErrors = watchConsoleErrors;
