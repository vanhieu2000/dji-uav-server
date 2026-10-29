# BẢN ĐỒ KIẾN TRÚC DỰ ÁN (PROJECT MAP)
Cập nhật lần cuối: 2026-10-29 12:00 (Mã dự án: TDTM.26.001 - UAV ĐMT Thác Mơ)

---

## 1. Yêu Cầu Nghiệp Vụ Triển Khai (Business & System Requirements)
*Tổng hợp từ Hồ sơ kỹ thuật Nhà máy ĐMT Thác Mơ (PDF), Kế hoạch tiến độ TDTM.26.001 (Excel) và các yêu cầu người dùng thống nhất qua chat:*

### 1.1. Nghiệp Vụ Kết Nối & Nhận Diện Thiết Bị (Device Connectivity)
- **Luồng kết nối:** Mở Webview trên tay cầm DJI RC Pro Enterprise $\rightarrow$ Đăng nhập hệ thống $\rightarrow$ Tự động gọi Native Bridge `window.djiBridge.platformLoadComponent('thing', ...)` kết nối ngầm vào MQTT Broker Server (TCP 1883).
- **Nhận diện thiết bị:** Tự động bắt cặp Serial Number tay cầm (`rc_sn`) và Serial máy bay (`aircraft_sn`), cập nhật trạng thái Online/Offline, pin, vệ tinh, độ cao, vận tốc OSD.
- **Truyền hình ảnh (Live Stream):** Phát luồng video từ Mavic 3T về máy chủ MediaMTX (RTMP/WHEP). Cố định mã đuôi `normal-0` trong `live_start_push`. Chuyển đổi ống kính (Wide, Zoom, IR) bằng lệnh `live_lens_change`.
- **Điều khiển thủ công (Manual Control):** Chuyển toàn bộ chức năng "Debug Live / Buồng lái" thành giao diện "Điều khiển thủ công", hỗ trợ xoay Gimbal, chụp ảnh đơn lẻ (tự chiếm quyền `payload_authority_grab`), gọi RTH, trả quyền `drc_mode_exit`.

### 1.2. Nghiệp Vụ Lập Đường Bay Tùy Biến & Geofence An Toàn (Wayline Planner)
- **Tạo đường bay không giới hạn:** Người dùng có thể thiết kế bao nhiêu đường bay tùy ý trên Web bằng cách click chọn các điểm (Waypoints) trên bản đồ số hóa Leaflet.
- **Hành lang an toàn (Safety Geofence):** Hiển thị vùng bao giới hạn 51.27 ha của Nhà máy Thác Mơ và các phân khu (Khu 1.1, 1.2, 2, 3, 6, TBA 110kV, Xuất tuyến 22kV). Cảnh báo đỏ hoặc ngăn chặn nếu kỹ sư chấm điểm bay văng ra ngoài ranh giới nhà máy hoặc chạm vùng nguy hiểm.
- **Tùy biến chi tiết từng Waypoint:**
  + Tọa độ (`lat, lng`), độ cao bay (`height` mét, bám địa hình/so với mặt cất cánh).
  + Tốc độ bay tới điểm (`speed` m/s).
  + Góc xoay/nghiêng Gimbal (`gimbalPitch`: -90° soi pin vuông góc, -30°/-45° soi dao cách ly trên cột điện).
  + Chế độ dừng chống rung: `toPointAndStopWithDiscontinuityCurvature` kết hợp hành động `hover` 1 giây.
  + Chế độ chụp ảnh: Chụp ống kính Góc rộng (`wide`), Hồng ngoại nhiệt (`ir`), Zoom, hoặc chụp đồng thời cả hai (`wide,ir`).
- **Đóng gói KMZ chuẩn WPML:** Tự động nén thư mục `wpmz/template.kml` và `wpmz/waylines.wpml` theo mã chuẩn Mavic 3T (Drone 77/1, Payload 67/0/0) và tính mã băm MD5 fingerprint (chữ thường) để sẵn sàng nạp xuống máy bay.

### 1.3. Nghiệp Vụ Quản Lý Phiếu Kiểm Tra Linh Hoạt (Core Work Order)
- **Phiếu là Trung tâm Quản lý:** Thay thế việc fix cứng 2 loại phiếu bằng cơ chế tạo phiếu linh hoạt theo nhu cầu thực tế:
  + Chu kỳ: Theo ngày / Theo tuần / Theo tháng / Đột xuất.
  + Khu vực/Đối tượng kiểm tra: Khu vực pin cụ thể (Khu 1.1, Khu 2,...), Trạm biến áp 110kV, hoặc tuyến đường dây 10 cột chứa 48 dao cách ly 22kV.
  + Phân công: Chọn tổ công tác, kỹ sư phụ trách, thiết bị UAV/RC.
  + Gán đường bay: Chọn đường bay tương ứng trong thư viện gắn vào Phiếu.
