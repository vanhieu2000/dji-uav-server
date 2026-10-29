/* Presentation adapters for the flat UI. Native Pilot/MQTT control methods are not reimplemented here. */
const V2 = { users: [], units: [], plants: [], maps: [], uploading: false };
const v2esc = (s) => window.GIS.esc(s);
async function v2api(method, url, body, options) {
  return (await GIS.api(method, url, body, options)).data;
}
function v2message(s) {
  if (typeof toast === "function") toast(s);
}
window.switchAdminTab = function (tab) {
  const routes = {
    accounts: "account-management",
    "offline-maps": "offline-maps",
    "2d-maps": "maps-2d",
  };
  if (routes[tab]) return switchView(routes[tab]);
  loadRuntimeConfig();
  window.loadNativeStorageStatus?.();
  if (GIS.Vision?.renderRules)
    GIS.Vision.renderRules(document.getElementById("settings-alert-rules"));
};
window.loadAdminUsers = async function () {
  const body = document.getElementById("admin-user-table-body");
  if (!body) return;
  try {
    [V2.users, V2.units] = await Promise.all([
      v2api("GET", "/api/admin/users"),
      v2api("GET", "/api/admin/units"),
    ]);
    V2.plants = (await v2api("GET", "/api/workspace/context")).plants;
    filterAdminUsers();
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6">${v2esc(e.message)}</td></tr>`;
  }
};
window.filterAdminUsers = function () {
  const q =
      document
        .getElementById("admin-user-search")
        ?.value.toLocaleLowerCase("vi")
        .trim() || "",
    role = document.getElementById("admin-user-role-filter")?.value;
  document.getElementById("admin-user-table-body").innerHTML =
    V2.users
      .filter(
        (u) =>
          (!role || u.role === role) &&
          (!q ||
            [u.username, u.full_name]
              .join(" ")
              .toLocaleLowerCase("vi")
              .includes(q)),
      )
      .map(
        (u) =>
          `<tr><td>${v2esc(u.username)}</td><td>${v2esc(u.full_name)}</td><td>${v2esc(u.email || "—")}</td><td>${v2esc(u.role)}<br><small>${u.all_operation_scopes ? "Toàn bộ nghiệp vụ" : (u.plant_ids || []).length + " nhà máy"}</small></td><td>${v2esc(u.status)}</td><td><button class="btn sm" onclick="openUserModal(${u.user_id})">Sửa / phạm vi</button><button class="btn sm" onclick="deleteAdminUser(${u.user_id})">Khóa</button></td></tr>`,
      )
      .join("") || '<tr><td colspan="6">Không có tài khoản phù hợp.</td></tr>';
};
function prepareAccountScope() {
  if (document.getElementById("user-form-unit")) return;
  const box = document.createElement("fieldset");
  box.id = "v2-account-scope";
  box.innerHTML =
    '<legend>Phạm vi nghiệp vụ</legend><label>Đơn vị<select class="input" id="user-form-unit"></select></label><label><input type="checkbox" id="user-form-all"> Toàn bộ nghiệp vụ (operator, không gồm quản trị)</label><div id="user-form-plants"></div><button class="btn" type="button" id="user-reset-password">Đặt lại mật khẩu</button>';
  document.getElementById("form-admin-user").append(box);
  document.getElementById("user-reset-password").onclick = async () => {
    try {
      const id = document.getElementById("user-form-id").value,
        password = document.getElementById("user-form-pwd").value;
      if (!id || !password)
        throw Error("Chọn tài khoản và nhập mật khẩu mới trước");
      await v2api("POST", `/api/admin/users/${id}/password`, { password });
      document.getElementById("user-form-pwd").value = "";
      v2message("Đã đặt lại mật khẩu; các phiên cũ được thu hồi.");
    } catch (e) {
      document.getElementById("user-form-error").textContent = e.message;
    }
  };
  document.getElementById("user-form-role").addEventListener("change", () => {
    const c = document.getElementById("user-form-all");
    c.disabled = document.getElementById("user-form-role").value !== "OPERATOR";
    if (c.disabled) c.checked = false;
  });
}
window.openUserModal = async function (id) {
  if (!V2.users.length) await loadAdminUsers();
  prepareAccountScope();
  const u = V2.users.find((u) => u.user_id === Number(id));
  document.getElementById("form-admin-user").reset();
  document.getElementById("user-form-error").textContent = "";
  document.getElementById("modal-user-title").textContent = u
    ? "Sửa tài khoản " + u.username
    : "Thêm tài khoản";
  document.getElementById("user-form-id").value = u?.user_id || "";
  for (const [el, key] of [
    ["username", "username"],
    ["fullname", "full_name"],
    ["email", "email"],
    ["role", "role"],
    ["status", "status"],
  ])
    document.getElementById("user-form-" + el).value =
      u?.[key] || { role: "OPERATOR", status: "ACTIVE" }[key] || "";
  document.getElementById("user-form-username").disabled = !!u;
  const pwd = document.getElementById("user-form-pwd");
  pwd.required = !u;
  pwd.minLength = 12;
  pwd.value = "";
  document.getElementById("user-form-pwd-note").textContent = u
    ? "Để trống khi lưu thông tin. Dùng nút Đặt lại mật khẩu để đổi mật khẩu riêng."
    : "Tối thiểu 12 byte";
  document.getElementById("user-form-pwd-note").style.display = "block";
  document.getElementById("user-form-unit").innerHTML =
    '<option value="">Chưa gán</option>' +
    V2.units
      .map((x) => `<option value="${x.unit_id}">${v2esc(x.unit_name)}</option>`)
      .join("");
  document.getElementById("user-form-unit").value = u?.unit_id || "";
  document.getElementById("user-form-plants").innerHTML = V2.plants
    .map(
      (p) =>
        `<label><input type="checkbox" value="${p.plant_id}" ${(u?.plant_ids || []).includes(p.plant_id) ? "checked" : ""}> ${v2esc(p.plant_name)}</label>`,
    )
    .join("");
  const all = document.getElementById("user-form-all");
  all.checked = u ? !!u.all_operation_scopes : true;
  all.disabled = document.getElementById("user-form-role").value !== "OPERATOR";
  document.getElementById("user-reset-password").disabled = !u;
  document.getElementById("modal-user-form").classList.add("active");
  switchView("account-edit");
};
window.closeUserModal = () => {
  document.getElementById("modal-user-form").classList.remove("active");
  switchView("account-management");
};
window.saveAdminUser = async function (e) {
  e.preventDefault();
  const get = (k) => document.getElementById("user-form-" + k).value,
    id = get("id"),
    password = get("pwd"),
    error = document.getElementById("user-form-error");
  try {
    if (id && password)
      throw Error(
        "Dùng nút Đặt lại mật khẩu; lưu thông tin không đổi mật khẩu.",
      );
    const role = get("role"),
      b = {
        username: get("username").trim(),
        full_name: get("fullname").trim(),
        email: get("email").trim(),
        role,
        status: get("status"),
        unit_id: Number(get("unit")) || null,
        plant_ids: [
          ...document.querySelectorAll("#user-form-plants input:checked"),
        ].map((c) => Number(c.value)),
        all_operation_scopes:
          role === "OPERATOR" &&
          document.getElementById("user-form-all").checked,
      };
    if (!id) b.password = password;
    await v2api(
      id ? "PUT" : "POST",
      "/api/admin/users" + (id ? "/" + id : ""),
      b,
    );
    closeUserModal();
    await loadAdminUsers();
    v2message("Đã lưu tài khoản và phạm vi");
  } catch (x) {
    error.textContent = x.message;
  }
};
window.deleteAdminUser = async function (id) {
  if (
    !confirm(
      "Khóa tài khoản và thu hồi phiên đăng nhập? Lịch sử nghiệp vụ được giữ lại.",
    )
  )
    return;
  try {
    await v2api("PUT", "/api/admin/users/" + id, { status: "LOCKED" });
    await loadAdminUsers();
  } catch (e) {
    v2message(e.message);
  }
};
async function loadRuntimeConfig() {
  try {
    const c = await v2api("GET", "/api/admin/runtime-config"),
      value = (k) => c.saved[k] ?? c.active[k] ?? "";
    document.getElementById("cfg-media-dir").value = value("MEDIA_DIR");
    document.getElementById("cfg-vision-api").value = value("VISION_ENDPOINT");
    document.getElementById("cfg-vision-public-base").value =
      value("VISION_PUBLIC_BASE_URL") || location.origin;
    document.getElementById("cfg-vision-enabled").checked =
      value("VISION_ENABLED") === "true";
    document.getElementById("vision-api-status").textContent =
      (c.restart_required ? "Có cấu hình chờ khởi động lại. " : "") +
      (c.vision.enabled ? "Worker đã bật. " : "Worker chưa bật. ") +
      (c.vision.credentials_configured
        ? "Đã có khóa callback."
        : "Chưa có khóa callback.");
  } catch (e) {
    document.getElementById("vision-api-status").textContent = e.message;
  }
}
window.saveMediaStoragePath = async () => {
  try {
    await v2api("PUT", "/api/admin/runtime-config", {
      MEDIA_DIR: document.getElementById("cfg-media-dir").value.trim(),
    });
    v2message(
      "Đã lưu trên server. Khởi động lại để dùng thư mục mới; ảnh cũ giữ nguyên.",
    );
    await loadRuntimeConfig();
  } catch (e) {
    v2message(e.message);
  }
};
window.saveVisionApiConfig = async () => {
  try {
    const b = {
      VISION_ENDPOINT: document.getElementById("cfg-vision-api").value.trim(),
      VISION_PUBLIC_BASE_URL: document
        .getElementById("cfg-vision-public-base")
        .value.trim(),
      VISION_ENABLED: String(
        document.getElementById("cfg-vision-enabled").checked,
      ),
    };
    for (const [id, k] of [
      ["cfg-vision-secret", "VISION_WEBHOOK_SECRET"],
      ["cfg-vision-token", "VISION_API_TOKEN"],
    ])
      if (document.getElementById(id).value)
        b[k] = document.getElementById(id).value;
    await v2api("PUT", "/api/admin/runtime-config", b);
    document.getElementById("cfg-vision-secret").value =
      document.getElementById("cfg-vision-token").value = "";
    await loadRuntimeConfig();
    v2message("Đã lưu cấu hình Vision trên server; khởi động lại để áp dụng.");
  } catch (e) {
    document.getElementById("vision-api-status").textContent = e.message;
  }
};
window.testVisionApiConnection = async () => {
  const el = document.getElementById("vision-api-status");
  el.textContent = "Đang kiểm tra endpoint đã lưu trên server…";
  try {
    const d = await GIS.api(
      "POST",
      "/api/admin/runtime-config/test-vision",
      {},
    );
    el.textContent = d.message;
  } catch (e) {
    el.textContent = e.message;
  }
};
async function loadMapPackages() {
  try {
    V2.maps = await v2api("GET", "/api/basemaps");
    V2.plants = (await v2api("GET", "/api/workspace/context")).plants;
    for (const [prefix, tbodyId] of [
      ["offline-pkg", "offline-pkg-table-body"],
      ["ortho-map", "ortho-map-table-body"],
    ]) {
      const body = document.getElementById(tbodyId);
      if (body)
        body.innerHTML =
          V2.maps
            .map(
              (m) =>
                `<tr><td>${v2esc(m.map_name)}</td><td>${v2esc(m.scheme)} · ${m.tile_count} ô</td><td>${(Number(m.size_bytes) / 1024 ** 2).toFixed(1)} MB</td><td><button type="button" class="btn sm" onclick="preview2DMapOnGIS(${m.map_id})">Xem</button><button type="button" class="btn sm" onclick="openMapRegistration('${prefix}',${m.map_id})">Sửa</button><button type="button" class="btn sm" onclick="deleteMapPackage(${m.map_id})">Xóa</button><button type="button" class="btn sm" onclick="activateMapPackage(${m.map_id})">Đặt mặc định</button></td></tr>`,
            )
            .join("") ||
          '<tr><td colspan="4">Chưa có bản đồ được tải lên.</td></tr>';
      const input = document.getElementById(prefix + "-file");
      if (input && !document.getElementById(prefix + "-plant")) {
        const l = document.createElement("label");
        l.innerHTML = `Nhà máy<select class="input" id="${prefix}-plant"></select><small>Dùng ZIP chứa {z}/{x}/{y}.png hoặc .jpg đã xuất từ ảnh trực giao; không nhận TIFF/MBTiles trực tiếp.</small><label>Hệ ô ảnh<select class="input" id="${prefix}-scheme"><option value="XYZ">XYZ</option><option value="TMS">TMS</option></select></label>`;
        input.closest(".field").before(l);
      }
      const sel = document.getElementById(prefix + "-plant");
      if (sel)
        sel.innerHTML =
          '<option value="">Chọn nhà máy</option>' +
          V2.plants
            .map(
              (p) =>
                `<option value="${p.plant_id}">${v2esc(p.plant_name)}</option>`,
            )
            .join("");
      if (sel && V2.plants.length === 1) sel.value = V2.plants[0].plant_id;
    }
  } catch (e) {
    v2message(e.message);
  }
}
async function uploadMapPackage(prefix) {
  if (V2.uploading) return;
  try {
    if (V2.mapEditId) {
      await v2api("PUT", "/api/basemaps/" + V2.mapEditId, {
        map_name: document.getElementById(prefix + "-name").value.trim(),
      });
      V2.mapEditId = null;
      await loadMapPackages();
      switchView(prefix === "ortho-map" ? "maps-2d" : "offline-maps");
      return;
    }
    const file = document.getElementById(prefix + "-file")?.files[0],
      name = document.getElementById(prefix + "-name")?.value.trim(),
      plant = document.getElementById(prefix + "-plant")?.value;
    if (!file || !name || !plant)
      throw Error("Chọn nhà máy, tên bản đồ và ZIP ô ảnh");
    if (!/\.zip$/i.test(file.name))
      throw Error(
        "Chỉ hỗ trợ ZIP ô ảnh XYZ/TMS. Xuất tiles từ QGIS/DJI Terra trước khi tải.",
      );
    V2.uploading = true;
    v2message("Đang tải và kiểm tra ô ảnh; không đóng trang.");
    const body = new FormData();
    body.set("file", file);
    body.set("map_name", name);
    body.set("plant_id", plant);
    body.set("scheme", document.getElementById(prefix + "-scheme").value);
    await v2api("POST", "/api/basemaps/upload", body, { timeoutMs: 1800000 });
    await loadMapPackages();
    await window.fetchActivePlantBasemap?.();
    v2message("Server đã lưu bản đồ và các ô ảnh.");
    switchView(prefix === "ortho-map" ? "maps-2d" : "offline-maps");
  } catch (e) {
    v2message(e.message);
  } finally {
    V2.uploading = false;
  }
}
window.uploadOfflineMapPackage = () => uploadMapPackage("offline-pkg");
window.upload2DOrthoMap = () => uploadMapPackage("ortho-map");
window.activateMapPackage = async (id) => {
  try {
    await v2api("PUT", "/api/basemaps/" + id, { is_active: true });
    await loadMapPackages();
    await fetchActivePlantBasemap();
    v2message("Đã đặt bản đồ mặc định");
  } catch (e) {
    v2message(e.message);
  }
};
window.preview2DMapOnGIS = async (id) => {
  try {
    V2.maps = await v2api("GET", "/api/basemaps");
    const m = V2.maps.find((m) => m.map_id === Number(id));
    if (!m) throw Error("Chọn bản đồ đã lưu");
    gActivePlantMap = m;
    BASEMAPS.plant_upload.url = m.tile_url;
    BASEMAPS.plant_upload.native = m.max_zoom;
    BASEMAPS.plant_upload.scheme = m.scheme;
    BASEMAPS.plant_upload.bounds = m.bounds;
    switchView("map-solar");
    setBasemap("plant_upload", "solar");
  } catch (e) {
    v2message(e.message);
  }
};
window.editCurrentFlightPlan = () => switchView("flight-plans");

