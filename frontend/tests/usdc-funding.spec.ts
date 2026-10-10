import { test, expect } from "@playwright/test";

test("fund manager verifies USDC deposits without entering dollar funding", async ({
  page,
}) => {
  const signature =
    "4D5R9nLFZ5KsGqUhxmAD6YL4DK5scX8RrAvQ9PwftLe5pyygfAK5nv8GXHBrRtCwjbusXKkH5MAQmLEfwbyEyA47";
  const treasury = "BtMXHkkGMipRN3KujxTcDiT9X44U4184dYWsQmJbKfjZ";
  let verified = false;
  let posts = 0;
  const funding = () => ({
    received_cents: 999999,
    available_cents: 999999,
    reserved_cents: 0,
    issued_cents: 0,
    redeemed_cents: 0,
    pending_reimbursement_cents: 0,
    awaiting_funding: 0,
    ledger: [],
    blocked_rewards: [],
    usdc: {
      received_usdc_base_units: verified ? 20000000 : 0,
      remaining_usdc_base_units: verified ? 20000000 : 0,
      converted_usd_micros: 0,
      distributed_loop_base_units: 40000,
      treasury_address: treasury,
      usdc_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      deposits: verified
        ? [{ signature, amount_base_units: 20000000, created_at: 1791650000 }]
        : [],
    },
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path === "/api/health")
      body = { mode: "devnet", demo_accounts_enabled: false };
    else if (path === "/api/auth/me")
      body = {
        id: "test-fund-manager",
        username: "Test fund manager",
        wallet: "",
        role: "funding_partner",
        center_id: null,
        email: "fund@example.com",
      };
    else if (path === "/api/wallet")
      body = {
        totals: { bottles: 0, cardboard_grams: 0, reward_base_units: 0 },
        balance_base_units: 0,
        pending_base_units: 0,
        rewards: [],
        redemptions: [],
      };
    else if (path === "/api/impact")
      body = {
        bottles: 0,
        cardboard_grams: 0,
        reward_base_units: 0,
        dropoffs: 0,
        participants: 0,
        centers: [],
        daily: [],
      };
    else if (path === "/api/funding/deposits") {
      expect(route.request().postDataJSON()).toEqual({ signature });
      verified = true;
      posts++;
      body = funding();
    } else if (path === "/api/funding") body = funding();
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await expect(page.locator(".topbar")).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Funding", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Deposit USDC funding" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add demo funding" }),
  ).toHaveCount(0);
  await expect(page.getByText(treasury, { exact: true })).toBeVisible();
  await page.getByLabel("Deposit transaction signature").fill(signature);
  await page.getByRole("button", { name: "Verify USDC deposit" }).click();
  await expect(
    page.getByText("20 USDC received", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Deposit transaction signature")).toHaveValue(
    "",
  );
  expect(posts).toBe(1);
  await expect(
    page.getByRole("link", { name: "View deposit" }),
  ).toHaveAttribute("href", expect.stringContaining(signature));
});