- **Nút "Xem Live" thông minh theo Phiếu:**
  + Trong danh sách hoặc chi tiết Phiếu kiểm tra: Nếu máy bay đang thực hiện nhiệm vụ của phiếu đó (`EXECUTING` / đang bay) $\rightarrow$ **hiển thị nút "Xem Live"** nổi bật để người dùng bấm 1 chạm chuyển thẳng vào luồng live stream của Drone đó.
  + Nếu phiếu chưa bay (`PENDING` / `ASSIGNED`) hoặc đã hoàn thành (`COMPLETED`) $\rightarrow$ **ẩn / không cho xem live**.
- **Gom nhóm dữ liệu theo Phiếu:** Toàn bộ ảnh chụp, telemetry OSD, luồng live, kết quả AI, cảnh báo và báo cáo kỹ thuật đều lưu và lọc theo `ticket_id`. Hỗ trợ 1 phiếu gồm nhiều lượt bay (`flight_sessions`) do thay pin.

### 1.4. Nghiệp Vụ Thực Thi Bay, Khóa Đường Bay Chống Bay Nhầm & Bóc Tách Ảnh RTK
- **Nạp bay tự động (Autonomous Mission Push):** Server gửi lệnh `flighttask_prepare` qua MQTT topic `thing/product/{rc_sn}/services` kèm link KMZ và mã `flight_id = Mã_Phiếu`. Tay cầm RC tự động nạp lộ trình, phi công không phải tìm kiếm thủ công.
- **Khóa đường bay chống bay sai (Flight-Task Binding):**
  + Khi máy bay bắt đầu bay, tay cầm phát sự kiện MQTT `flighttask_ready` / `flighttask_progress` chứa `flight_id` và mã băm `file.fingerprint`.
  + Server so khớp mã này với mã của Phiếu kiểm tra:
    * Nếu trùng khớp: Hiển thị trạng thái XANH *"Đang bay đúng lộ trình kế hoạch"*.
    * Nếu sai lệch (phi công tự ý chọn đường bay khác): Server lập tức phát **CẢNH BÁO ĐỎ TRÊN WEB**: *"UAV đang bay sai đường bay so với Phiếu kiểm tra!"* và tạm dừng gán dữ liệu vào phiếu.
  + Cảnh báo lệch hành lang nếu khoảng cách thực tế lệch > 15m so với đường bay.
- **Nhận biết Drone đến điểm & Chụp ảnh:**
  + Drone đến điểm và dừng: Nhận qua MQTT event `flighttask_progress` (`current_waypoint_index`, trạng thái `in_progress`). Điểm waypoint trên bản đồ sáng đèn đổi màu theo thời gian thực.
  + Drone chụp ảnh xong: Tay cầm tự đẩy ảnh lên Server/MinIO và phát MQTT event `file_upload_callback`.
- **Bóc tách Metadata RTK & Đối soát vị trí:**
  + Đọc header XMP `drone-dji`: `GpsLatitude`, `GpsLongitude`, `AbsoluteAltitude`, `GimbalPitchDegree`, `RtkFlag`.
  + Nếu `RtkFlag = 50` (RTK FIX): Độ chính xác đạt 1cm + 1ppm (đáp ứng đúng tiêu chuẩn HSDT trang 10).
  + Đối soát không gian (bán kính < 1 - 2m) để tự động khớp ảnh vào chính xác Tấm pin (Khu $\rightarrow$ Chuỗi $\rightarrow$ Số thứ tự tấm) hoặc Dao cách ly (Cột $\rightarrow$ Pha $\rightarrow$ Mối nối).

### 1.5. Nghiệp Vụ AI Phân Tích Lỗi & Dự Báo Xu Hướng Nhiệt (Predictive Maintenance)
- **Tấm pin mặt trời (124.992 tấm):** AI phân tích phát hiện 4 nhóm lỗi chính: Hotspot (điểm nóng), Bụi bẩn/lá cây, Vi nứt (micro crack), Hỏng diode bypass.
- **Dao cách ly 22kV (10 cột / 48 mối nối):** Tự động nhận diện dao cách ly, đo nhiệt độ mối nối tiếp xúc từ ảnh nhiệt R-JPEG, cảnh báo khi $T > 75^\circ\text{C}$ hoặc $\Delta T > 5^\circ\text{C}$.
- **Dự báo xu hướng nhiệt:** Lưu trữ chu kỳ biến thiên nhiệt độ qua từng lần bay để tính tốc độ tăng nhiệt và dự báo rủi ro phóng điện/cháy nổ trước khi sự cố xảy ra.

