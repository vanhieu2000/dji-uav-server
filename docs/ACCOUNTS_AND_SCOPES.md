# Tài khoản và phạm vi dữ liệu (E)

Chạy migrations rồi `cd backend && npm run admin:create`. Lệnh chỉ tạo tài khoản chưa tồn tại, ghi mật khẩu ngẫu nhiên vào `backend/data/bootstrap-password` (0600, gitignore); bắt đổi ngay sau đăng nhập. Không tự sửa/xóa tài khoản hay dữ liệu nhà máy. Hash mẫu không đăng nhập được và không có mật khẩu dự phòng. Dashboard dùng cookie HttpOnly/SameSite Strict; Pilot dùng Bearer JWT HS256 có issuer/audience/jti, phiên SQL và thời hạn 12 giờ. Khóa tài khoản, đổi quyền/mật khẩu, đăng xuất thu hồi phiên; socket kiểm tra lại phiên và phạm vi mỗi sự kiện.

`/dashboard/accounts.html`: đơn vị, người dùng/khóa/khôi phục, phân quyền, phạm vi UAV, danh mục chung, cấu hình lưu trữ, nhật ký. Không thể khóa/hạ quyền quản trị cuối cùng. Chỉ ADMIN dùng API legacy chưa có resolver; OPERATOR/ENGINEER/VIEWER dùng `/api/workspace/*`. Phạm vi phiếu cần **đồng thời** đơn vị và nhà máy; tài sản chỉ đọc, không cấp quyền sửa cho vận hành. Phiếu/UAV cũ chưa gán phạm vi chỉ ADMIN thấy. Gán lại trên giao diện, không tự đoán từ tên nhà máy. Tổ công tác legacy dùng riêng ADMIN; phạm vi tổ không được suy ra tự động.

Khôi phục: cấu hình SMTP_* và PASSWORD_RESET_BASE_URL HTTPS. Token random lưu SHA256, hết hạn 20 phút, một lần; fragment URL tránh log token. Nếu thiếu SMTP trả 503 rõ ràng. Test chỉ tạo token hash trong DB test, không gửi email thật. Cần kiểm tra SMTP thật tại triển khai. Password tối thiểu 12 ký tự, tối đa 72 byte (giới hạn bcrypt).

Kiểm chứng: 69 test Node/MySQL đạt (0 skip), gồm gate 401/403/428, không bypass admin123, cookie HttpOnly, nhà máy/đơn vị khác bị chặn, WS không lộ phiếu khác, reset một lần, logout và khóa thu hồi ngay. Chromium dashboard smoke đạt. Đây là kiểm thử localhost/fixture, chưa nghiệm thu RC hay email production. Phần I tiếp tục harden MQTT, storage, CORS và HTTPS; chưa coi receiver S3 local là STS production.

## Tài khoản operator local và quyền tạm thời (28/10/2026)

Theo yêu cầu hiện tại, bootstrap tạo `operator` với role OPERATOR và cờ **Toàn bộ phạm vi nghiệp vụ** cho riêng tài khoản này. Không đổi các tài khoản OPERATOR khác và không biến operator thành ADMIN. Operator sử dụng dashboard/nghiệp vụ, xem tất cả nhà máy/phiếu hiện có, nhưng không được vào Cài đặt chung, Quản lý tài khoản, API quản trị, hoặc xuất log toàn hệ thống. Kiểm tra quyền ở cả sidebar và API. Các tài khoản operator thông thường không bật cờ vẫn bị giới hạn đơn vị/nhà máy như trước.

`CHAY_WIFI.bat`/`CHAY_LOCAL.bat` chỉ tạo khi chưa có tài khoản; không đặt lại mật khẩu hoặc quyền của tài khoản hiện hữu. Mật khẩu khởi tạo riêng ở `backend/data/operator-password.txt` trên chính PC. Có thể bấm `TAO_OPERATOR.bat` nếu cần tạo riêng. Đăng nhập Web đổi mật khẩu trước khi dùng trên RC. Không ghi mật khẩu lên Git.

Admin có tab **Quản lý tài khoản** trên sidebar để sửa tài khoản, đơn vị, nhà máy và bật/tắt cờ phạm vi nghiệp vụ. Bỏ cờ này sẽ trở về phạm vi được chọn; thay quyền làm tăng auth_version và thu hồi các phiên hiện tại, kể cả đăng nhập RC đã ghi nhớ. Tài khoản cá nhân/đổi mật khẩu là phần riêng; người dùng không cần quyền quản trị để đổi mật khẩu của mình.
