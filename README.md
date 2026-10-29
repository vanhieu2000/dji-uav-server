# DJI UAV Server — Mavic 3T

Chạy trực tiếp trên máy tính: Node.js24 LTS + MySQL8. Bấm `CHAY_WIFI.bat`, dùng các địa chỉ LAN được in trong cửa sổ.
Dashboard `/dashboard/`, Pilot2 `/pilot-login/`, điện thoại `/m/`.

- Một UAV dùng chung mặc định, có cấu hình mở rộng nhiều UAV.
- Nhận telemetry MQTT, phiếu/chuyến bay, ảnh gốc RGB/R-JPEG, cảnh báo và báo cáo.
- Kho ảnh native: Node nhận upload có chữ ký và lưu ảnh vào thư mục PC; không cần dịch vụ lưu trữ riêng.
- Live RTMP/FLV tích hợp; camera đổi theo capability và lệnh DJI `live_lens_change`, không dựng video giả.
- Khởi tạo DB rỗng không nạp dữ liệu mẫu. Mật khẩu riêng từng máy, không reset tài khoản hiện có.

## Cập nhật bản cũ

Dừng server, cập nhật code, giữ .env/data/uploads/tiles. Chạy `CAI_DAT_KHO_ANH.bat` một lần để bật ảnh/live native,
sau đó chạy `CHAY_WIFI.bat`. Thoát Cloud Service và đăng nhập lại trên RC.

```env
STORAGE_MODE=local
MEDIA_DIR="D:/UAV/AnhGoc"
LIVE_STREAM_ENABLED=true
UAV_DEVICE_MODE=single
```

Đọc [chạy local](docs/CHAY_LOCAL.md), [vận hành/sao lưu](docs/OPERATIONS.md),
[tài khoản](docs/ACCOUNTS_AND_SCOPES.md), [nghiệm thu Mavic3T](docs/MAVIC_3T_LOCAL_TEST.md).
Không nhập lại schema có DROP TABLE trên DB đang dùng. Ảnh/DB hiện trường không tự bị xóa.

## Kiểm thử

```sh
cd backend
npm ci
npm test
npm run test:browser
npm run test:pilot
node test/browser-live.cjs
```

Kiểm thử dùng DB riêng chứa chữ `test`, không tạo chuyến bay/ảnh mẫu trong DB vận hành.
DJI license, Thermal SDK/calibration, RC/Mavic3T và endpoint Vision thực cần nghiệm thu riêng.
Thiếu dữ liệu nhiệt phải hiển thị chưa có số đo. Bộ thử phần mềm không thay thế thử camera/ảnh trên thiết bị thật.
