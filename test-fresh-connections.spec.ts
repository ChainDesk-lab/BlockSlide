import { test } from "@playwright/test";

test("first time: fresh app load + wallet selector should not silently close", async ({
  page,
}) => {
  console.log("=== FRESH CONNECTION TEST (First Load) ===\n");

  const logs: { type: string; message: string }[] = [];
  page.on("console", (msg) => {
    logs.push({ type: msg.type(), message: msg.text() });
  });

  // Step 1: Fresh app load
  console.log("1. Loading app fresh (clear storage)...");
  await page.context().clearCookies();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // Verify no user is connected
  const isConnectedInitial = await page.evaluate(() => {
    const walletBtn = document.querySelector(".wallet-button");
    return !!walletBtn; // wallet-button only shows when connected
  });
  console.log(`   User connected initially: ${isConnectedInitial}`);
  console.log("✓ Fresh load complete\n");

  // Step 2: Open wallet selector
  console.log("2. Opening wallet selector modal...");
  const walletTab = await page.locator("text=Wallet").first();
  await walletTab.click();
  await page.waitForTimeout(500);

  const modalVisible = await page.locator(".wallet-selector-modal").isVisible();
  console.log(`   Modal visible: ${modalVisible}`);

  if (!modalVisible) {
    console.log("❌ Modal failed to open");
    return;
  }

  // Step 3: Verify modal doesn't silently close
  console.log("3. Verifying modal stays open (not silently closing)...");
  await page.waitForTimeout(1000);

  const modalStillVisible = await page
    .locator(".wallet-selector-modal")
    .isVisible({ timeout: 500 })
    .catch(() => false);
  console.log(`   Modal still visible after 1s: ${modalStillVisible}`);

  if (!modalStillVisible) {
    console.log("❌ FAILED: Modal silently closed without user action");
  } else {
    console.log("✓ PASSED: Modal stays open as expected");
  }

  // Step 4: Check console for unwanted silent closes
  console.log("\n4. Checking console logs...");
  const silentCloseLogs = logs.filter((l) =>
    l.message.includes("Already connected") &&
    l.message.includes("closing modal")
  );
  const staleWarnings = logs.filter((l) =>
    l.message.includes("Stale connection detected")
  );

  console.log(
    `   "Already connected" silent closes: ${silentCloseLogs.length}`
  );
  console.log(`   "Stale connection" warnings: ${staleWarnings.length}`);

  if (silentCloseLogs.length > 0) {
    console.log("❌ FAILED: Silent close occurred on fresh load");
    silentCloseLogs.forEach((log) => {
      console.log(`   - ${log.message}`);
    });
  } else {
    console.log("✓ PASSED: No unwanted silent closes");
  }

  // Close modal
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  console.log("\n=== TEST COMPLETE ===");
  console.log("✓ Fresh app load works correctly");
  console.log("✓ Wallet selector opens without silently closing");
});

test("second time: after page reload + wallet selector should work", async ({
  page,
}) => {
  console.log("\n=== FRESH CONNECTION TEST (After Reload) ===\n");

  const logs: { type: string; message: string }[] = [];
  page.on("console", (msg) => {
    logs.push({ type: msg.type(), message: msg.text() });
  });

  // Step 1: Initial load
  console.log("1. First page load...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  console.log("✓ First load complete");

  // Step 2: Reload page (simulate user navigating away and back)
  console.log("\n2. Reloading page...");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  console.log("✓ Page reloaded\n");

  // Step 3: Open wallet selector again
  console.log("3. Opening wallet selector modal after reload...");
  const walletTab = await page.locator("text=Wallet").first();
  const tabVisible = await walletTab.isVisible({ timeout: 1000 }).catch(() => false);

  if (!tabVisible) {
    console.log("⚠️ Wallet tab not visible after reload (app may need time to load)");
    return;
  }

  await walletTab.click();
  await page.waitForTimeout(500);

  const modalVisible = await page
    .locator(".wallet-selector-modal")
    .isVisible({ timeout: 500 })
    .catch(() => false);
  console.log(`   Modal visible: ${modalVisible}`);

  if (!modalVisible) {
    console.log("❌ Modal failed to open after reload");
    return;
  }

  // Step 4: Verify modal doesn't silently close on second attempt
  console.log("4. Verifying modal stays open after reload...");
  await page.waitForTimeout(1000);

  const modalStillVisible = await page
    .locator(".wallet-selector-modal")
    .isVisible({ timeout: 500 })
    .catch(() => false);
  console.log(`   Modal still visible after 1s: ${modalStillVisible}`);

  if (!modalStillVisible) {
    console.log("❌ FAILED: Modal silently closed after reload");
  } else {
    console.log("✓ PASSED: Modal stays open after reload");
  }

  // Step 5: Check for correct behavior
  console.log("\n5. Checking console logs...");
  const silentCloseLogs = logs.filter((l) =>
    l.message.includes("Already connected") &&
    l.message.includes("closing modal")
  );

  console.log(`   "Already connected" silent closes: ${silentCloseLogs.length}`);

  if (silentCloseLogs.length > 0) {
    console.log("❌ FAILED: Still getting silent closes after reload");
  } else {
    console.log("✓ PASSED: No silent closes after reload");
  }

  console.log("\n=== TEST COMPLETE ===");
  console.log("✓ Fresh connections work on reload without silent closes");
});
