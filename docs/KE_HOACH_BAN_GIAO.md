# KẾ HOẠCH TRIỂN KHAI & BÀN GIAO – DJI UAV SERVER

> Tài liệu để **bất kỳ ai** cũng tiếp tục được công việc: đã làm gì, còn lại gì, làm thế nào, kiểm tra ra sao.
> Cập nhật: 26/10/2026. Repo: `vanhieu2000/dji-uav-server` (nhánh `main`).
> Yêu cầu gốc: file Excel `Ke_hoach_phan_mem_UAV.xlsx` (42 hạng mục, 7 nhóm I–VII).

---

## 0. Ưu tiên hiện tại (chủ dự án đã chốt)

1. **Nghiệp vụ chính với drone** là ưu tiên số 1, trong đó quan trọng nhất là **LẤY ẢNH ĐÚNG Ý MUỐN**
   (phần mềm điều khiển được việc chụp: chụp gì, ở đâu, khi nào, góc nào, camera nào) để gửi đội **AI Vision**
   huấn luyện và phát hiện lỗi (không chỉ lỗi nhiệt mà cả lỗi nhìn thấy được).
2. **Cài đặt bản đồ + quản lý đường bay.**
3. Phân quyền, báo cáo, web điện thoại, các nhóm khác: **để sau**.
4. Phần cứng dự kiến: **DJI Mavic 3T + module RTK chính hãng** (nguồn hiệu chỉnh: D-RTK 2 tại nhà máy hoặc NTRIP).
5. Quy tắc làm việc: **không dùng dữ liệu ảo**; mọi thay đổi code có kế hoạch được duyệt; giao tiếp tiếng Việt;
   xong mỗi bước nhỏ thì test → commit → push.

---

## 1. Cách chạy & kiểm thử

| Việc | Lệnh / cách làm |
|---|---|
| Cấu hình | Chép `.env.example` → `.env` (thư mục gốc). Điền `MYSQL_*`, `DJI_APP_ID/KEY/LICENSE`, `HOST_IP` (= IP máy chủ trong mạng Wi-Fi bay). **`.env` không bao giờ commit.** |
| Chạy local | `3_Chạy_Server_Local_Ngay.bat` hoặc `cd backend && node server.js` → http://localhost:8080/dashboard |
| Chạy Docker | `docker compose up -d --build` (đọc `.env`) |
| Nâng cấp CSDL | Tự chạy khi server kết nối MySQL. Chạy tay: `cd backend && npm run migrate`. File trong `backend/src/db/migrations/NNN_*.sql`, mỗi file chạy 1 lần, chạy lại an toàn. |
| Test | `cd backend && npm test` → tạo CSDL riêng `dji_uav_test` rồi xóa; **không đụng dữ liệu thật**. Hiện 23 test. |
| Giả lập drone (khi chưa có máy bay) | `YuYongJu/dji-cloud-simulator` (MQTT, cổng 1883) – chạy riêng. |

Các cổng: 8080 (web/API/WebSocket), 1883 (MQTT), 1935 (RTMP), 8000 (HTTP-FLV).

---

## 2. Bản đồ code (đọc trước khi sửa)

```
backend/
  server.js                 # ~2.300 dòng: MQTT (DJI Cloud API), RTMP, API điều khiển, nhận ảnh, API wayline cho Pilot 2
  src/config/db.js          # Pool MySQL, KHÔNG fallback dữ liệu mẫu, DbUnavailableError -> 503, tự kết nối lại
  src/db/migrate.js         # Bộ chạy migration (khóa GET_LOCK, chạy từng câu, bỏ qua câu đã áp dụng)
  src/db/migrations/        # 001_gis_assets.sql (bản đồ nền, mối nối DCL, điểm chụp ảnh, gắn AI với tài sản)
  src/routes/
    solar.js                # nhà máy / khu / chuỗi / tấm pin (+ sinh vị trí tấm pin)
    substation.js           # trạm / ngăn lộ / dao cách ly / mối nối
    assets.js               # tìm kiếm chung, cây tài sản, lớp bản đồ, điểm chụp ảnh, nhập Excel
    basemaps.js             # bản đồ nền (ZIP ô ảnh XYZ/TMS)
    tickets.js              # phiếu kiểm tra (MySQL)
    auth.js                 # đăng nhập (verifyLogin dùng chung Web + Pilot 2) – CÒN mật khẩu chung admin123 (chủ dự án yêu cầu giữ, xử lý sau)
    ai_bridge.js, reports.js
  src/services/             # assetImport, tileArchive (giải nén ZIP an toàn), photoPoints, ticketService
  src/utils/                # validate, geo (nội suy, ô ảnh), http (mã lỗi), sql (UPDATE động an toàn)
  public/dashboard/index.html     # ~4.600 dòng (cũ, viết inline) – sửa đến đâu tách module đến đó
  public/dashboard/js/gis/*.js    # module mới: bản đồ, lớp, cây tài sản, nhập Excel, bản đồ nền
  public/pilot-login/index.html   # trang mở trong DJI Pilot 2 (djiBridge: license, thing/MQTT, liveshare, media, mission)
  test/                     # unit.test.js, api.test.js, helpers.js
mysql_init/01_schema.sql    # schema gốc (đã khớp 100% DB thật ngày 26/10/2026)
docs/                       # tài liệu này
```

