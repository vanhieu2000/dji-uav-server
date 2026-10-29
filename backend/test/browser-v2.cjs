const engines = require("playwright-core"),
  engineName = process.env.BROWSER_ENGINE || "chromium",
  express = require("express"),
  path = require("path"),
  assert = require("assert/strict");
(async () => {
  const app = express();
  app.use(
    "/dashboard",
    express.static(path.resolve(__dirname, "../public/dashboard")),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.on("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await engines[engineName].launch({
    ...(engineName === "chromium"
      ? {
          executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
          args: ["--no-sandbox"],
        }
      : {}),
    headless: true,
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      }),
      errors = [],
      writes = [];
    page.on("pageerror", (e) => errors.push(e.stack));
    await page.addInitScript(() => {
      window.WebSocket = class {
        send() {}
        close() {}
      };
    });
    await page.route("**/*", async (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== base) return r.fulfill({ body: "" });
      if (!u.pathname.startsWith("/api/")) return r.continue();
      const method = r.request().method();
      if (method !== "GET" && u.pathname !== "/api/diagnostics/client")
        writes.push({
          url: u.pathname,
          body: r.request().headers()["content-type"]?.includes("json")
            ? r.request().postDataJSON()
            : null,
        });
      let data = [];
      if (u.pathname === "/api/health") data = { db: { connected: true } };
      if (u.pathname === "/api/auth/me")
        data = { user_id: 1, username: "review-admin", role: "ADMIN" };
      if (u.pathname === "/api/workspace/context")
        data = {
          plants: [
            {
              plant_id: 7,
              plant_name: "Test plant",
              center_lat: 11,
              center_lng: 107,
            },
          ],
        };
      if (u.pathname === "/api/workspace/assignments")
        data = {
          people: [{ user_id: 1, full_name: "Engineer" }],
          units: [{ unit_id: 2, unit_name: "Unit" }],
          teams: [{ team_id: 3, team_name: "Team" }],
        };
      if (u.pathname === "/api/devices")
        data = [
          { device_sn: "REAL-SN", device_type: "DRONE", gateway_sn: "REAL-RC" },
        ];
      if (u.pathname === "/api/flight-plans")
        data = [
          { route_id: 8, route_name: "Template A", route_kind: "POINTS" },
          { route_id: 9, route_name: "Template B", route_kind: "POINTS" },
        ];
      if (u.pathname === "/api/flight-plans/geofence/7")
        data = {
          boundary: {
            type: "Polygon",
            coordinates: [
              [
                [106, 10],
                [108, 10],
                [108, 12],
                [106, 12],
                [106, 10],
              ],
            ],
          },
          exclusions: [],
        };
      if (u.pathname === "/api/admin/runtime-config")
        data = {
          active: {},
          saved: { MEDIA_DIR: "/tmp/uav-photos" },
          vision: {},
          restart_required: true,
        };
      if (u.pathname === "/api/insights/charts")
        data = {
          tickets: [],
          statuses: [],
          defects: [],
          areas: [],
          temperatures: [],
          levels: [],
        };
      if (u.pathname === "/api/insights/alert-report")
        data = { items: [], total: 0, page: 1, page_size: 20 };
      if (u.pathname === "/api/monitoring/photos")
        data = { items: [], next_id: 0, has_more: false };
      if (u.pathname === "/api/reports/overview") data = {};
      if (u.pathname === "/api/assets/tree")
        data = { areas: [], substations: [] };
      if (u.pathname === "/api/monitoring/config")
        data = { device_mode: "single" };
      if (u.pathname === "/api/tickets/1")
        data = {
          ticket: {
            ticket_id: 1,
            ticket_code: "TEST",
            ticket_name: "Inspection",
            status: "ASSIGNED",
          },
          routes: [],
          photos: [
            {
              media_id: 2,
              file_name: "thermal.jpg",
              lens: "IR",
              vision_status: "SUCCEEDED",
              max_temperature: 65,
            },
          ],
          defects: [],
          crew: [],
          executions: [],
          progress: { flights: [] },
        };
      if (u.pathname === "/api/tickets/1/vision")
        data = {
          items: [{ job_id: 1, status: "QUEUED" }],
          has_more: false,
          next_id: 1,
        };
      return r.fulfill({ json: { code: 0, data } });
    });
    await page.goto(base + "/dashboard/");
    await page.waitForFunction(() => !!window.DeviceReadiness);
    assert.equal(
      await page.locator("#manual-live-pip #device-readiness").count(),
      1,
    );
    await page.evaluate(() => openCreateTicketModal());
    await page.waitForSelector("#ticket-modal.active");
    await page.fill("#modal-ticket-name", "Weekly inspection");
    await page.fill("#modal-ticket-facility", "Plant north");
    await page.selectOption("#modal-ticket-period", "Hàng tuần");
    await page.selectOption("#modal-ticket-drone", "REAL-SN");
    await page.selectOption("#modal-ticket-route", ["8", "9"]);
    await page.evaluate(() => submitCreateTicket());
    await page.waitForFunction(
      () =>
        !document.getElementById("ticket-modal").classList.contains("active"),
    );
    const t = writes.find((x) => x.url === "/api/tickets").body;
    assert.equal(t.inspection_cycle, "WEEKLY");
    assert.equal(t.plant_id, 7);
    assert.deepEqual(t.route_ids, [8, 9]);
    assert.equal(t.assigned_device_sn, "REAL-SN");
    await page.evaluate(() => switchView("admin"));
    await page.evaluate(() => switchAdminTab("system"));
    await page.waitForFunction(
      () =>
        document.getElementById("cfg-media-dir").value === "/tmp/uav-photos",
    );
    await page.fill("#cfg-media-dir", "/tmp/new-photo-folder");
    await page.evaluate(() => saveMediaStoragePath());
    await page.waitForTimeout(200);
    assert.equal(
      writes.find((x) => x.url === "/api/admin/runtime-config").body.MEDIA_DIR,
      "/tmp/new-photo-folder",
    );
    await page.evaluate(() => switchAdminTab("2d-maps"));
    await page.waitForSelector("#ortho-map-plant", { state: "attached" });
    assert.equal(await page.locator("#ortho-map-file").isVisible(), false);
    await page.evaluate(() => openMapRegistration("ortho-map"));
    assert.equal(
      await page.locator(".page-view.active").getAttribute("id"),
      "view-maps-2d-edit",
    );
    assert.equal(await page.locator("#ortho-map-file").isVisible(), true);
    assert.equal(
      await page.locator("#ortho-map-file").getAttribute("accept"),
      ".zip",
    );
    assert.ok(
      !(await page.locator("#ortho-map-table-body").innerText()).includes(
        "145 MB",
      ),
    );
    await page.evaluate(() => openTicketDetailModal(1));
    await page.waitForSelector("#dtl-operations");
    await page.evaluate(() => renderDetailPhotosGrid("defect"));
    assert.equal(await page.locator("#dtl-photos-grid img").count(), 0);
    await page.evaluate(() => renderDetailPhotosGrid("ir"));
    assert.equal(await page.locator("#dtl-photos-grid img").count(), 1);
    assert.match(
      await page.locator("#dtl-photos-grid").innerText(),
      /AI chưa phát hiện lỗi/,
    );
    await page.evaluate(() => closeTicketDetailModal());
    await page.evaluate(() => openUavModal());
    assert.equal(
      await page.locator(".page-view.active").getAttribute("id"),
      "view-uav-edit",
    );
    await page.evaluate(() => closeUavModal());
    await page.evaluate(() => queueTicketVision(1));
    assert.ok(writes.some((x) => x.url === "/api/tickets/1/vision"));
    await page.evaluate(() => switchView("flight-plans"));
    await page.waitForFunction(
      () => document.getElementById("gis-fp-plant")?.value === "7",
    );
    assert.equal(await page.locator("#gis-fp-plant").inputValue(), "7");
    await page.evaluate(() => switchView("flight-plan-edit"));
    await page.fill("#gis-fp-name", "Manual template");
    await page.click("#gis-fp-pick-btn");
    await page.locator("#gis-fp-map").click({ position: { x: 180, y: 160 } });
    await page.locator("#gis-fp-map").click({ position: { x: 230, y: 210 } });
    await page.click("#gis-fp-create");
    await page.waitForTimeout(200);
    const plan = writes.find((x) => x.url === "/api/flight-plans").body;
    assert.equal(plan.plant_id, 7);
    assert.equal(plan.points.length, 2);
    assert.equal(plan.points[0].lenses, "wide,ir");

    for (const [width, height] of [
      [390, 844],
      [768, 1024],
      [1366, 768],
    ]) {
      await page.setViewportSize({ width, height });
      for (const view of [
        "dashboard",
        "tickets-solar",
        "flight-plans",
        "flight-history",
        "admin",
        "account-management",
        "maps-2d",
        "offline-maps",
        "maps-2d-edit",
        "offline-maps-edit",
        "account-edit",
        "ticket-edit",
        "account",
      ]) {
        await page.evaluate((v) => switchView(v), view);
        await page.waitForTimeout(100);
        const overflow = await page.evaluate(() => {
          const p = document.querySelector(".page-view.active");
          return p.scrollWidth - p.clientWidth;
        });
        if (overflow > 2)
          console.log(
            await page.evaluate(() =>
              [...document.querySelectorAll(".page-view.active *")]
                .filter((e) => e.getBoundingClientRect().right > innerWidth + 2)
                .slice(0, 10)
                .map((e) => ({
                  tag: e.tagName,
                  id: e.id,
                  cls: e.className,
                  width: e.getBoundingClientRect().width,
                })),
            ),
          );
        assert.ok(overflow <= 2, `${view} at ${width}: overflow ${overflow}`);
      }
    }
    if (process.env.V2_SCREENSHOT_DIR) {
      const fs = require("fs");
      fs.mkdirSync(process.env.V2_SCREENSHOT_DIR, { recursive: true });
      for (const [view, width, height] of [
        ["control-manual", 1440, 900],
        ["control-manual", 390, 844],
        ["account-management", 1440, 900],
        ["maps-2d", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate((v) => switchView(v), view);
        await page.waitForTimeout(300);
        await page.screenshot({
          path: path.join(
            process.env.V2_SCREENSHOT_DIR,
            view + "-" + width + ".png",
          ),
        });
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS flat UI: real weekly/multi-template ticket payload, persisted settings request, honest map upload, Vision enqueue, planner plant, and responsive pages",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
