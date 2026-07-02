import { test } from "@playwright/test";

test("check if React onClick handler is attached", async ({ page }) => {
  console.log("=== REACT EVENT HANDLER ATTACHMENT CHECK ===\n");

  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // Click Wallet tab
  const walletTab = await page.locator("text=Wallet").first();
  await walletTab.click();
  await page.waitForTimeout(500);

  // Check if React event handler is attached to button
  const handlerInfo = await page.evaluate(() => {
    const btn = document.querySelector(".wallet-option") as HTMLButtonElement;
    if (!btn) {
      return { found: false, message: "Button not found" };
    }

    // Check all React keys
    const reactKeys = Object.keys(btn).filter((k) => k.startsWith("__react"));
    console.log(`Found React keys: ${reactKeys.join(", ")}`);

    // Try to find the fiber
    let hasFiberWithHandler = false;
    for (const key of reactKeys) {
      const fiber = (btn as any)[key];
      if (fiber && fiber.return && fiber.return.memoizedProps) {
        const props = fiber.return.memoizedProps;
        if (props.onClick) {
          hasFiberWithHandler = true;
          console.log(`Found onClick in fiber props`);
          break;
        }
      }
    }

    // Also check for onclick attribute
    const hasOnClick = !!(btn.onclick || btn.getAttribute("onclick"));

    // Check if listeners are attached via event delegation
    const isClickable = btn.style.cursor === "pointer" && !btn.disabled;

    return {
      found: true,
      hasReactKeys: reactKeys.length > 0,
      hasFiberWithHandler,
      hasOnClick,
      isClickableStyle: isClickable,
      disabled: btn.disabled,
    };
  });

  console.log("Handler check result:", JSON.stringify(handlerInfo, null, 2));

  // Now try to trigger the handler via direct function call
  console.log("\nTrying direct event dispatch...");
  const dispatchResult = await page.evaluate(() => {
    const btn = document.querySelector(".wallet-option") as HTMLButtonElement;
    if (!btn) return { success: false };

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    });

    btn.dispatchEvent(event);
    return { success: true };
  });

  console.log("Event dispatch result:", dispatchResult);

  // Check console for any handler logs
  await page.waitForTimeout(500);

  const hasLogs = await page.evaluate(() => {
    // This won't work from here but we can check the button state
    return true;
  });

  console.log("\n=== SUMMARY ===");
  if (!handlerInfo.found) {
    console.log("❌ Button not found in DOM");
  } else if (!handlerInfo.hasReactKeys) {
    console.log("❌ Button has NO React keys - React isn't tracking this element");
  } else if (!handlerInfo.hasFiberWithHandler) {
    console.log("❌ Button has React keys but NO onClick in fiber props");
  } else if (!handlerInfo.hasOnClick) {
    console.log("❌ Button has NO onclick attribute");
  } else {
    console.log("✓ Handler appears to be attached");
  }
});