---

## 3. ĐÃ XONG

### Giai đoạn 0 – Nền tảng (commit `cad1cbc`)
- Bỏ dữ liệu mẫu khi mất MySQL → API 503, dashboard thanh đỏ, tự kết nối lại 10 s.
- Migration tự động, an toàn chạy lại.
- Pilot 2 đăng nhập kiểm tra tài khoản thật + chọn phiếu từ MySQL (`/api/pilot/tickets`, `/api/pilot/login`).
- Khóa DJI/mật khẩu chuyển ra `.env`; `workspace_id` lấy từ cấu hình.
- Sửa lỗi có sẵn: dấu `}` thừa làm **hỏng toàn bộ script dashboard**; sửa/xóa DCL sai cột (`dcl_id`→`disconnector_id`);
  `01_schema.sql` thiếu `media_files.file_path_local` và `ZOOM_PHOTO`.

### Giai đoạn 1 – Bản đồ & tài sản (hạng mục Excel #6–10, commit `cad1cbc`)
- Cài đặt tài sản: cây nhà máy → khu → chuỗi → tấm; trạm → ngăn lộ → DCL → mối nối; thêm/sửa/xóa đủ.
- Vẽ ranh giới khu / trạm trên bản đồ (Leaflet-Geoman); chọn vị trí điểm; sinh vị trí tấm pin (điểm đầu–cuối).
- **Điểm chụp ảnh** gắn với tài sản (độ cao, gimbal, camera, thời gian dừng) – nền cho tuyến bay DCL.
- Tìm kiếm chung trên bản đồ; ẩn/hiện lớp; tấm pin tải theo khung nhìn (zoom ≥ 18, tối đa 5.000).
- Nhập Excel 2 bước (kiểm tra → ghi), khớp mã không phân biệt dấu.
- Bản đồ nền nhà máy: tải ZIP ô ảnh, đăng ký thư mục có sẵn, đặt mặc định, độ mờ.
- 3 bản đồ (pin, trạm, điều khiển) dùng dữ liệu thật; lớp "Bất thường" lấy từ kết quả AI.

### Tài liệu cho đội Vision
- Đặc tả tích hợp AI Vision (Claude Docs, bản nháp): https://claude.ai/artifact/2CpURj31wWtzGyLBaA7ajk
  – mới viết phần "Luồng xử lý". **Còn thiếu:** đầu vào, danh mục lỗi, định dạng API, yêu cầu chất lượng,
  dữ liệu huấn luyện, câu hỏi cho Vision (nội dung đề xuất ở mục 6 dưới đây).

---

## 4. ĐÁNH GIÁ CHỨC NĂNG DRONE ĐANG CÓ (cần sửa / hoàn thiện)

| Chức năng hiện có | Vị trí | Hiện trạng | Việc cần làm |
|---|---|---|---|
| Đăng nhập Pilot 2, nạp license, MQTT (`thing`), liveshare, media | `public/pilot-login`, `server.js` | Chạy được (đã có người thử với máy thật) | Giữ. Thêm kiểm tra RTK, ghi phiên đăng nhập (máy bay ↔ phiếu) |
| Nhận OSD (vị trí, pin, nhiệt) | `server.js` `handleDjiMqttMessage` | Chạy; chỉ 1 điểm máy bay trên bản đồ; không OFFLINE khi mất tín hiệu; ghi telemetry mỗi gói | Đa máy bay, OFFLINE sau 30 s, ghi ≤1 lần/s, gắn chuyến bay/phiếu, đọc cờ RTK |
| Sinh KMZ (`/api/routes/generate-kmz`) | `server.js` | Chỉ tuyến điểm vẽ tay, mỗi điểm `gimbalRotate`+`takePhoto` (không chọn camera, không zoom/dừng, không chụp theo khoảng cách) | **Thay bằng bộ sinh tuyến theo Hồ sơ chụp (Giai đoạn A)** |
| Thư viện wayline cho Pilot 2 (`/wayline/api/v1/...`) | `server.js` | Đọc file KMZ trong thư mục `uploads/waylines`, chưa gắn phiếu/khu | Đọc từ bảng `flight_routes`, lọc theo phiếu đang chọn (Giai đoạn B). **Đây là cách đúng để đưa tuyến bay xuống Pilot 2** |
| Đẩy tuyến xuống máy bay (`/api/routes/push-to-drone`, `flighttask_prepare`) | `server.js` | `flighttask_*` là tính năng **DJI Dock**; với Pilot 2 + M3T nhiều khả năng **không chạy** | Kiểm chứng khi bay thử; nếu không chạy → bỏ nút, dùng thư viện wayline (phi công chọn tuyến trong Pilot 2) |
| Chụp / gimbal / RTH / bay tới điểm từ web (`/api/control/*`) | `server.js` | `camera_photo_take`, `gimbal_rotate`, `flight_return_home` thuộc nhóm điều khiển trực tiếp (DRC) – chủ yếu cho Dock; `/api/control/flyto` **không tồn tại** ở server | Kiểm chứng; không xây nghiệp vụ chụp dựa vào đây. Nghiệp vụ chụp = **cài sẵn trong KMZ** |
| Đồng bộ ảnh (`triggerMediaSync` mỗi 4 s, method `media_files_sync`) | `server.js` dòng ~898 | Method không có trong tài liệu DJI; gửi liên tục 4 s/lần | Bỏ vòng lặp 4 s; dùng tự tải ảnh của Pilot 2 (`mediaSetAutoUploadPhoto`) + nhập thẻ nhớ |
| Nhận ảnh (`/media/api/v1/.../files/upload`, S3 giả lập) | `server.js` ~2.240 | **Gán cứng** phiếu 1, SN máy bay, tọa độ Lộc Ninh, nhiệt 68.5 °C | **Giai đoạn A3**: đọc metadata thật (XMP DJI: RTK, gimbal, độ cao), gắn chuyến/phiếu/điểm chụp |
| Đọc nhiệt R-JPEG (`thermalParser.js`, DJI TSDK) | `src/services/thermalParser.js` | Chạy | Giữ, dùng cho Vision và ngưỡng nhiệt |
| Livestream RTMP + FLV | `server.js`, dashboard | Chạy; kênh cố định `m3t_live` | Kênh theo phiếu (Giai đoạn C) |
| Mission planner trên dashboard (chấm điểm tay) | `index.html` | Chạy (vẽ tay) | Giữ cho tuyến tùy biến; thêm chọn Hồ sơ chụp |

