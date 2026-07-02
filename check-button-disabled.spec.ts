import { test } from "@playwright/test";

test("check button disabled state when modal opens", async ({ page }) => {
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // Click Wallet tab to open modal
  await page.locator("text=Wallet").first().click();
  await page.waitForTimeout(500);

  // Check first button's disabled state
  const btnDisabledState = await page.evaluate(() => {
    const btn = document.querySelector(".wallet-option") as HTMLButtonElement;
    const style = window.getComputedStyle(btn);

    return {
      disabled: btn.disabled,
      disabledAttribute: btn.getAttribute("disabled"),
      computedOpacity: style.opacity,
      computedCursor: style.cursor,
      ariaDisabled: btn.getAttribute("aria-disabled"),
      className: btn.className,
    };
  });

  console.log("Button disabled state when modal opens:");
  console.log(JSON.stringify(btnDisabledState, null, 2));

  // Now manually set the onclick to NOT be a noop
  const manualClickResult = await page.evaluate(async () => {
    const btn = document.querySelector(".wallet-option") as HTMLButtonElement;

    // Replace the noop with a real handler
    (btn as any).onclick = () => {
      console.log("[MANUAL ONCLICK] Button was clicked!");
      return false;
    };

    // Now trigger a click
    btn.click();
    return { success: true };
  });

  await page.waitForTimeout(500);

  console.log("After setting custom onclick and clicking:", manualClickResult);
});
