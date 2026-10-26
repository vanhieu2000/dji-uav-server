# DJI UAV Server — Mavic 3T

Node.js 24 / MySQL 8, dashboard `/dashboard/`, hiện trường `/m/`, cổng Pilot 2 `/pilot-login/`. Theo dõi phiếu, nhiều lượt/UAV, ảnh gốc RGB/R-JPEG, Vision contract, cảnh báo/nhiệt, báo cáo DOCX/PDF và API tích hợp có phạm vi.

Đọc [kế hoạch và trạng thái 42 hạng mục](docs/KE_HOACH_BAN_GIAO.md), [vận hành/triển khai](docs/OPERATIONS.md), [tài khoản/phân quyền](docs/ACCOUNTS_AND_SCOPES.md), [điện thoại/báo cáo/API](docs/MOBILE_REPORTS_API.md) và [Vision contract](docs/VISION_CONTRACT.md).

## Chạy local

Dùng MySQL đã cấu hình; `.env.example` → `.env` và điền tài khoản DB riêng. Với DB mới, khởi tạo schema một lần; `mysql_init/01_schema.sql` có DROP TABLE, **không chạy lại trên DB đang dùng**. Các lần nâng cấp chỉ chạy migration additive. Không dùng seed dữ liệu nhà máy mẫu trong production.

```sh
cd backend
npm ci
npm run migrate
npm run admin:create
npm start
```

Lệnh tạo quản trị viên từ chối ghi đè tài khoản đã tồn tại; có thể đặt `BOOTSTRAP_ADMIN_USER`. Mật khẩu ngẫu nhiên ở `backend/data/bootstrap-password` (0600, ngoài git), bắt đổi sau đăng nhập và xóa file sau đó. Không có mật khẩu chung. PDF cần font DejaVu Sans; Windows đặt `REPORT_FONT_PATH` tới font Unicode đã cài. SDK nhiệt DJI cần tải hợp lệ riêng; thiếu SDK thì nhiệt độ để trống.

## Kiểm chứng

```sh
cd backend
npm test                  # DB dji_uav_test riêng; không chạy trên DB nhà máy
npm run test:browser      # Chromium; CHROMIUM_PATH nếu khác /usr/bin/chromium
npm run test:mobile       # viewport 390px + GPS fixture + queue retry/reload
npm audit --omit=dev
node scripts/verify-live.cjs # ffmpeg + NMS trên cổng loopback ngẫu nhiên, không UAV thật
```

Đặt `MYSQL_*` để test kết nối DB test; test báo skip nếu MySQL chưa có, vì vậy kiểm tra **0 skip** khi nghiệm thu. `BROWSER_ENGINE=firefox|webkit` dùng browser Playwright tương ứng đã cài. CI đã khai báo ba engine; CI chưa chạy không được coi là đã đạt. Thử khôi phục DB/ảnh riêng: `TEST_MYSQL_CONTAINER=<mysql-test> node scripts/verify-backup.cjs`; tài khoản dump trong container có thể khác root qua TCP (`TEST_MYSQL_DUMP_PASSWORD`, chỉ ở môi trường test).

Kết quả tại 26/10/2026: 76 Node/MySQL test đạt, 0 skip; Chromium dashboard/mobile đạt; NMS+ffmpeg thật và backup mã hóa/restore vào DB test có đối chiếu ảnh SHA256 đạt. 10 UAV fixture gửi tổng 400 OSD vào server thật, đúng từng phiếu. Đây là baseline nhiều máy, chưa đo giới hạn tải tối đa.

Chưa thể nghiệm thu toàn bộ hệ thống: cần thiết bị M3T/RTK/RC, license/SDK và calibration thật, endpoint/model Vision, SMTP/PMIS, domain/cert nhà máy. Registry/binary MinIO và tải Firefox bị mạng môi trường từ chối; full Docker/MinIO STS và Firefox/WebKit/Edge/Android/iOS thật chưa được xác nhận. Không có lệnh bay được gửi khi kiểm thử.
