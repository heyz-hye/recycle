import { test, expect, Page } from "@playwright/test";

async function sidebar(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name, exact: true })
    .click();
}

test("individual signup, account details, password change, and returning login", async ({
  page,
}, info) => {
  const email = `browser-${info.project.name}-${Date.now()}@example.com`;
  const password = "My recycling test passphrase 2026";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "New recycler? Create an account" })
    .click();
  await page.getByLabel("Full name", { exact: true }).fill("Taylor Recycler");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.screenshot({
    path: info.outputPath("individual-registration.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.getByLabel("Demo account")).toHaveCount(0);
  await sidebar(page, "My account");
  const dialog = page.getByRole("dialog", { name: "My account" });
  await expect(dialog.getByText(email, { exact: true })).toBeVisible();
  await expect(dialog.getByText("Not linked", { exact: true })).toBeVisible();
  await dialog.getByLabel("Current password").fill(password);
  await dialog.getByLabel("New password").fill(password + " changed");
  await dialog.getByRole("button", { name: "Update password" }).click();
  await expect(dialog.getByRole("status")).toContainText("Password updated");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await sidebar(page, "Sign out");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".account-login").getByRole("alert")).toContainText(
    "Email or password is incorrect",
  );
  await page
    .getByLabel("Password", { exact: true })
    .fill(password + " changed");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".topbar")).toBeVisible();
  await page.reload();
  await expect(page.locator(".topbar")).toBeVisible();
  await sidebar(page, "New drop-off");
  await expect(
    page.getByRole("button", { name: "Use my location" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("assigned staff workplace appears in workspace and account details", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Center staff", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good work starts here." }),
  ).toBeVisible();
  await expect(page.locator(".page-heading")).toContainText(
    "Greenpoint Recycling Center",
  );
  await sidebar(page, "My account");
  const dialog = page.getByRole("dialog", { name: "My account" });
  await expect(dialog.getByText("Job location", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Greenpoint Recycling Center", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("staff-job-location.png"),
    fullPage: true,
  });
});