// Single ticket form and detail workflow, shared by all entry buttons.
let v2EditingTicket = null,
  v2FormRevision = null;
function optionList(rows, id, name, empty) {
  return (
    `<option value="">${empty}</option>` +
    rows
      .map(
        (r) =>
          `<option value="${v2esc(r[id])}">${v2esc(r[name] || r[id])}</option>`,
      )
      .join("")
  );
}
window.openTicketModal = (type) => openCreateTicketModal(type);
window.openCreateTicketModal = async function (type, ticket) {
  try {
    const [ctx, assign, routes, devices] = await Promise.all([
      v2api("GET", "/api/workspace/context"),
      v2api("GET", "/api/workspace/assignments"),
      v2api("GET", "/api/flight-plans"),
      v2api("GET", "/api/devices"),
    ]);
    v2EditingTicket = ticket?.ticket_id || null;
    document.querySelector("#ticket-modal h2").textContent = ticket
      ? "Sửa phiếu kiểm tra"
      : "Thêm phiếu kiểm tra";
    v2FormRevision = ticket?.revision ?? null;
    const set = (id, value) =>
      (document.getElementById("modal-ticket-" + id).value = value ?? "");
    document.getElementById("modal-ticket-plant").innerHTML = optionList(
      ctx.plants,
      "plant_id",
      "plant_name",
      "Chọn nhà máy",
    );
    document.getElementById("modal-ticket-unit").innerHTML = optionList(
      assign.units,
      "unit_id",
      "unit_name",
      "Chưa gán đơn vị",
    );
    document.getElementById("modal-ticket-team").innerHTML = optionList(
      assign.teams,
      "team_id",
      "team_name",
      "Chưa giao tổ",
    );
    document.getElementById("modal-ticket-inspector").innerHTML = optionList(
      assign.people,
      "user_id",
      "full_name",
      "Chưa giao kỹ sư",
    );
    document.getElementById("modal-ticket-drone").innerHTML = optionList(
      devices.filter((d) => d.device_type === "DRONE"),
      "device_sn",
      "device_name",
      "Chưa giao UAV",
    );
    const rcs = [
      ...new Set(
        devices.flatMap((d) =>
          d.gateway_sn
            ? [d.gateway_sn]
            : ["RC", "REMOTE_CONTROLLER"].includes(d.device_type)
              ? [d.device_sn]
              : [],
        ),
      ),
    ];
    document.getElementById("modal-ticket-rc").innerHTML =
      '<option value="">Chưa giao RC</option>' +
      rcs.map((sn) => `<option>${v2esc(sn)}</option>`).join("");
    document.getElementById("modal-ticket-route").innerHTML = routes
      .map(
        (r) => `<option value="${r.route_id}">${v2esc(r.route_name)}</option>`,
      )
      .join("");
    for (const [id, k] of [
      ["name", "ticket_name"],
      ["facility", "target_facility"],
      ["type", "inspection_type"],
      ["plant", "plant_id"],
      ["unit", "unit_id"],
      ["team", "team_id"],
      ["inspector", "inspector_id"],
      ["drone", "assigned_device_sn"],
      ["rc", "assigned_rc_sn"],
      ["category", "target_category"],
    ])
      set(
        id,
        ticket?.[k] ||
          { type: type || "OVERALL_SURVEY", category: "OTHER" }[id] ||
          "",
      );
    if (!ticket && ctx.plants.length === 1)
      set("plant", ctx.plants[0].plant_id);
    const cycles = {
      DAILY: "Hàng ngày",
      WEEKLY: "Hàng tuần",
      MONTHLY: "Hàng tháng",
      AD_HOC: "Đột xuất",
    };
    set("period", cycles[ticket?.inspection_cycle] || "Đột xuất");
    for (const k of ["start", "end"]) {
      const value = ticket?.["planned_" + k + "_at"];
      if (value) {
        const d = new Date(value);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        set(k, d.toISOString().slice(0, 16));
      } else set(k, "");
    }
    const selected = ticket
      ? (
          (await v2api("GET", "/api/tickets/" + ticket.ticket_id)).routes || []
        ).map((r) => r.route_id)
      : [];
    for (const o of document.getElementById("modal-ticket-route").options)
      o.selected = selected.includes(Number(o.value));
    document.getElementById("ticket-modal").classList.add("active");
    switchView("ticket-edit");
  } catch (e) {
    v2message(e.message);
  }
};
window.submitCreateTicket = async function () {
  try {
    const get = (k) => document.getElementById("modal-ticket-" + k).value,
      cycles = {
        "Hàng ngày": "DAILY",
        "Hàng tuần": "WEEKLY",
        "Hàng tháng": "MONTHLY",
        "Đột xuất": "AD_HOC",
      };
    const b = {
      ticket_name: get("name").trim(),
      inspection_type: get("type"),
      target_facility: get("facility").trim(),
      inspection_cycle: cycles[get("period")] || "AD_HOC",
      target_category: get("category"),
      plant_id: Number(get("plant")) || null,
      unit_id: Number(get("unit")) || null,
      team_id: Number(get("team")) || null,
      inspector_id: Number(get("inspector")) || null,
      assigned_device_sn: get("drone") || null,
      assigned_rc_sn: get("rc") || null,
      route_ids: [
        ...document.getElementById("modal-ticket-route").selectedOptions,
      ].map((o) => Number(o.value)),
      planned_start_at: get("start")
        ? new Date(get("start")).toISOString()
        : null,
      planned_end_at: get("end") ? new Date(get("end")).toISOString() : null,
    };
    if (!b.ticket_name || !b.target_facility || !b.plant_id)
      throw Error("Nhập tên, phạm vi và chọn nhà máy");
    if (v2EditingTicket) b.revision = v2FormRevision;
    await v2api(
      v2EditingTicket ? "PUT" : "POST",
      "/api/tickets" + (v2EditingTicket ? "/" + v2EditingTicket : ""),
      b,
    );
    closeTicketModal();
    await loadTicketsFromDatabase();
    v2message("Đã lưu phiếu và danh sách đường bay");
  } catch (e) {
    v2message(e.message);
  }
};
window.watchTicketLive = (id, sn) => {
  if (!sn) return v2message("Phiếu chưa giao UAV");
  window.openTicketLive(Number(id), sn);
};
const v2OriginalOpenTicket = window.openTicketDetailModal;
window.openTicketDetailModal = async function (id) {
  await v2OriginalOpenTicket(id);
  if (
    !gCurrentDetailData ||
    Number(gCurrentDetailData.ticket.ticket_id) !== Number(id)
  )
    return;
  renderTicketOperations(gCurrentDetailData);
};
function renderTicketOperations(d) {
  const id = d.ticket.ticket_id,
    pane = document.getElementById("pane-dtl-info");
  let box = document.getElementById("dtl-operations");
  if (!box) {
    box = document.createElement("section");
    box.id = "dtl-operations";
    box.className = "card";
    pane.prepend(box);
  }
  const active = (d.executions || []).find((e) => !e.ended_at),
    state = active?.route_state || "Chưa gắn phiên";
  box.innerHTML = `<div class="actions"><button class="btn sm" id="dtl-edit">Sửa phiếu</button><span class="tag">Tuyến: ${v2esc(state)}</span><span class="muted">${active ? "MD5 kế hoạch: " + v2esc(active.route_md5) : "Chưa xác minh tuyến thực thi"}</span></div><div class="ui-filterbar"><label>UAV<input class="input" id="dtl-exec-uav" value="${v2esc(d.ticket.assigned_device_sn || "")}"></label><label>Tuyến đã chọn trên Pilot<select class="input" id="dtl-exec-route">${d.routes.map((r) => `<option value="${r.route_id}">${v2esc(r.route_name)}</option>`).join("")}</select></label><button class="btn sm" id="dtl-exec-start">Xác nhận tuyến / gắn phiên</button><button class="btn sm" id="dtl-exec-stop">Kết thúc phân công</button><button class="btn sm danger" id="dtl-exec-block">Sai tuyến: khóa gán ảnh</button></div><p class="muted">Xác nhận thủ công sau khi phi công chọn tuyến trên Pilot. Không gửi lệnh cất cánh và không coi đây là xác minh tự động từ UAV.</p><div class="actions"><label>Vết bay GPS<select class="input" id="dtl-flight-track"><option value="">Chọn chuyến</option>${(d.progress?.flights || []).map((f) => `<option value="${f.flight_session_id}">Chuyến #${f.flight_session_id} · ${v2esc(f.device_sn)}</option>`).join("")}</select></label><span class="muted">Tuyến kế hoạch: vàng · GPS thực tế: xanh · vị trí ảnh: chấm</span></div><form id="dtl-reconcile" class="ui-filterbar"><label>Ảnh gốc dự kiến<input class="input" name="expected" type="number" min="0" required value="${d.progress?.expected_media_count ?? d.photos.length}"></label><label>Nguồn đối chiếu<input class="input" name="note" required placeholder="Thẻ nhớ / danh sách file"></label><label><input type="checkbox" name="checked" required> Đã đối chiếu ảnh gốc</label><button class="btn sm">Đối soát đủ ảnh</button></form><div class="actions"><button class="btn sm" data-ticket-status="ASSIGNED">Đã giao</button><button class="btn sm" data-ticket-status="COMPLETED">Hoàn tất phiếu</button><button class="btn sm" data-ticket-status="CANCELLED">Hủy phiếu</button><button class="btn sm" onclick="exportTicketReport('DOCX')">Tải Word</button><button class="btn sm" onclick="exportTicketReport('PDF')">Tải PDF</button></div><p role="status" id="dtl-operation-status"></p>`;
  const run = async (fn) => {
    try {
      await fn();
      await openTicketDetailModal(id);
      await loadTicketsFromDatabase();
    } catch (e) {
      document.getElementById("dtl-operation-status").textContent = e.message;
    }
  };
  box.querySelector("#dtl-edit").onclick = () => {
    closeTicketDetailModal();
    openCreateTicketModal(null, d.ticket);
  };
  box.querySelector("#dtl-exec-start").onclick = () =>
    run(async () => {
      if (
        !confirm(
          "Phi công đã chọn đúng tuyến trên Pilot và UAV đang ở mặt đất?",
        )
      )
        return;
      await v2api("POST", `/api/tickets/${id}/execution`, {
        route_id: Number(box.querySelector("#dtl-exec-route").value),
        device_sn: box.querySelector("#dtl-exec-uav").value.trim(),
        confirmed: true,
      });
    });
  for (const [button, suffix] of [
    ["stop", "stop"],
    ["block", "mismatch"],
  ])
    box.querySelector("#dtl-exec-" + button).onclick = () =>
      run(async () => {
        if (
          button === "block" &&
          !confirm("Khóa tự gán ảnh khi sai tuyến? Ảnh gốc vẫn được lưu.")
        )
          return;
        await v2api("POST", `/api/tickets/${id}/execution/${suffix}`, {});
      });
  box.querySelector("#dtl-reconcile").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    run(() =>
      v2api("POST", `/api/tickets/${id}/reconcile`, {
        expected_count: Number(f.elements.expected.value),
        note: f.elements.note.value,
        originals_checked: f.elements.checked.checked,
      }),
    );
  };
  box
    .querySelectorAll("[data-ticket-status]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          run(() =>
            v2api("PATCH", `/api/tickets/${id}/status`, {
              status: b.dataset.ticketStatus,
            }),
          )),
    );
  box.querySelector("#dtl-flight-track").onchange = (e) => {
    if (e.target.value)
      GIS.run(async () => {
        const f = await v2api("GET", "/api/flights/" + e.target.value);
        drawTicketMap(d, f.track);
      });
  };
}
window.initDetailRouteMap = (d) => drawTicketMap(d, []);
function drawTicketMap(d, track) {
  const el = document.getElementById("dtl-route-map");
  if (!el) return;
  if (!gDetailMiniMap) {
    gDetailMiniMap = L.map(el, { center: [16, 108], zoom: 6 });
    const cfg = BASEMAPS.satellite;
    L.tileLayer(cfg.url, { maxZoom: 22, attribution: cfg.attr }).addTo(
      gDetailMiniMap,
    );
    gDetailRouteLayer = L.featureGroup().addTo(gDetailMiniMap);
  }
  gDetailRouteLayer.clearLayers();
  const e = (d.executions || [])[0];
  let snapshot;
  try {
    snapshot =
      typeof e?.plan_snapshot === "string"
        ? JSON.parse(e.plan_snapshot)
        : e?.plan_snapshot;
  } catch {}
  const planned = snapshot?.geojson?.path?.coordinates;
  if (planned?.length)
    L.polyline(
      planned.map((p) => [p[1], p[0]]),
      { color: "#f59e0b", weight: 3 },
    ).addTo(gDetailRouteLayer);
  if (track.length > 1)
    L.polyline(
      track
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => [p.lat, p.lng]),
      { color: "#06b6d4", weight: 3 },
    ).addTo(gDetailRouteLayer);
  for (const p of d.photos || [])
    if (p.latitude != null && p.longitude != null)
      L.circleMarker([p.latitude, p.longitude], { radius: 4, color: "#38bdf8" })
        .bindTooltip(p.file_name)
        .addTo(gDetailRouteLayer);
  if (gDetailRouteLayer.getBounds().isValid())
    gDetailMiniMap.fitBounds(gDetailRouteLayer.getBounds(), {
      padding: [20, 20],
      maxZoom: 20,
    });
  gDetailMiniMap.invalidateSize();
}
window.renderDetailPhotosGrid = function (mode = "all") {
  if (!gCurrentDetailData) return;
  const d = gCurrentDetailData,
    defects = new Set(d.defects.map((x) => Number(x.media_id))),
    lens = (p) => p.lens || "UNKNOWN";
  const photos = d.photos.filter((p) =>
    mode === "rgb"
      ? ["WIDE", "ZOOM"].includes(lens(p))
      : mode === "ir"
        ? lens(p) === "IR"
        : mode === "defect"
          ? defects.has(Number(p.media_id))
          : true,
  );
  document.getElementById("dtl-photos-showing-text").textContent =
    `Hiển thị ${photos.length}/${d.photos.length} ảnh`;
  document.getElementById("dtl-photos-grid").innerHTML =
    photos
      .map(
        (p) =>
          `<figure class="card photo-result"><a href="${v2esc(p.file_url)}" target="_blank" rel="noopener"><img src="${v2esc(p.file_url)}" alt="${v2esc(p.file_name)}" loading="lazy"></a><figcaption>${v2esc(p.file_name)}<br>${v2esc(lens(p))} · ${defects.has(Number(p.media_id)) ? "Có phát hiện lỗi" : p.vision_status === "SUCCEEDED" ? "AI chưa phát hiện lỗi" : "Chưa có kết quả AI"}<br>${p.waypoint_error_m != null ? v2esc(Number(p.waypoint_error_m).toFixed(2)) + " m · " + v2esc(p.waypoint_check) : "Vị trí chụp: chưa đối soát"}</figcaption></figure>`,
      )
      .join("") || "<p>Không có ảnh trong bộ lọc.</p>";
};
window.triggerAnalyzeTicketAI = async function () {
  if (!gCurrentDetailData) return;
  const id = gCurrentDetailData.ticket.ticket_id;
  try {
    await queueTicketVision(id);
    await openTicketDetailModal(id);
  } catch (e) {
    v2message(e.message);
  }
};
async function queueVisionBatches(url) {
  let after = 0,
    count = 0,
    invalid = 0,
    more = true;
  while (more) {
    const r = await v2api("POST", url, { after_media_id: after });
    count += r.items.length;
    invalid += r.items.filter((x) =>
      ["INVALID", "FAILED"].includes(x.status),
    ).length;
    more = r.has_more;
    if (more && r.next_id <= after)
      throw Error("Mốc phân trang job không hợp lệ");
    after = r.next_id;
  }
  v2message(
    `Đã ghi nhận ${count} job (${invalid} lỗi/không hợp lệ). Xem tiến độ; chưa đồng nghĩa đã phân tích xong.`,
  );
}
window.queueTicketVision = (id) =>
  queueVisionBatches(`/api/tickets/${id}/vision`);