---

## 5. VIỆC CÒN LẠI – THEO THỨ TỰ ƯU TIÊN

> Mỗi mục: **làm gì → file → tiêu chí xong**. Đánh dấu `[x]` khi xong + ghi commit.

### Giai đoạn A – LẤY ẢNH THEO Ý MUỐN (ưu tiên 1, ~7–9 ngày)

**Nguyên tắc:** với Mavic 3T + Pilot 2, mọi lệnh chụp được **cài sẵn trong KMZ** (DJI WPML), không bấm chụp từ xa.
WPML hỗ trợ trigger `multipleDistance` (chụp mỗi N m), `multipleTiming` (mỗi N s), `reachPoint` (tại điểm) và các
action `takePhoto`, `gimbalRotate`, `zoom`, `hover`, `rotateYaw`.
Tài liệu: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/common-element.html
**Bắt buộc bay thử để chốt:** tham số chọn camera (ir/wide/zoom), đơn vị trigger (forum báo có bản bị đảo m/s).

- [x] **A1. Hồ sơ chụp (capture profile)** – XONG (migration 002, `routes/captureProfiles.js`, `services/captureMath.js`, tab "Hồ sơ chụp") – migration `002_capture.sql` bảng `capture_profiles`:
  mục đích (`MAP_2D`, `SOLAR_THERMAL`, `CLOSE_UP`, `DCL_POINT`, `TRAINING`, `CUSTOM`), kiểu tuyến (`GRID`/`POINTS`),
  camera (`ir,wide,zoom`), GSD mục tiêu (cm/px) + camera tính GSD, độ cao (ghi đè), chồng ảnh dọc/ngang %, tốc độ,
  gimbal, hướng bay (`ALONG_ROWS`/`FIXED`/`AUTO`), trigger (`DISTANCE`/`TIME`/`POINT`), zoom, thời gian dừng,
  số ảnh/điểm, bắt buộc RTK, khung giờ bay, bức xạ tối thiểu. API `routes/captureProfiles.js` + tab giao diện.
  5 mẫu mặc định:

  | Mẫu | Camera | Thông số khởi điểm (chốt khi bay thử) |
  |---|---|---|
  | Quét bản đồ 2D | wide | chồng 80/70 %, gimbal −90°, bay chậm |
  | Quét nhiệt pin định kỳ | ir + wide | GSD nhiệt ≤ 5 cm (~30–35 m), chồng 70 / 20–35 %, gimbal −90°, dọc dãy pin, ≥600 W/m², 10h–14h |
  | Chụp cận lỗi | wide + zoom | ~10–15 m, dừng tại điểm |
  | Dao cách ly điểm cố định | ir + zoom | theo điểm chụp ảnh đã khai báo |
  | Thu dữ liệu huấn luyện | wide | bay thấp, RGB toàn khu |

  Xong khi: CRUD + test; mẫu mặc định có sẵn sau migration.

