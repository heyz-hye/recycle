import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const credentialFile = process.env.E2E_ROLE_CREDENTIALS;
const accounts: {
  email: string;
  password: string;
  name: string;
  role: string;
  center_id: string | null;
}[] = credentialFile
  ? JSON.parse(readFileSync(credentialFile, "utf8")).accounts
  : [];

for (let index = 0; index < 4; index++) {
  const label = [
    "recycler",
    "Greenhill worker",
    "Riverside worker",
    "government fund manager",
  ][index];
  test(`individual ${label} login opens its workspace and account profile`, async ({
    page,
  }) => {
    test.skip(
      !credentialFile,
      "Provision isolated test accounts and set E2E_ROLE_CREDENTIALS.",
    );
    const account = accounts[index];
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".topbar")).toBeVisible();
    if (account.role === "verifier") {
      await expect(page.locator(".page-heading")).toContainText(
        index === 1
          ? "Greenhill Recycling Center"
          : "Riverside Recycling Center",
      );
      await expect(
        page.getByRole("heading", { name: "Drop-off queue", exact: true }),
      ).toBeVisible();
    } else if (account.role === "funding_partner") {
      await expect(
        page.getByRole("heading", { name: "Fuel the next good habit." }),
      ).toBeVisible();
      expect((await page.request.get("/api/funding")).status()).toBe(200);
    } else {
      expect((await page.request.get("/api/funding")).status()).toBe(403);
    }
    const menu = page.getByRole("button", { name: "Open navigation" });
    if (await menu.isVisible()) await menu.click();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "My account", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "My account" });
    await expect(
      dialog.getByText(account.email, { exact: true }),
    ).toBeVisible();
    if (account.role === "verifier") {
      await expect(dialog).toContainText("Recycling intake worker");
      await expect(dialog).toContainText(
        index === 1
          ? "Greenhill Recycling Center"
          : "Riverside Recycling Center",
      );
    } else if (account.role === "funding_partner") {
      await expect(dialog).toContainText("Government fund manager");
      await expect(dialog).toContainText(
        "TEST ONLY — Government Recycling Agency",
      );
      await expect(dialog).toContainText("Environmental Services (test)");
    }
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    if (await menu.isVisible()) await menu.click();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Sign in to your account" }),
    ).toBeVisible();
  });
}
