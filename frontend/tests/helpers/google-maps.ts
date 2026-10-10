import type { Page } from "@playwright/test";

export async function mockGoogleMaps(
  page: Page,
  centers: unknown[] = [],
  mode = "success",
) {
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
        searchByText: async (request: { textQuery: string }) => {
          state.googleSearches.push(request);
          if (mode === "failure") throw new Error("REQUEST_DENIED");
          if (mode === "pending")
            return new Promise((resolve) => {
              state.finishSearch = resolve;
            });
          if (request.textQuery !== "recycling center" && mode !== "empty")
            return {
              places: [
                place("area", "Greenpoint, Brooklyn", 40.7305, -73.9544),
              ],
            };
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
}