- [x] **A2. Bộ sinh tuyến bay** – XONG (`services/flightPlanner.js`, `services/wpmlBuilder.js`, `routes/flightPlans.js`, migration 003, tab "Lập đường bay"). CÒN: bay thử xác nhận KMZ trong Pilot 2 (chọn camera, trigger m/s, zoom), tuyến cận lỗi tự sinh từ kết quả AI (làm ở D) – `src/services/flightPlanner.js` (toán), `src/services/wpmlBuilder.js` (KMZ):
  - Thông số camera M3T (`src/services/cameraModels.js`): nhiệt 640×512, DFOV 61°; rộng 8000×6000, DFOV 84°;
    zoom 4000×3000 (kiểm lại với tài liệu DJI). Tính HFOV từ DFOV + tỉ lệ ảnh.
  - Độ cao từ GSD: `h = GSD × số_px_ngang / (2·tan(HFOV/2))`; bề rộng vệt chụp = `2h·tan(HFOV/2)`.
  - Khoảng cách 2 đường bay = vệt ngang × (1 − chồng ngang); khoảng cách chụp = vệt dọc × (1 − chồng dọc);
    tốc độ ≤ khoảng cách chụp / chu kỳ chụp tối thiểu (~0,7 s M3T, lấy 1 s cho an toàn).
  - Tuyến lưới: quay đa giác theo hướng dãy pin (lấy từ `solar_strings.line_geojson`, không có thì cạnh dài nhất),
    quét các đường song song, cắt với đa giác, nối kiểu luống cày, nới biên `margin_m`.
  - Tuyến điểm: từ `photo_points` của tài sản đã chọn, sắp thứ tự gần nhất; mỗi điểm: `gimbalRotate`, `rotateYaw`,
    `zoom`, `hover`, `takePhoto` (camera theo hồ sơ).
  - Xem trước: số ảnh, quãng đường, thời gian, số pin (M3T ~30 phút dùng được/pin).
  - API `POST /api/flight-plans/preview`, `POST /api/flight-plans` (lưu `flight_routes` + file KMZ).
  - Xong khi: unit test toán (GSD, số đường, số ảnh) + KMZ mở được trong DJI Pilot 2 (bay thử).

- [x] **A3. Nhận ảnh đúng** – XONG (`services/djiImageMeta.js`, `services/mediaIngest.js`, `routes/mediaUpload.js`, migration 004, tab "Nhập ảnh thẻ nhớ"; sửa lỗi tải nhiều phần bị ghi đè). CÒN: kiểm chứng với ảnh M3T thật (tên trường XMP, vị trí hậu tố fileSuffix trong tên file, số serial qua djiBridge) – `src/services/mediaIngest.js`, `src/services/djiImageMeta.js`:
  - Đọc XMP của ảnh DJI: `GpsLatitude/Longitude`, `AbsoluteAltitude`, `RelativeAltitude`, `GimbalPitch/Yaw/RollDegree`,
    `FlightYawDegree`, `RtkFlag` (50 = FIX), `RtkStdLon/Lat/Hgt`, giờ chụp; loại ảnh (_T nhiệt, _W rộng, _Z zoom).
  - Gắn ảnh với chuyến bay (`flight_id` trong upload callback), phiếu (phiên đăng nhập Pilot), điểm chụp (gần nhất ≤ 2 m).
  - **Bỏ toàn bộ giá trị gán cứng** trong 2 handler nhận ảnh của `server.js` (phiếu 1, SN, tọa độ, 68.5 °C).
  - **Nhập thẻ nhớ**: trang web kéo thả thư mục ảnh → tải lên theo lô → ghép chuyến bay theo giờ + vị trí.
  - Ảnh RTK chưa FIX → cờ `position_quality = 'LOW'`, hiện cảnh báo.
  - Migration: thêm cột cho `media_files` (rtk_flag, rtk_std_m, relative_altitude, gimbal_roll, flight_yaw, lens,
    flight_session_id, photo_point_id, capture_profile_id, sha256 chống trùng).
  - Xong khi: test với ảnh mẫu M3T thật (cần chủ dự án cung cấp 5–10 ảnh R-JPEG + ảnh rộng có RTK).

- [x] **A4. Kiểm tra đủ ảnh** – XONG (`services/coverage.js`, `routes/coverage.js`, tab "Kiểm tra đủ ảnh", tuyến bay bù cho vùng thiếu) – vệt chụp của từng ảnh vẽ lên bản đồ; so số ảnh dự kiến/đã nhận; khu chưa phủ;
  sinh tuyến bay bù cho vùng thiếu. Xong khi: hiện % phủ theo khu và tạo được tuyến bù.

- [x] **A5. Xuất bộ ảnh cho Vision** – XONG (`routes/datasets.js`, tab "Xuất ảnh cho Vision"; ZIP theo luồng + manifest.json/.csv + README, pair_key ghép ảnh nhiệt ↔ thường) – theo phiếu / hồ sơ / khu / khoảng ngày: ZIP ảnh gốc + `manifest.json`
  (metadata chụp, tài sản liên quan). Xong khi: tải được và đội Vision đọc được.

**Kết quả Giai đoạn A (26/10/2026):** đủ 5 bước, 35 test. Các tab mới trong *Cài đặt tài sản*:
Hồ sơ chụp · Lập đường bay · Nhập ảnh thẻ nhớ · Kiểm tra đủ ảnh · Xuất ảnh cho Vision.
Đã làm sạch 24 ảnh cũ trong DB thật (giá trị gán cứng của code cũ được thay bằng giá trị đọc từ file;
phiếu gán cũ giữ nguyên vì không xác định được phiếu đúng).
**Việc bắt buộc khi bay thử lần đầu (checklist):**
1. Nạp 1 tuyến quét lưới nhỏ + 1 tuyến điểm vào Pilot 2 (thư viện đường bay hoặc chép KMZ) – Pilot 2 mở được, độ cao đúng so với điểm cất cánh.
2. Ảnh chụp đủ cả nhiệt + rộng (tham số `payloadLensIndex`), khoảng cách chụp đúng mét (không phải giây).
3. Tên file ảnh có hậu tố điểm chụp (`fileSuffix`) → ảnh tự gắn điểm chụp.
4. Ảnh tự tải về server trong lúc bay; tải ảnh rộng 48MP qua nhiều phần ghép đúng.
5. XMP có `RtkFlag=50` khi RTK FIX; số serial tay điều khiển / máy bay đọc được qua djiBridge.
Ghi kết quả vào mục 8 và sửa code nếu tên trường DJI khác.

