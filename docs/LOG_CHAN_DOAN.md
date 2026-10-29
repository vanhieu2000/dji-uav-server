# Nhật ký tự động và gói chẩn đoán

Launcher và backend tự ghi JSONL vào `backend/data/logs/`, giữ qua các lần chạy; thư mục này ngoài Git. Có thời gian UTC, PID, request ID, user ID khi xác thực, method/path/query đã che bí mật, thao tác UI/thông báo/lỗi JavaScript, status/thời gian/phản hồi JSON, MQTT topic/tid/bid/method/result và log lỗi/khởi động. Không ghi giá trị form từ thao tác click. Ảnh/video/DB dump/.env và file mật khẩu không được thêm vào gói log.

Mỗi file khoảng5MB, giữ tối đa14 file gần nhất, export tối đa20MB log chưa nén. OSD lấy mẫu tối đa1 bản tin/giây/topic; lệnh/phản hồi/sự kiện không dùng bộ lọc OSD. Queue ghi có giới hạn; nếu nghẽn có bộ đếm dropped, không khẳng định lưu mọi byte trong mọi điều kiện. Dữ liệu quá dài được cắt có nhãn. Nếu đĩa không ghi được, hệ thống ưu tiên tiếp tục telemetry. Console log vẫn có để xem trực tiếp.

Khi lỗi xảy ra:

1. Ghi thời điểm, thao tác mong muốn và lỗi thực tế.
2. Bấm **XUAT_LOG.bat** trên PC, kể cả khi server đã dừng. ZIP ở `backend/data/diagnostics/`.
3. Hoặc admin mở Điều khiển & live → Nhật ký → **Tải log hệ thống (ZIP)**. API `/api/diagnostics/export` chỉ ADMIN được dùng vì log có thể chứa dữ liệu quản trị; operator vẫn được ghi thao tác nhưng không đọc log toàn hệ thống.
4. Gửi ZIP kèm báo lỗi. `manifest.json` có revision Git nếu đang chạy từ clone, Node/platform và thời điểm xuất. Không gửi mật khẩu/JWT/license.

Gói được che các trường mật khẩu/token/license/cookie/authorization/access keys và URL có chữ ký; không tự sao chép log thô vào Git. Log có thể chứa tọa độ, ID tài sản và tên tài khoản. Nếu muốn đẩy lên repo để đối chiếu sau này, kiểm tra gói trước rồi sao chép bản được phép chia sẻ vào `docs/diagnostics/` và commit thủ công, hoặc đính kèm trực tiếp vào cuộc trao đổi. Không commit thư mục backend/data hay .env.
