# Chạy trực tiếp trên máy tính

Cần Node.js24 LTS và MySQL8 cài trên máy. Chạy `CHAY_WIFI.bat`; lần đầu nhập cấu hình MySQL nếu chưa có `.env`.
DB mặc định `dji_uav_management`. DB rỗng được tạo schema, không nạp dữ liệu mẫu; DB hiện có chỉ chạy migrations.
Không nhập lại `mysql_init/01_schema.sql` trên DB đang dùng vì file khởi tạo có DROP TABLE.

## Cập nhật bản đang chạy

Dừng cửa sổ server cũ. Cập nhật nhánh `codex/uav-completion`, giữ `.env`, `backend/data`, `backend/uploads`, `backend/tiles`.
Nếu bản cũ chưa bật ảnh/live native, chạy `CAI_DAT_KHO_ANH.bat` một lần rồi chạy `CHAY_WIFI.bat`.
Script sao lưu `.env` vào `backend/data/`, bật `STORAGE_MODE=local`, `LIVE_STREAM_ENABLED=true` và chuẩn bị thư mục ảnh.
Không tải hay khởi chạy dịch vụ lưu trữ riêng.

## Tài khoản

Mật khẩu admin mới nằm trong file riêng ở `backend/data/`, phải đổi sau đăng nhập đầu tiên.
Tài khoản có sẵn được giữ nguyên mật khẩu. `TAO_OPERATOR.bat` tạo operator nếu chưa có;
mật khẩu tạo mới tại `backend/data/operator-password.txt`. Operator làm nghiệp vụ, không quản trị tài khoản/cài đặt.

## RC và địa chỉ Wi-Fi

PC và RC cùng mạng. Launcher in địa chỉ Dashboard, Pilot và MQTT thực tế; dùng đúng các cổng được in.
Đặt `HOST_IP=<IPv4 Wi-Fi của PC>` khi máy có nhiều card mạng. Không dùng localhost trên RC.
Mở firewall mạng Private cho HTTP, MQTT; khi live cần thêm RTMP1935 và HTTP-FLV8000 (hoặc cổng đã cấu hình).
Đặt license DJI hợp lệ trong `.env` hoặc cài đặt hiện có, không đưa lên Git.
Sau thay cấu hình lưu trữ, thoát Cloud Service trên RC rồi đăng nhập lại để lấy quyền upload mới.
Checkbox nhớ đăng nhập RC dùng cookie/token, không lưu mật khẩu rõ trong trình duyệt.

## Kho ảnh trên máy tính

Cấu hình native:
```env
STORAGE_MODE=local
MEDIA_DIR="D:/UAV/AnhGoc"
LIVE_STREAM_ENABLED=true
UAV_DEVICE_MODE=single
```
Nếu bỏ MEDIA_DIR, ảnh nằm tại `backend/uploads/media/`. Hệ thống tạo thư mục còn thiếu.
Node server cấp quyền upload15phút theo phiên/phiếu, kiểm tra chữ ký SigV4 và nhận JPEG đơn phần/nhiều phần.
Callback Pilot ghi nhận ảnh gốc, giữ nguyên byte file, gắn phiếu/chuyến khi ngữ cảnh và giờ chụp phù hợp.
Ảnh có thời gian chụp ngoài phiên không tự gắn nhầm vào phiếu mới. Không có đo nhiệt từ màu RGB/video.
Cài DJI Thermal SDK riêng nếu cần ma trận nhiệt; thiếu SDK hiển thị chưa có dữ liệu, không tạo số đo giả.
Trong Cài đặt chung, mục Kho ảnh trên máy tính hiển thị đường dẫn, số ảnh và dung lượng còn trống.
Gallery ở Điều khiển & live → Kho ảnh. Ảnh nhận mới được thông báo qua WebSocket.
Đổi MEDIA_DIR không tự di chuyển ảnh cũ: sao chép nguyên các file sang thư mục mới trước khi đổi cấu hình.
Phải giữ nguyên thư mục `backend/data/local-storage` vì chứa quyền upload và trạng thái multipart/callback.
Upload không ký, sai namespace hoặc phiên đã thu hồi bị từ chối. Không công khai endpoint local ra Internet.

## Một UAV và đổi camera live

Mặc định `UAV_DEVICE_MODE=single`: khi đúng một UAV ONLINE, hệ thống dùng chung lựa chọn cho các chức năng.
Đặt `UAV_DEVICE_MODE=multi` khi cần chọn thiết bị riêng; `UAV_DEFAULT_SN` chọn serial mặc định nếu cần.
Việc chọn thiết bị không tự phát lệnh bay/chụp hay bỏ qua quyền phi công.
Chọn camera từ danh sách thiết bị thực công bố, rồi bấm Bật live.
Khi đang phát, đổi combo camera sẽ gửi `live_lens_change` nếu cùng nguồn video; đổi nguồn có thể cần dừng/phát lại.
Combo đổi camera vẫn có trong cửa sổ video đang phát. Lệnh bị Pilot từ chối sẽ báo lỗi và trả lựa chọn về trước.
Theo tay cầm/normal là chế độ mặc định được thiết bị công bố; chọn Wide/Zoom/Thermal nếu được hỗ trợ.
Một luồng không đồng nghĩa có ba camera độc lập. Web chỉ hiện publisher thực, không dựng thêm khung giả.
Player tắt stash/lazy buffer và đuổi live edge; chưa thể đảm bảo đồng bộ thời gian với RC trước đo thực tế.

## Log và sao lưu

`XUAT_LOG.bat` xuất gói log có che bí mật; gửi ZIP ngay sau khi gặp lỗi.
Không tự đưa log thô, ảnh, mật khẩu, dữ liệu DB lên Git.
Trước nâng cấp, dừng chụp/upload; xuất SQL bằng MySQL Workbench hoặc mysqldump và sao lưu thư mục ảnh,
`backend/data`, cấu hình `.env`, khóa JWT và SDK/cấu hình riêng. Giữ bản sao ở ổ khác.
Các bài kiểm thử dùng DB tên chứa `test`, không nạp vào DB vận hành. Dữ liệu hiện trường cũ không tự bị xóa.