### Giai đoạn B – Bản đồ & quản lý đường bay (~4–5 ngày)
- [x] Thư viện đường bay trong MySQL (`services/routeLibrary.js`): KMZ cũ trong thư mục tự vào DB, tìm theo `route_uuid`; tuyến có độ cao theo mực nước biển được gắn nhãn ⚠ (B1, B4).
- [x] Gán đường bay vào phiếu (bảng `ticket_routes`, nhiều tuyến / phiếu) và API thư viện cho Pilot 2 chỉ trả tuyến của phiếu đang bay (`routes/pilotWaylines.js`) (B2, B3).
- [x] Quy trình quét 2D: lập tuyến theo ranh giới nhà máy (`plant_id`), hướng dẫn 7 bước trong tab Bản đồ nền (B5).
  **DB thật:** 3 tuyến cũ (do code cũ sinh, EGM96) đã gắn nhãn ⚠ – xóa hoặc tạo lại trước khi bay.
  Ghi chú: module RTK cho M3T là "định vị RTK", M3T không phải dòng đo đạc như M3E → hỏi đại lý nếu cần bản đồ chuẩn đo đạc.
- [x] Bỏ `memoryStore.routes`; bộ vẽ tay dashboard sinh KMZ đúng chuẩn và lưu thư viện (B4).

### Giai đoạn C – Chuyến bay & giám sát (~4 ngày)
- [x] C1 – Bảng `flight_sessions` (migration 006) + `src/services/flightTracker.js`: tự nhận cất cánh (cao > 1,5 m hoặc tốc độ > 1 m/s)
  và hạ cánh (< 0,8 m, < 0,3 m/s liên tục 10 s), gắn phiếu theo phiên Pilot; telemetry ≤ 1 lần/giây có `flight_session_id`;
  OFFLINE sau 30 s không có OSD (đang bay → `LOST_LINK`); `uav_devices.rtk_state`, `gateway_sn` (từ gói topo);
  ảnh gắn vào chuyến theo giờ chụp ±30 s (chạy lại mỗi phút vì ảnh về sau khi hạ cánh); chuyến còn mở khi server tắt → `SERVER_RESTART`.
  Ngưỡng cất/hạ cánh cần thử với máy thật (độ cao `elevation` của Pilot 2 tính từ điểm cất cánh).
- [x] C2 – `GET /api/flights` (lọc máy bay / phiếu / ngày), `GET /api/flights/:id` (vết bay ≤ 5000 điểm + ảnh);
  tab **Lịch sử chuyến bay** (`gis-flight-history.js`): vết bay tô màu theo RTK, điểm ảnh theo camera, phát lại 1×/5×/20×, thông báo khi cất/hạ cánh.
- [ ] Đa máy bay trên bản đồ; cảnh báo HMS.
- [ ] Theo dõi tiến độ chụp realtime trên bản đồ (vị trí từng ảnh vừa về).
- [ ] Livestream kênh theo mã phiếu.
- [ ] Sửa số giả còn sót: KPI "DCL vượt ngưỡng 83.5 °C" ở Tổng quan, thanh OSD "Dãy 01 · 3.36 MWp".

### Giai đoạn D – Tích hợp AI Vision (~4 ngày, sau khi chốt đặc tả)
- [ ] Gửi job sang Vision, nhận webhook kết quả (khung pixel, loại lỗi, độ tin cậy, nhiệt độ).
- [ ] Đổi pixel → tọa độ mặt đất (dùng RTK + gimbal + FOV), gắn đúng tấm pin / mối nối, cập nhật trạng thái tấm.
- [ ] Ngưỡng cảnh báo lấy từ cấu hình (bỏ 65 °C cứng trong `ai_bridge.js`).