### 1.6. Nghiệp Vụ Báo Cáo Kỹ Thuật & Mobile Web Hiện Trường
- **Báo cáo định kỳ:** Tự động kết xuất báo cáo kiểm tra dạng Word (.docx) và PDF phục vụ nghiệm thu quản lý vận hành theo mẫu Nhà máy Thác Mơ.
- **Mobile Web:** Hỗ trợ kỹ sư hiện trường đăng nhập trên điện thoại, xem bản đồ số hóa, tra cứu vị trí tấm pin hỏng và chỉ đường GPS đến đúng vị trí để khắc phục.

### 1.7. Chuẩn Hóa Giao Diện Tổng Quan (Dashboard UI Cleanup)
- **Nguyên tắc:** Giao diện tinh gọn, tập trung hiển thị các thông tin hữu ích (KPIs, trạng thái UAV, tiến độ phiếu trong ngày, cảnh báo nóng).
- **Loại bỏ triệt để:** Các đoạn văn bản giải thích dài dòng, rườm rà, các khối text trùng lặp hoặc chú thích thừa trên các form và card hiển thị.

---

## 2. Tổng Quan Kiến Trúc & Công Nghệ
- **Loại ứng dụng:** Hệ sinh thái Giám sát UAV & IoT Cận biên.
- **Framework & Ngôn ngữ:** Node.js (Express), Vanilla JS Hiện đại, Leaflet GIS, Aedes MQTT Broker, WebSocket ws.
- **Media Streaming:** MediaMTX (RTMP push từ RC, WHEP WebRTC / FLV view trên trình duyệt).
- **Cơ sở dữ liệu:** MySQL 8.0 (16 migrations quản lý toàn diện).
- **Giao thức phần cứng:** DJI Cloud API V2/V3 (MQTT over TCP 1883).

---

## 3. Phân Tầng Ứng Dụng (Layer Architecture)
- **UI / Presentation Layer:**
  + `backend/public/dashboard/`: Trung tâm điều hành trên Desktop (Bản đồ số hóa, lập đường bay, quản lý phiếu, xem live, điều khiển thủ công, báo cáo).
  + `backend/public/mobile/`: Web responsive trên điện thoại cho kỹ sư hiện trường.
  + `backend/public/pilot-login/`: Webview chạy bên trong ứng dụng DJI Pilot 2 trên tay cầm RC.
- **Hardware Integration Layer:**
  + `backend/src/services/deviceCommands.js`: Phát lệnh MQTT xuống UAV/RC.
  + `backend/src/services/telemetryIdentity.js`, `liveMonitoring.js`: Tiếp nhận và xử lý OSD, lọc tọa độ rác.
- **Mission & Wayline Layer:**
  + `backend/src/services/wpmlBuilder.js`: Đóng gói WPML/KMZ chuẩn Mavic 3T.
  + `backend/src/services/routeLibrary.js`, `ticketRoutes.js`: Thư viện tuyến bay và nạp bay.
- **Business Logic & Work Order Layer:**
  + `backend/src/services/ticketService.js`, `inspectionTasks.js`: Quản lý phiếu và đối soát dữ liệu.
  + `backend/src/services/mediaIngest.js`, `djiImageMeta.js`, `mediaAssignment.js`: Thu thập, bóc tách XMP RTK và gán mã tài sản.
- **AI & Analytics Layer:**
  + `backend/src/services/visionJobs.js`, `temperatureHistory.js`, `taskReport.js`.

---

