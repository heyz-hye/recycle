import { test, expect, Page } from "@playwright/test";

async function setup(page: Page, centers: unknown[] = [], mode = "success") {
  await page.route("**/api/centers", (route) =>
    route.fulfill({ json: centers }),
  );
  await page.route("**/api/maps/config", (route) =>
    route.fulfill({
      json: {
        api_key: mode === "no-key" ? "" : "mock-browser-key",
        map_id: "DEMO_MAP_ID",
      },
    }),
  );
  await page.addInitScript(
    ({ mode }) => {
      const state = window as unknown as {
        google: unknown;
        googleSearches: unknown[];
        finishSearch?: (value: unknown) => void;
      };
      state.googleSearches = [];
      class MockMap {
        element: HTMLElement;
        constructor(element: HTMLElement) {
          this.element = element;
          element.textContent = "Google Map test surface";
        }
        setCenter() {}
        setZoom() {}
        fitBounds() {}
        panTo() {}
      }
      class Marker {
        content: HTMLElement;
        _map: MockMap | null = null;
        constructor(options: {
          map: MockMap;
          content: HTMLElement;
          title: string;
        }) {
          this.content = options.content;
          this.content.title = options.title;
          this.map = options.map;
        }
        set map(value: MockMap | null) {
          this.content.remove();
          this._map = value;
          value?.element.append(this.content);
        }
        addListener(_name: string, action: () => void) {
          this.content.addEventListener("click", action);
        }
      }
      class Bounds {
        extend() {
          return this;
        }
      }
      class Circle {
        setMap() {}
      }
      const place = (
        id: string,
        name: string,
        lat: number,
        lng: number,
        status = "OPERATIONAL",
      ) => ({
        id,
        displayName: name,
        formattedAddress: "Verified listing address",
        location: { lat: () => lat, lng: () => lng },
        businessStatus: status,
        attributions: [],
      });
      const Place = {
        searchByText: async (request: unknown) => {
          state.googleSearches.push(request);
          if (mode === "failure") throw new Error("REQUEST_DENIED");
          if (mode === "pending")
            return new Promise((resolve) => {
              state.finishSearch = resolve;
            });
          return {
            places:
              mode === "empty"
                ? []
                : [
                    place("far", "Distant result", 45, -73),
                    place(
                      "public",
                      "Nearby public recycling",
                      40.7306,
                      -73.9544,
                    ),
                    place(
                      "enrolled",
                      "Registered recycling center",
                      40.7405,
                      -73.9544,
                    ),
                    place(
                      "closed",
                      "Closed facility",
                      40.73051,
                      -73.9544,
                      "CLOSED_PERMANENTLY",
                    ),
                  ],
          };
        },
      };
      state.google = {
        maps: {
          Map: MockMap,
          LatLngBounds: Bounds,
          Circle,
          marker: { AdvancedMarkerElement: Marker },
          importLibrary: async (name: string) =>
            name === "maps"
              ? { Map: MockMap }
              : name === "places"
                ? { Place }
                : { AdvancedMarkerElement: Marker },
        },
      };
    },
    { mode },
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
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 40.7305,
    longitude: -73.9544,
    accuracy: 20,
  });
});

test("Google discovery works with no registered centers and excludes unavailable or distant results", async ({
  page,
}, info) => {
  await setup(page);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { googleSearches: unknown[] }).googleSearches
          .length,
    ),
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "Use my location", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".google-place-list li")).toHaveCount(2);
  await expect(page.locator(".google-place-list li").first()).toContainText(
    "Nearby public recycling",
  );
  await expect(page.locator(".google-place-list")).toContainText(
    "Not enrolled in LoopMint",
  );
  await expect(
    page.getByRole("button", { name: "Use for my ticket" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeDisabled();
  await expect(page.locator(".google-map-canvas")).toContainText("You");
  await expect(page.locator(".google-place-list a").first()).toHaveAttribute(
    "href",
    /destination_place_id=public/,
  );
  await page.screenshot({
    path: info.outputPath("nearby-google-results.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Clear location", exact: true })
    .click();
  await expect(page.locator(".google-discovery")).toHaveCount(0);
});

test("only an exact registered Google Place ID enables a ticket", async ({
  page,
}) => {
  await setup(page, [
    {
      id: "greenpoint",
      name: "Registered recycling center",
      address: "Enrolled address",
      latitude: 40.7405,
      longitude: -73.9544,
      is_demo: 0,
      google_place_id: "enrolled",
    },
  ]);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".google-place-list li")).toHaveCount(2);
  await expect(
    page
      .locator(".google-place-list li")
      .first()
      .getByRole("button", { name: /ticket/ }),
  ).toHaveCount(0);
  await page
    .locator(".google-place-list")
    .getByRole("button", { name: "Selected for ticket" })
    .click();
  await page.getByLabel("Dry cardboard", { exact: true }).fill("1");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/claims") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Create drop-off ticket" }).click();
  expect((await request).postDataJSON()).toEqual({
    center_id: "greenpoint",
    items: [{ material: "cardboard", quantity: 1000, unit: "grams" }],
  });
  await expect(
    page.getByRole("dialog", { name: "Your drop-off ticket" }),
  ).toBeVisible();
});

for (const mode of ["no-key", "failure", "empty"]) {
  test(`Google ${mode} gives useful feedback without disabling manual center selection`, async ({
    page,
  }) => {
    await setup(
      page,
      [
        {
          id: "greenpoint",
          name: "Manual Center",
          address: "Address",
          latitude: null,
          longitude: null,
          is_demo: 0,
        },
      ],
      mode,
    );
    await page
      .getByRole("button", { name: "Use my location", exact: true })
      .click();
    const area = page.locator(".google-discovery");
    if (mode === "empty")
      await expect(area).toContainText("No recycling listings were returned");
    else
      await expect(area.getByRole("alert")).toContainText(
        mode === "no-key" ? "not configured" : "unavailable",
      );
    await expect(
      page.getByRole("radio", { name: "Manual Center" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Create drop-off ticket" }),
    ).toBeEnabled();
  });
}

test("late Google results cannot restore cleared location", async ({
  page,
}) => {
  await setup(page, [], "pending");
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { googleSearches: unknown[] }).googleSearches
            .length,
      ),
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "Clear location", exact: true })
    .click();
  await page.evaluate(() =>
    (
      window as unknown as { finishSearch: (value: unknown) => void }
    ).finishSearch({ places: [] }),
  );
  await expect(page.locator(".google-discovery")).toHaveCount(0);
});