### Giai đoạn F – Phiếu kiểm tra & dữ liệu nhiệm vụ (~4 ngày) – hạng mục #20, #21, #24, #25
- [ ] Phiếu pin: chọn khu / chuỗi cụ thể (bảng `ticket_details`), tổ công tác (người), thời gian kế hoạch / thực tế, hồ sơ chụp, tuyến bay.
- [ ] Phiếu DCL: chọn ngăn lộ / DCL / mối nối, tổ công tác, phạm vi.
- [ ] Màn chi tiết phiếu: ảnh theo thời gian thực, trạng thái nhận ảnh, ảnh trùng (sha256) / lỗi / đến muộn (#24).
- [ ] Nhiều lượt bay cho 1 phiếu (#25): danh sách chuyến bay của phiếu, phạm vi đã phủ / bay bổ sung.
- Tiêu chí xong: tạo phiếu → bay 2 lượt → ảnh và lỗi của cả 2 lượt nằm đúng phiếu.

### Giai đoạn G – Cảnh báo, dashboard, xu hướng nhiệt (~6 ngày) – hạng mục #28–32, #5 (phần ngưỡng)
- [ ] Bảng cấu hình ngưỡng (theo loại tài sản, theo DCL/mối nối, ΔT pin) thay giá trị cứng 65 °C; nút "Lưu cấu hình" ghi thật.
- [ ] Cảnh báo: sinh từ kết quả AI + ngưỡng nhiệt; danh sách, đánh dấu đã xử lý, lịch sử (#29); thông báo realtime.
- [ ] Danh sách DCL đã kiểm tra + nhiệt độ cao nhất + vượt ngưỡng theo phiếu (#28).
- [ ] Dashboard Tổng quan & Báo cáo dùng số thật (bỏ biểu đồ và KPI viết tay) (#30).
- [ ] Lịch sử nhiệt theo từng mối nối / chu kỳ bay (bảng `temperature_history`) (#31).
- [ ] Xu hướng tăng nhiệt + cảnh báo sớm trước ngưỡng (tốc độ tăng °C/chu kỳ, dự báo chạm ngưỡng) (#32).
- Tiêu chí xong: 2 chu kỳ bay DCL → biểu đồ nhiệt theo mối nối, cảnh báo sớm khi tăng nhanh.

### Giai đoạn E – Tài khoản, phân quyền, cấu hình (~6 ngày) – hạng mục #1–5, #39 (phần quyền)
- [ ] Màn đăng nhập / đăng xuất / thông tin tài khoản trên dashboard (#1); bỏ mật khẩu chung `admin123`, sửa hash mẫu.
- [ ] Đổi mật khẩu, quên mật khẩu qua email (#2).
- [ ] Quản lý đơn vị (bảng `units`) và người dùng: thêm / sửa / khóa / khôi phục (#3).
- [ ] Vai trò + quyền chức năng + phạm vi dữ liệu theo nhà máy / đơn vị; middleware JWT cho mọi API (#4, #39).
- [ ] Danh mục chung (loại lỗi, tổ công tác...), cấu hình lưu ảnh (thời gian giữ, dung lượng) (#5).
- Tiêu chí xong: tài khoản vận hành không sửa được tài sản; API không token → 401.

### Giai đoạn H – Web điện thoại, báo cáo, API mở (~7 ngày) – hạng mục #11, #33–37
- [ ] Trang điện thoại `/m`: bản đồ, ẩn/hiện lớp, định vị người dùng, chỉ hướng + khoảng cách tới tấm pin / DCL (#11).
- [ ] Phiếu pin / DCL trên điện thoại: tạo phiếu, tải ảnh chụp tay, xem kết quả AI / nhiệt độ (#33, #34).
- [ ] Báo cáo từng phiếu ra Word và PDF (ảnh, vị trí, kết quả, chữ ký) (#35).
- [ ] Thống kê lỗi theo khu pin, DCL vượt ngưỡng, theo kỳ (#36).
- [ ] API mở có khóa truy cập + tài liệu OpenAPI, đồng bộ hai chiều với hệ thống bên thứ ba (PMIS...) (#37) – cần chốt bên thứ ba.

### Giai đoạn I – Triển khai, bảo mật, vận hành (~5 ngày + thời gian hiện trường) – hạng mục #38–42
- [ ] Gói triển khai tại nhà máy: Docker compose đủ dịch vụ + container AI Vision; sao lưu MySQL & ảnh (#38).
- [ ] HTTPS, mã hóa mật khẩu/bí mật, nhật ký truy cập, CORS giới hạn, giới hạn tần suất (#39).
- [ ] Chế độ offline: bản đồ nền offline (đã có), hàng đợi ảnh khi mất mạng, đồng bộ lại khi có kết nối (#40).
- [ ] Kiểm thử Chrome / Edge / Firefox / Safari + điện thoại Android / iOS (#41).
- [ ] Kiểm thử tải nhiều UAV bằng bộ giả lập MQTT (vd. 5–10 máy cùng lúc) (#42).

---

## 5b. BẢNG THEO DÕI 42 HẠNG MỤC (file Excel)

Trạng thái sau commit `cad1cbc`: ✅ xong · 🟡 một phần · ⬜ chưa.
Thứ tự làm: **A → B → C → D → F → G → E → H → I** (ưu tiên nghiệp vụ drone theo yêu cầu chủ dự án).

| # | Hạng mục | TT | Giai đoạn | Còn thiếu |
|---|---|---|---|---|
| 1 | Đăng nhập, đăng xuất, thông tin tài khoản | 🟡 | E | Màn đăng nhập dashboard, đăng xuất, bỏ mật khẩu chung |
| 2 | Đổi / khôi phục mật khẩu | 🟡 | E | Giao diện, quên mật khẩu qua email |
| 3 | Quản lý đơn vị và người dùng | ⬜ | E | Toàn bộ |
| 4 | Phân quyền chức năng & phạm vi dữ liệu | ⬜ | E | Toàn bộ |
| 5 | Danh mục chung & cấu hình hệ thống | 🟡 | E, G | Bản đồ nền ✅; ngưỡng cảnh báo, danh mục, cấu hình lưu ảnh |
| 6 | Nhập & hiển thị bản đồ phân giải cao | ✅ | B | Quy trình quét 2D → DJI Terra; MBTiles (tùy chọn) |
| 7 | Quản lý khu vực, chuỗi, tấm pin | ✅ | – | (Sau) tự nhận vị trí tấm từ bản đồ trực ảnh |
| 8 | Tìm kiếm khu, chuỗi, tấm pin | ✅ | – | – |
| 9 | Bản đồ trạm, ngăn lộ, DCL, mối nối | ✅ | – | – |
| 10 | Hiển thị & tra cứu bất thường trên bản đồ | 🟡 | D | Lớp đã có, chờ dữ liệu AI gắn tài sản |
| 11 | Bản đồ & chỉ đường trên điện thoại | ⬜ | H | Toàn bộ |
| 12 | Quản lý danh sách UAV | 🟡 | C | Đa máy bay, OFFLINE, bỏ SN gán cứng |
| 13 | Kết nối UAV / tay điều khiển | 🟡 | C | Bay thử với RTK, phiên đăng nhập máy bay ↔ phiếu |
| 14 | Thiết lập đường bay pin & DCL | 🟡 | A | Sinh tuyến theo hồ sơ chụp (lưới / điểm) |
| 15 | Quản lý đường bay & danh sách DCL trên tuyến | ⬜ | B | Thư viện tuyến trong MySQL, gắn tài sản |
| 16 | Đồng bộ đường bay UAV ↔ server | 🟡 | B | Pilot 2 chỉ thấy tuyến của phiếu |
| 17 | Giám sát trạng thái UAV & nhật ký bay | 🟡 | C | Chuyến bay, lịch sử, xem lại vết |
| 18 | Vị trí UAV trên bản đồ theo phiếu | 🟡 | C | Gắn vị trí với phiếu đang bay |
| 19 | Livestream trong phiếu | 🟡 | C | Kênh theo phiếu, xem trong màn phiếu |
| 20 | Phiếu kiểm tra pin | 🟡 | F | Chọn khu/chuỗi, tổ công tác, thời gian |
| 21 | Phiếu kiểm tra DCL | 🟡 | F | Chọn ngăn lộ/DCL, tổ công tác |
| 22 | Chọn phiếu nhận ảnh trên phần mềm điều khiển | 🟡 | A | Pilot chọn phiếu ✅; ảnh chưa gắn phiếu |
| 23 | Tự đồng bộ ảnh RGB & nhiệt về server | 🟡 | A | Đọc metadata thật, nhập thẻ nhớ |
| 24 | Hiển thị ảnh, trạng thái nhận, đối soát | 🟡 | A, F | Kiểm tra đủ ảnh, ảnh trùng / lỗi / muộn |
| 25 | Liên kết nhiều lượt bay với 1 nhiệm vụ | ⬜ | F | Toàn bộ |
| 26 | Tự chuyển ảnh sang AI & nhận kết quả | 🟡 | D | Gửi job tự động, webhook v2 |
| 27 | Phân loại lỗi pin & vị trí tài sản lỗi | 🟡 | D | Pixel → tọa độ → tấm pin |
| 28 | Thiết bị đã kiểm tra & nhiệt độ cao nhất | 🟡 | G | Danh sách DCL theo phiếu |
| 29 | Cấu hình, phát, lưu cảnh báo | 🟡 | G | Ngưỡng cấu hình được, xử lý cảnh báo |
| 30 | Dashboard giám sát & lịch sử bất thường | 🟡 | G | Thay số viết tay bằng số thật |
| 31 | Lịch sử nhiệt theo mối nối & chu kỳ | ⬜ | G | Toàn bộ |
| 32 | Xu hướng tăng nhiệt & cảnh báo sớm | ⬜ | G | Toàn bộ |
| 33 | Phiếu pin trên điện thoại | ⬜ | H | Toàn bộ |
| 34 | Phiếu DCL trên điện thoại | ⬜ | H | Toàn bộ |
| 35 | Báo cáo Word & PDF | 🟡 | H | Chỉ có in trình duyệt / CSV |
| 36 | Thống kê lỗi khu pin & DCL | 🟡 | H | API có, giao diện số thật |
| 37 | API mở & đồng bộ hai chiều | 🟡 | H | Khóa API, OpenAPI, chốt bên thứ ba |
| 38 | Triển khai phần mềm + AI tại nhà máy | 🟡 | I | Container AI, sao lưu |
| 39 | Mã hóa dữ liệu & kiểm soát truy cập | ⬜ | E, I | Quyền, HTTPS, nhật ký |
| 40 | Offline & đồng bộ khi có mạng | 🟡 | I | Hàng đợi ảnh, đồng bộ lại |
| 41 | Kiểm thử nhiều trình duyệt & thiết bị | ⬜ | I | Toàn bộ (đã có 23 test API) |
| 42 | Kiểm thử mở rộng số UAV | ⬜ | I | Toàn bộ |

Tổng ước lượng còn lại: ~45–55 ngày công lập trình (chưa tính bay thử hiện trường và chờ đội Vision).

---

## 6. Nội dung đề xuất cho đặc tả Vision (để hoàn thiện tài liệu Claude Docs)

- **Đầu vào mỗi job:** `job_id`, `media_id`, URL ảnh nhiệt R-JPEG gốc + ảnh rộng cùng lượt chụp, URL ma trận nhiệt
  (°C, 640×512, server đọc bằng DJI TSDK), loại kiểm tra (`SOLAR_PANEL`/`DISCONNECTOR`), thông tin chụp (độ cao so
  mặt đất, gimbal, hướng, cờ RTK), với DCL: mã DCL/pha dự kiến + vùng mối nối nếu đã khai báo.
- **Danh mục lỗi (mã chuẩn):**
  - Pin – nhiệt: `HOTSPOT_CELL`, `HOTSPOT_MULTI_CELL`, `BYPASS_DIODE`, `MODULE_HOT`, `STRING_OFFLINE`, `PID`, `JUNCTION_BOX_HOT`.
  - Pin – nhìn thấy: `CRACKED_GLASS`, `PHYSICAL_DAMAGE`, `SOILING`, `BIRD_DROPPING`, `SHADING`, `VEGETATION`, `DELAMINATION`, `MISSING_MODULE`.
  - DCL: `DCL_CONTACT_OVERHEAT`, `DCL_PHASE_IMBALANCE`, `DCL_NOT_FULLY_CLOSED`, `INSULATOR_DAMAGE`, `CORROSION`, `FOREIGN_OBJECT`.
  - `OTHER`. Mức độ do server tính theo ΔT cấu hình được (tham khảo: ΔT ≥ 20 °C cao, < 10 °C thấp – Raptor Maps).
- **Kết quả trả về (webhook `POST /api/ai/webhook/vision-result`, sẽ nâng cấp v2):**
  `{ job_id, media_id, model_version, status, detections: [ { defect_type, confidence, image: "thermal"|"rgb",
  bbox: [x, y, w, h] (pixel), max_temp_c, mean_temp_c, ref_temp_c, delta_t_c, phase? } ] }`.
  Vision **không cần** GPS/tài sản; server lo định vị. Gửi lại cùng `job_id` = ghi đè.
- **Chất lượng đề xuất (chốt với Vision):** recall lỗi nhiệt ≥ 90 %, precision ≥ 80 %, IoU khung ≥ 0,5;
  ~1.000 cặp ảnh/chuyến xử lý ≤ 30 phút; chạy tại server nhà máy (Docker, không cần Internet).
- **Dữ liệu huấn luyện:** xuất từ A5; kỹ sư xác nhận đúng/sai trên dashboard (`verified_by_human`) làm dữ liệu phản hồi; nhãn COCO.
- **Câu hỏi cho Vision:** tự đọc nhiệt bằng SDK hay dùng ma trận server cấp? Phát hiện trên từng ảnh hay ảnh ghép?
  Hạ tầng GPU? Cần ảnh zoom DCL không? Bổ sung lỗi nào? Đã có bao nhiêu dữ liệu?

---

## 7. Rủi ro & lưu ý quan trọng

- **Bảo mật:** commit đầu tiên trên GitHub (public) từng có mật khẩu MySQL root trong `db.js` (đã bỏ khỏi code,
  vẫn còn trong lịch sử git) → **đổi mật khẩu MySQL**. Khóa DJI chưa từng lên git.
- **IP máy chủ:** `.env`/`config.json` đang `10.20.28.50`, máy chủ thật là `10.20.28.101` → sửa trước khi bay.
- **DB thật** còn dữ liệu mẫu Lộc Ninh (nhà máy, khu, trạm, 6 DCL) → sửa/xóa trong Cài đặt tài sản, nhập dữ liệu Thác Mơ.
- Các tính năng DJI (chọn camera trong KMZ, chụp theo khoảng cách, Pilot 2 tự tải ảnh, lệnh điều khiển từ web)
  **phải bay thử thật** để chốt; luôn có đường dự phòng (chụp theo thời gian, nhập thẻ nhớ).
- `index.html` dài, viết inline: thêm chức năng mới bằng module trong `public/dashboard/js/`, không nhồi vào file cũ.

## 8. Nhật ký commit
| Commit | Nội dung |
|---|---|
| `a9d3c6a` | Đưa mã nguồn lên GitHub (đã tách khóa DJI, mật khẩu ra `.env`) |
| `cad1cbc` | Giai đoạn 0 + 1: dữ liệu thật, migration, bản đồ & tài sản, 23 test |
| `cc4bf73` | Tài liệu kế hoạch & bàn giao |
| `0c3155a` | Kế hoạch đủ 42 hạng mục |
| `8d63dd9` | A1 hồ sơ chụp |
| `dfb77f2`, `e488f2d` | A2 sinh đường bay KMZ + giao diện |
| `6513c8e`, `f625157` | A3 nhận ảnh đúng + nhập thẻ nhớ |
| `6d509af`, `64155db` | A4 kiểm tra đủ ảnh + bay bù |
| `02c35ae`, `6ea9550` | A5 xuất bộ ảnh Vision + làm sạch ảnh cũ |
| `016972c`, `ab2f92a`, `589fc03`, `b4aaec1` + commit B5 | Giai đoạn B: thư viện đường bay, gán phiếu, API Pilot 2, vẽ tay, quét 2D |
