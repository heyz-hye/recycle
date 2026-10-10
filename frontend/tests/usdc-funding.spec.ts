import { test, expect } from "@playwright/test";
import { getBase58Encoder } from "@solana/kit";

for (const mode of [
  "wallet",
  "manual",
  "rejected",
  "recovery",
  "large",
  "mock",
] as const) {
  test(`government USDC amount deposit: ${mode}`, async ({ page }) => {
    const signature =
      "4D5R9nLFZ5KsGqUhxmAD6YL4DK5scX8RrAvQ9PwftLe5pyygfAK5nv8GXHBrRtCwjbusXKkH5MAQmLEfwbyEyA47";
    const treasury = "BtMXHkkGMipRN3KujxTcDiT9X44U4184dYWsQmJbKfjZ";
    const tokenLabel = mode === "mock" ? "Mock USD" : "USDC";
    const depositAmount = mode === "large" ? 10000 : 20;
    const depositUnits = depositAmount * 1000000;
    let verified = false;
    let posts = 0;
    let preparations = 0;
    await page.addInitScript(
      ({ bytes, reject }) => {
        const account = {
          address: "3SyqUm7yxkmhMR63jZ7LyyEQXzDbVfGifk3jYbGHaL5d",
          publicKey: new Uint8Array(32),
          chains: ["solana:devnet"],
          features: ["solana:signAndSendTransaction"],
        };
        const wallet = {
          version: "1.0.0",
          name: "Test Government Wallet",
          icon: "data:image/png;base64,AA==",
          chains: ["solana:devnet"],
          accounts: [account],
          features: {
            "standard:connect": {
              version: "1.0.0",
              connect: async () => ({ accounts: [account] }),
            },
            "solana:signAndSendTransaction": {
              version: "1.0.0",
              supportedTransactionVersions: ["legacy"],
              signAndSendTransaction: async (input: { chain: string }) => {
                if (input.chain !== "solana:devnet")
                  throw new Error("Wrong network");
                localStorage.setItem(
                  "test-sign-count",
                  String(
                    Number(localStorage.getItem("test-sign-count") || 0) + 1,
                  ),
                );
                if (reject) throw new Error("User rejected the request");
                return [{ signature: new Uint8Array(bytes) }];
              },
            },
          },
        };
        window.addEventListener("wallet-standard:app-ready", (event) => {
          (event as CustomEvent).detail.register(wallet);
        });
      },
      {
        bytes: Array.from(getBase58Encoder().encode(signature)),
        reject: mode === "rejected",
      },
    );
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
        mock_usdc: mode === "mock",
        inventory_usdc_base_units: mode === "mock" ? 10000000000 : 0,
        received_usdc_base_units: verified ? depositUnits : 0,
        remaining_usdc_base_units: verified ? depositUnits : 0,
        converted_usd_micros: 0,
        distributed_loop_base_units: 40000,
        treasury_address: treasury,
        usdc_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        deposits: verified
          ? [
              {
                signature,
                amount_base_units: depositUnits,
                created_at: 1791650000,
              },
            ]
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
      else if (path === "/api/funding/prepare") {
        expect(route.request().postDataJSON()).toEqual({
          source_wallet: "3SyqUm7yxkmhMR63jZ7LyyEQXzDbVfGifk3jYbGHaL5d",
          amount_base_units: depositUnits,
        });
        preparations++;
        body = { transaction_b64: "AA==" };
      } else if (path === "/api/funding/deposits") {
        expect(route.request().postDataJSON()).toEqual({ signature });
        posts++;
        if (mode === "recovery" && posts === 1) {
          await route.fulfill({
            status: 503,
            json: { detail: "Unable to verify right now" },
          });
          return;
        }
        if (mode === "wallet" && posts === 1) {
          await route.fulfill({
            status: 409,
            json: {
              detail:
                "Deposit not finalized on Devnet yet. Wait a moment and retry.",
            },
          });
          return;
        }
        verified = true;
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
      page.getByRole("heading", { name: `Deposit ${tokenLabel} funding` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add demo funding" }),
    ).toHaveCount(0);
    await expect(page.getByText(treasury, { exact: true })).toBeVisible();
    await expect(page.getByText("Rewards waiting to be credited")).toHaveCount(
      0,
    );
    await expect(page.getByLabel(`${tokenLabel} amount`)).toBeVisible();
    if (mode === "mock")
      await expect(
        page.getByText(/Test inventory: 10,000 Mock USD/),
      ).toBeVisible();
    if (mode === "mock")
      await expect(
        page.getByText(
          "Mock USD is a custom test token. It is not Circle USDC and has no monetary value.",
        ),
      ).toBeVisible();
    if (mode === "manual") {
      await page.getByText("Already sent USDC from your wallet?").click();
      await page.getByLabel("Deposit transaction signature").fill(signature);
      await page
        .getByRole("button", { name: "Verify existing deposit" })
        .click();
    } else {
      await page.getByLabel(`${tokenLabel} amount`).fill(String(depositAmount));
      await page
        .getByRole("button", { name: `Deposit ${tokenLabel}`, exact: true })
        .click();
      if (mode === "rejected") {
        await expect(page.locator(".form-panel [role=alert]")).toContainText(
          "User rejected",
        );
        expect(posts).toBe(0);
        await expect(
          page.getByText(
            `${depositAmount.toLocaleString("en-US")} ${tokenLabel} received`,
            { exact: true },
          ),
        ).toHaveCount(0);
        return;
      }
      if (mode === "recovery") {
        await expect(page.locator(".form-panel [role=alert]")).toContainText(
          "Unable to verify",
        );
        await page.reload();
        await expect(page.locator(".topbar")).toBeVisible();
        if (await menu.isVisible()) await menu.click();
        await page
          .locator("nav")
          .getByRole("button", { name: "Funding", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Check deposit status" })
          .click();
      }
    }
    await expect(
      page.getByText(
        `${depositAmount.toLocaleString("en-US")} ${tokenLabel} received`,
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    expect(preparations).toBe(mode === "manual" ? 0 : 1);
    if (mode !== "manual")
      expect(
        await page.evaluate(() => localStorage.getItem("test-sign-count")),
      ).toBe("1");
    expect(posts).toBe(mode === "wallet" || mode === "recovery" ? 2 : 1);
    await expect(
      page.getByRole("link", { name: "View deposit" }),
    ).toHaveAttribute("href", expect.stringContaining(signature));
  });
}