## 4. Bảng Tra Cứu File & Quan Hệ Chéo (Dependency Ledger)
| Tên Class / File | Đường dẫn | Trách nhiệm chính | Phụ thuộc vào (Calls) | Được gọi bởi (Used by) |
|---|---|---|---|---|
| `server.js` | `backend/server.js` | Khởi động HTTP, WebSocket, Aedes MQTT Broker | `db.js`, `deviceCommands.js`, `mediaIngest.js` | Entry point |
| `deviceCommands.js` | `backend/src/services/deviceCommands.js` | Lệnh Live (`normal-0`), đổi lens, chiếm quyền payload, chụp ảnh, trả quyền (`drc_mode_exit`) | MQTT Broker, DB | `routes/deviceControl.js`, `server.js` |
| `wpmlBuilder.js` | `backend/src/services/wpmlBuilder.js` | Sinh file `.kmz` chuẩn WPML cho Mavic 3T (77/1 & 67/0/0) | `adm-zip`, `crypto` | `ticketRoutes.js`, `routeLibrary.js` |
| `routeLibrary.js` | `backend/src/services/routeLibrary.js` | Quản lý thư viện đường bay KMZ, tính fingerprint MD5 | `wpmlBuilder.js`, DB | `routes/pilotWaylines.js`, `ticketRoutes.js` |
| `ticketService.js` | `backend/src/services/ticketService.js` | Truy vấn và chuẩn hóa dữ liệu Phiếu kiểm tra | `config/db.js` | `routes/tickets.js`, `pilot-login` |
| `inspectionTasks.js`| `backend/src/services/inspectionTasks.js` | Nghiệp vụ tạo/sửa phiếu, gom nhóm media và đối soát | DB, `mediaAssignment.js` | `routes/tickets.js` |
| `mediaIngest.js` | `backend/src/services/mediaIngest.js` | Nhận ảnh từ UAV (`file_upload_callback`), bóc EXIF/XMP | `djiImageMeta.js`, `mediaAssignment.js`, DB | `server.js`, `routes/mediaUpload.js` |
| `djiImageMeta.js` | `backend/src/services/djiImageMeta.js` | Đọc nhanh XMP `drone-dji` (GPS, RTK 50, Gimbal, Altitude) | Native Buffer, Regex | `mediaIngest.js`, `taskReport.js` |
| `mediaAssignment.js`| `backend/src/services/mediaAssignment.js` | Khớp tọa độ ảnh chụp với tấm pin/dao cách ly GIS | DB, `captureMath.js` | `mediaIngest.js`, `inspectionTasks.js` |
| `flightTracker.js` | `backend/src/services/flightTracker.js` | Quản lý các lượt bay (`flight_sessions`), gắn ảnh vào lượt bay | DB | `server.js`, `mediaIngest.js` |
| `taskReport.js` | `backend/src/services/taskReport.js` | Xuất báo cáo kiểm tra Word (.docx) và PDF | `docx`, `pdfkit`, DB | `routes/reports.js` |

---

## 5. Vùng Logic Nhạy Cảm & Ràng Buộc Bất Biến (Fragile Zones & Invariants)

1. **[CẤM SỬA] PHẦN ĐIỀU KHIỂN DRONE ĐÃ HOẠT ĐỘNG ỔN ĐỊNH:**
   - Tuyệt đối không thay đổi logic điều khiển lõi trong `deviceCommands.js` và các hàm live/chụp ảnh đã test thành công trên Mavic 3T:
     + Mã đuôi `video_id` trong lệnh `live_start_push` **cố định `normal-0`** (ví dụ: `{drone_sn}/67-0-0/normal-0`).
     + Chuyển đổi ống kính camera dùng riêng lệnh `live_lens_change` (`wide`, `zoom`, `ir`).
     + Chấp nhận mã phản hồi DJI `513003` là thành công.
     + Chụp ảnh tự động chiếm quyền cụm camera `payload_authority_grab` (`67-0-0`) 300ms trước khi `camera_photo_take`.
     + Trả quyền điều khiển về tay cầm RC bắt buộc dùng `drc_mode_exit`.
     + Bộ lọc tọa độ `(0, 0)` và chống gửi trùng lặp telemetry OSD qua WebSocket.
2. **[GIAO DIỆN] ĐIỀU KHIỂN THỦ CÔNG (MANUAL CONTROL):**
   - Chức năng "Debug Live" / Buồng lái điều khiển được định danh chuẩn hóa thành **"Điều khiển thủ công (Manual Control)"**.
3. **[AN TOÀN BAY] KHÓA ĐƯỜNG BAY THEO PHIẾU (FLIGHT-TASK BINDING):**
   - Mỗi Phiếu kiểm tra gắn cứng với đường bay tương ứng.
   - Bắt buộc đối soát mã băm MD5 `fingerprint` và `flight_id` trong sự kiện MQTT `flighttask_ready` / `flighttask_progress` từ tay cầm RC. Nếu phi công chọn sai đường bay ngoài kế hoạch của Phiếu, hệ thống lập tức phát cảnh báo đỏ và chặn tự động gán dữ liệu vào Phiếu.
   - Thiết lập hành lang bay an toàn (Corridor / Geofence 51.27 ha). Cảnh báo nếu drone bay lệch quỹ đạo quá 15m.