window.queueFlightVision = (id) =>
  queueVisionBatches(`/api/flights/${id}/vision`);
window.exportTicketReport = function (fmt) {
  if (!gCurrentDetailData) return;
  const kind = String(fmt).toUpperCase();
  if (!["PDF", "DOCX"].includes(kind)) return;
  const a = document.createElement("a");
  a.href = `/api/tickets/${gCurrentDetailData.ticket.ticket_id}/report.${kind}`;
  a.download = `inspection-${gCurrentDetailData.ticket.ticket_id}.${kind.toLowerCase()}`;
  a.click();
};

window.closeTicketModal = () => {
  document.getElementById("ticket-modal").classList.remove("active");
  switchView("tickets-solar");
};

window.openMapRegistration = async (prefix, id) => {
  await loadMapPackages();
  V2.mapEditId = id || null;
  const m = V2.maps.find((m) => m.map_id === id);
  document.getElementById(prefix + "-name").value = m?.map_name || "";
  const input = document.getElementById(prefix + "-file");
  input.value = "";
  input.closest(".field").hidden = !!id;
  switchView((prefix === "ortho-map" ? "maps-2d" : "offline-maps") + "-edit");
};
window.deleteMapPackage = async (id) => {
  if (!confirm("Xóa bản đồ và toàn bộ ô ảnh của gói này khỏi máy chủ?")) return;
  try {
    await v2api("DELETE", "/api/basemaps/" + id);
    await loadMapPackages();
    await fetchActivePlantBasemap();
    v2message("Đã xóa gói bản đồ");
  } catch (e) {
    v2message(e.message);
  }
};
