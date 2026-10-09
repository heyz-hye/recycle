import { test, expect, Page } from "@playwright/test";
import {
  distanceKm,
  rankCenters,
  validCoordinates,
  directionsUrl,
} from "../lib/location";
import type { Center } from "../lib/api";

async function dropoff(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the recycler demo" }).click();
  await expect(page.locator(".topbar")).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("nav")
    .getByRole("button", { name: "New drop-off", exact: true })
    .click();
  if (await menu.isVisible())
    await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Williamsburg Demo Center", exact: true }),
  ).toBeVisible();
}

test("location requests are opt-in, select nearest center, and bind its ticket", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 40.71451,
    longitude: -73.96141,
    accuracy: 20,
  });
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(
      navigator.geolocation,
    );
    (window as unknown as { locationCalls: number }).locationCalls = 0;
    navigator.geolocation.getCurrentPosition = (...args) => {
      (window as unknown as { locationCalls: number }).locationCalls++;
      original(...args);
    };
  });
  await dropoff(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { locationCalls: number }).locationCalls,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  const closest = page.getByRole("radio", {
    name: "Williamsburg Demo Center",
    exact: true,
  });
  await expect(closest).toBeChecked();
  await expect(page.locator(".center-option").first()).toContainText(
    "Williamsburg Demo Center",
  );
  await expect(page.locator(".center-option").first()).toContainText(
    "Less than 100 m away",
  );
  await expect(page.locator(".center-option").first()).toContainText(
    "Nearest listed",
  );
  await expect(page.locator(".location-privacy").last()).toContainText("20 m");
  await page.getByLabel("Dry cardboard", { exact: true }).fill("2");
  await page.screenshot({
    path: testInfo.outputPath("nearest-centers.png"),
    fullPage: true,
  });
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/claims") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Create drop-off ticket" }).click();
  const payload = (await request).postDataJSON();
  expect(Object.keys(payload).sort()).toEqual(["center_id", "items"]);
  expect(payload.center_id).toBe("williamsburg");
  await expect(page.getByRole("dialog")).toContainText(
    "Williamsburg Demo Center",
  );
  const code = await page.getByRole("dialog").locator("code").innerText();
  const claim = (await (await page.request.get("/api/claims")).json()).find(
    (c: { ticket: string }) => c.ticket === code,
  );
  expect(claim.center_id).toBe("williamsburg");
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("40.71451");
  expect(storage).not.toContain("-73.96141");
});

test("permission denial preserves manual selection and ticket creation", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (
          _success: unknown,
          error: (e: { code: number }) => void,
        ) => error({ code: 1 }),
      },
      configurable: true,
    }),
  );
  await dropoff(page);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".location-status")).toContainText(
    "permission was declined",
  );
  await page.getByLabel("Search centers").fill("Downtown");
  await page
    .getByRole("radio", { name: "Downtown Brooklyn Demo Center", exact: true })
    .check();
  await page.getByLabel("Plastic bottles", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Create drop-off ticket" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Downtown Brooklyn Demo Center",
  );
});

test("GPS timeout and unsupported browsers allow manual fallback", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (
          _success: unknown,
          error: (e: { code: number }) => void,
        ) => error({ code: 3 }),
      },
      configurable: true,
    }),
  );
  await dropoff(page);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".location-status")).toContainText("took too long");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      configurable: true,
    }),
  );
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".location-status")).toContainText(
    "Location is unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeEnabled();
});

test("manual choice overrides a pending location request and can clear location", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 40.71451, longitude: -73.96141 });
  await dropoff(page);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Williamsburg Demo Center", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Clear location", exact: true })
    .click();
  await expect(page.getByText("Nearest listed", { exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          (window as unknown as { completeGPS: PositionCallback }).completeGPS =
            success;
        },
      },
      configurable: true,
    });
  });
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeDisabled();
  await page
    .getByRole("radio", { name: "Downtown Brooklyn Demo Center", exact: true })
    .check();
  await page.evaluate(() => {
    (
      window as unknown as { completeGPS: (result: unknown) => void }
    ).completeGPS({
      coords: { latitude: 40.7305, longitude: -73.9544, accuracy: 10 },
    });
  });
  await expect(
    page.getByRole("radio", {
      name: "Downtown Brooklyn Demo Center",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeEnabled();
});

test("far-away users are not told that sample centers are nearby", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5074, longitude: -0.1278 });
  await dropoff(page);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".location-warning")).toContainText(
    "There may not be a participating center near you yet",
  );
  await expect(page.locator(".location-demo")).toContainText(
    "sample Brooklyn locations",
  );
  await expect(page.getByRole("link", { name: "Directions" })).toHaveCount(0);
});

test("centers without coordinates remain selectable and get no false distance", async ({
  page,
}) => {
  await page.route("**/api/centers", async (route) =>
    route.fulfill({
      json: [
        {
          id: "greenpoint",
          name: "Greenpoint Recycling Center",
          address: "Location not yet registered",
          latitude: null,
          longitude: null,
          is_demo: 0,
        },
      ],
    }),
  );
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: 0, longitude: 0, accuracy: 50 },
          } as GeolocationPosition),
      },
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Try the recycler demo" }).click();
  await expect(page.locator(".topbar")).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("nav")
    .getByRole("button", { name: "New drop-off", exact: true })
    .click();
  if (await menu.isVisible())
    await expect(page.locator(".sidebar")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".location-status")).toContainText(
    "do not have coordinates",
  );
  await expect(page.locator(".center-option")).toContainText(
    "Distance unavailable",
  );
  await expect(
    page.getByRole("radio", {
      name: "Greenpoint Recycling Center",
      exact: true,
    }),
  ).toBeChecked();
});

test("distance ranking handles zero, dateline, unknown positions, and safe directions", () => {
  expect(
    distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }),
  ).toBe(0);
  expect(
    distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }),
  ).toBeCloseTo(111.195, 2);
  expect(
    distanceKm(
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 },
    ),
  ).toBeCloseTo(22.239, 2);
  expect(validCoordinates({ latitude: NaN, longitude: 0 })).toBe(false);
  const real: Center = {
    id: "real",
    name: "Real Center",
    address: "Registered address",
    latitude: 0,
    longitude: 0,
    is_demo: 0,
  };
  const unknown: Center = {
    ...real,
    id: "unknown",
    name: "A no-location center",
    latitude: null,
    longitude: null,
  };
  expect(
    rankCenters([unknown, real], { latitude: 0, longitude: 0 })[0].id,
  ).toBe("real");
  const url = new URL(directionsUrl(real)!);
  expect(url.searchParams.get("destination")).toBe("0,0");
  expect(url.searchParams.has("origin")).toBe(false);
  expect(directionsUrl({ ...real, is_demo: 1 })).toBeNull();
});