4. **[TỐI ƯU GIAO DIỆN & TRẢI NGHIỆM]:**
   - Trang Tổng quan (Dashboard) chỉ hiển thị thông tin hữu ích (KPIs, Drone status, Phiếu trong ngày, Báo động). Loại bỏ toàn bộ text rườm rà dư thừa.
   - Phiếu đang thực hiện (`EXECUTING`) có nút "Xem Live" một chạm. Phiếu chưa bay thì ẩn nút này.
5. **[QUY TRÌNH PHÁT TRIỂN & TEST]:**
   - Luôn đọc `PROJECT_MAP.md` trước khi thao tác và cập nhật ngay khi hoàn thành task hoặc khi người dùng có yêu cầu mới trong chat.
   - Luôn kiểm thử giao diện thực tế (Browser test / Mobile test) trước khi bàn giao cho người dùng.
   - Chỉ can thiệp vào phần Cài đặt, Giao diện quản lý và Logic nghiệp vụ Phiếu/Đường bay, tuyệt đối không chạm vào phần điều khiển Drone đã ổn định.

---

## 6. Nhật Ký Thay Đổi Cốt Lõi (Architecture Change Log)
- **2026-10-29 09:30:** Khởi tạo kết nối DJI Cloud API Native Bridge trên tay cầm RC Pilot 2 (`platformLoadComponent('thing')`).
- **2026-10-29 10:45:** Sửa lỗi Live Stream (cố định `normal-0`, bổ sung `live_lens_change`, chấp nhận mã 513003 thành công). Khắc phục lỗi chiếm quyền chụp ảnh và lệnh trả quyền `drc_mode_exit`. Khử trùng lặp gói tin OSD WebSocket và lọc tọa độ (0,0).
- **2026-10-29 11:45:** Khởi tạo `PROJECT_MAP.md` lưu trữ bộ nhớ kiến trúc toàn dự án.
- **2026-10-29 12:00:** Bổ sung mục Yêu Cầu Nghiệp Vụ Triển Khai (Mục 1) phân rã 7 nghiệp vụ chi tiết của Nhà máy ĐMT Thác Mơ. Đồng bộ quy tắc cập nhật bộ nhớ vào `SKILL.md` của `project-memory` để áp dụng vĩnh viễn cho tất cả các dự án. Tiếp nhận yêu cầu tinh gọn UI Tổng quan và nút Xem Live thông minh theo Phiếu.
- **2026-10-29 12:25:** Hoàn thành Giai đoạn 1 & Giai đoạn 2:
  + Tinh gọn toàn bộ giao diện Tổng quan (Dashboard UI Cleanup): Xóa bỏ các đoạn văn bản mô tả thừa thãi, tối ưu thẻ KPI hiển thị số liệu sắc nét.
  + Thêm Bảng "Phiếu kiểm tra & Lịch bay" ngay trên trang Tổng quan: Tích hợp nút `🔴 Xem Live` thông minh (nổi bật, nhấp nháy pulse đỏ khi phiếu đang `EXECUTING`, ẩn khi chưa bay, 1 chạm chuyển sang buồng lái với đúng UAV và luồng live).
  + Chuẩn hóa đổi tên toàn bộ "Debug Live / Buồng lái" sang "Điều khiển thủ công (Manual Control)" và "Nhật ký điều khiển".
  + Nâng cấp Công cụ tạo đường bay (Wayline Planner): Kéo thả marker trực tiếp trên bản đồ, popup tinh chỉnh thông số từng Waypoint (độ cao, tốc độ, gimbalPitch, hoverTime 1s, chụp Wide+IR), khóa đường bay trực tiếp vào Phiếu kiểm tra.
  + Bổ sung module backend `routes/waylines.js` (`POST /api/routes/generate-kmz` và `POST /api/routes/push-to-drone`): Đóng gói KMZ chuẩn Mavic 3T (77/1 & 67/0/0), tính mã băm MD5 fingerprint và phát lệnh `flighttask_prepare` qua MQTT.
  + Thêm xử lý sự kiện realtime `flighttask_progress` và `file_upload_callback` cập nhật tiến độ bay và nhận ảnh trực tiếp trên Web qua WebSocket.
  + Bảo vệ nguyên vẹn 100% module điều khiển Drone đã hoạt động tốt.
