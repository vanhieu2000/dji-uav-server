# Vận hành bản local trực tiếp

Bản này dùng Node.js24 + MySQL8 cài trực tiếp. Entry point Windows: `CHAY_WIFI.bat`.
Hướng dẫn đầy đủ: [CHAY_LOCAL.md](CHAY_LOCAL.md).

- Ảnh: `STORAGE_MODE=local`, thư mục `MEDIA_DIR`; signed upload và callback do chính Node server phục vụ.
- Live: RTMP/HTTP-FLV tích hợp; bật `LIVE_STREAM_ENABLED=true`, mở cổng LAN tương ứng.
- Một UAV mặc định, có `UAV_DEVICE_MODE=multi` để mở rộng. Không có dữ liệu mẫu hoặc camera/chuyến bay giả.
- Giữ `.env`, khóa JWT, thư mục ảnh và `backend/data` ngoài Git. Không chia sẻ bí mật qua ảnh chụp màn hình/log.
- Chưa dùng bản local HTTP để public Internet. Triển khai ngoài LAN cần TLS, kiểm soát mạng và nghiệm thu riêng.
- CSDL hiện có chỉ được migrate additive, không tự reset. Xóa dữ liệu phải dựa trên provenance và bản sao lưu.

## Sao lưu và phục hồi

1. Dừng chụp/upload, dừng launcher.
2. Xuất SQL bằng Workbench/mysqldump, không đưa mật khẩu lên dòng lệnh.
3. Sao chép nguyên MEDIA_DIR, backend/data, uploads/waylines, tiles, .env và khóa riêng vào bản sao lưu có kiểm soát truy cập.
4. Phục hồi thử trên DB tên riêng và thư mục riêng; đối chiếu số bản ghi/file và SHA256 ảnh gốc trước khi phục hồi máy thật.
5. Khởi động lại, kiểm tra health, đăng nhập, gallery, quyền tải ảnh và RC thực.

Không tự xóa ảnh hoặc DB thật để làm sạch dữ liệu mẫu. Seed và controls mô phỏng đã được gỡ khỏi mã chạy.
`node scripts/retention.js` từ backend chỉ preview; chỉ dùng chế độ xóa sau khi có backup đã xác minh.

## Kiểm chứng

`npm test` dùng MySQL test riêng. Bộ native storage thử chữ ký AWS SDK thật, upload JPEG/multipart,
callback vào DB, ảnh trên đĩa, callback lặp và chặn phiên bị thu hồi.
Camera live thử command ACK/rejection và giao diện combo; vẫn cần xác nhận hình Wide/Zoom/Thermal trên RC vật lý.
Ảnh RGB/video không thay thế ma trận nhiệt SDK. Không suy ra nhiệt độ từ màu ảnh.
