import { test } from "@playwright/test";

test("diagnose wallet connection issues", async ({ page }) => {
  console.log("=== WALLET CONNECTION DIAGNOSTIC TEST ===\n");

  // Capture console messages
  const consoleLogs: Array<{ type: string; message: string }> = [];
  page.on("console", (msg) => {
    const entry = { type: msg.type(), message: msg.text() };
    consoleLogs.push(entry);
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  // Capture network requests
  const failedRequests: string[] = [];
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()}`);
    console.log(`[NETWORK FAILED] ${request.method()} ${request.url()}`);
  });

  // Navigate to app
  console.log("1. Navigating to http://localhost:3000...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  console.log("✓ Page loaded\n");

  // Click Wallet tab
  console.log("2. Clicking 'Wallet' tab...");
  const walletTab = await page.locator("text=Wallet").first();
  if (!await walletTab.isVisible()) {
    console.log("✗ Wallet tab not found");
    throw new Error("Wallet tab not visible");
  }
  await walletTab.click();
  await page.waitForTimeout(500);
  console.log("✓ Wallet tab clicked\n");

  // Check if wallet selector modal appeared
  console.log("3. Checking for wallet selector modal...");
  const modal = page.locator(".wallet-selector-modal");
  const isModalVisible = await modal.isVisible();
  console.log(`${isModalVisible ? "✓" : "✗"} Modal visible: ${isModalVisible}`);

  if (!isModalVisible) {
    console.log("✗ ISSUE: Modal did not appear after clicking Wallet tab");
    await page.screenshot({ path: "/tmp/no-modal.png" });
    throw new Error("Modal not visible");
  }
  console.log();

  // Inspect modal structure
  console.log("4. Analyzing modal structure...");
  const modalInfo = await modal.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      display: style.display,
      visibility: style.visibility,
      position: style.position,
      zIndex: style.zIndex,
      pointerEvents: style.pointerEvents,
    };
  });
  console.log("Modal CSS:", JSON.stringify(modalInfo, null, 2));

  // Check overlay
  const overlay = page.locator(".wallet-selector-overlay");
  const overlayInfo = await overlay.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      display: style.display,
      position: style.position,
      zIndex: style.zIndex,
      pointerEvents: style.pointerEvents,
    };
  });
  console.log("Overlay CSS:", JSON.stringify(overlayInfo, null, 2));

  // Check dialog
  const dialog = page.locator(".wallet-selector-dialog");
  const dialogInfo = await dialog.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      display: style.display,
      position: style.position,
      zIndex: style.zIndex,
      pointerEvents: style.pointerEvents,
    };
  });
  console.log("Dialog CSS:", JSON.stringify(dialogInfo, null, 2));
  console.log();

  // List available connectors
  console.log("5. Checking available wallet options...");
  const walletOptions = await page.locator(".wallet-option").all();
  console.log(`Found ${walletOptions.length} wallet options:`);
  for (const option of walletOptions) {
    const text = await option.textContent();
    console.log(`  - ${text?.trim()}`);
  }
  console.log();

  // Try clicking MetaMask
  console.log("6. Testing MetaMask button click...");
  const metamaskBtn = page.locator(".wallet-option").filter({ hasText: "MetaMask" });

  if (!await metamaskBtn.isVisible()) {
    console.log("✗ MetaMask button not visible");
    throw new Error("MetaMask button not visible");
  }

  // Inspect button state
  const btnInfo = await metamaskBtn.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      display: style.display,
      position: style.position,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      cursor: style.cursor,
      disabled: (el as HTMLButtonElement).disabled,
    };
  });
  console.log("MetaMask button CSS:", JSON.stringify(btnInfo, null, 2));

  // Inject click tracker
  await page.evaluate(() => {
    const btn = document.querySelector(".wallet-option") as HTMLButtonElement;
    if (btn) {
      const originalClick = btn.onclick;
      (btn as any).__clickCount = 0;
      btn.addEventListener("click", () => {
        (btn as any).__clickCount++;
        console.log(`[CLICK TRACKER] Button clicked, count: ${(btn as any).__clickCount}`);
      });
    }
  });

  // Attempt click
  console.log("Attempting to click MetaMask button...");
  await metamaskBtn.click({ force: false });
  console.log("✓ Click executed");

  // Wait and check state
  await page.waitForTimeout(1000);

  // Check if click was registered
  const clickCount = await metamaskBtn.evaluate((el) => {
    return (el as any).__clickCount || 0;
  });
  console.log(`Click count on button: ${clickCount}`);

  // Check console for [WalletSelector] logs
  const walletSelectorLogs = consoleLogs.filter((log) =>
    log.message.includes("[WalletSelector]")
  );
  console.log(`\nWalletSelector console messages (${walletSelectorLogs.length}):`);
  walletSelectorLogs.forEach((log) => {
    console.log(`  [${log.type.toUpperCase()}] ${log.message}`);
  });

  // Check for errors
  const errorLogs = consoleLogs.filter((log) => log.type === "error");
  console.log(`\nError logs (${errorLogs.length}):`);
  errorLogs.forEach((log) => {
    console.log(`  ${log.message}`);
  });

  // Check network failures
  console.log(`\nNetwork failures (${failedRequests.length}):`);
  failedRequests.forEach((req) => {
    console.log(`  ${req}`);
  });

  // Take screenshot
  await page.screenshot({ path: "/tmp/wallet-selector-state.png" });
  console.log("\n✓ Screenshot saved to /tmp/wallet-selector-state.png");

  // Final diagnosis
  console.log("\n=== DIAGNOSIS SUMMARY ===");
  if (walletSelectorLogs.length === 0) {
    console.log("❌ ISSUE: No [WalletSelector] logs found - click handler may not be firing");
  } else if (walletSelectorLogs.some((log) => log.message.includes("error"))) {
    console.log("❌ ISSUE: Click handler fired but encountered errors");
  } else {
    console.log("✓ Click handler appears to be firing normally");
  }

  if (errorLogs.length > 0) {
    console.log("❌ ISSUE: Console errors detected");
  }

  if (failedRequests.length > 0) {
    console.log("❌ ISSUE: Network requests failed");
  }
});
