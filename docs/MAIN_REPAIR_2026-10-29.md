# Bản sửa main ngày 29/10/2026

Đối chiếu từ main `217ec81`. Giữ giao diện sidebar phẳng của bản này và sửa các luồng giao diện chưa nối đúng API.

## Điều hướng và nhập liệu

- Quản lý tài khoản, Bản đồ 2D và Bản đồ offline là các node riêng trên sidebar. Chỉ admin truy cập nhóm quản trị này.
- Cài đặt chung giữ ngưỡng nhiệt, đường dẫn ảnh gốc và cấu hình kết nối Vision.
- Tài khoản, phiếu, UAV, gói bản đồ và đường bay mẫu tách màn hình danh sách khỏi màn hình thêm/sửa. Đường bay sửa thành phiên bản mới để không đổi kế hoạch đã phân công.
- Bảng tài khoản lưu đúng phạm vi nhà máy/đơn vị. Đặt lại mật khẩu dùng endpoint riêng; thao tác khóa giữ lịch sử và thu hồi phiên. Không xóa vật lý người dùng đã tham gia nghiệp vụ; backend chặn khóa admin cuối.
- Phiếu lưu chu kỳ, loại đối tượng, người/tổ phụ trách, thời gian kế hoạch, UAV/RC và nhiều đường bay mẫu. Không dùng serial máy bay viết cứng.

## Đường bay, thực hiện phiếu và ảnh

- Nhà máy, vùng bao và vùng cấm lấy từ DB; có công cụ vẽ/lưu ranh giới. Bỏ polygon Thác Mơ viết cứng và thông báo diện tích cố định sai.
- Server kiểm tra cả đoạn nối waypoint, không chỉ hai điểm đầu/cuối. Thiếu ranh giới hoặc ra ngoài/vào vùng cấm sẽ bị từ chối.
- Cho chọn nền vệ tinh hoặc gói bản đồ đã tải lên; điểm chụp có độ cao, tốc độ, gimbal, hover và lens.
- Chi tiết phiếu có gắn/kết thúc phiên thực hiện, khóa tự gán ảnh khi sai tuyến, đối soát ảnh gốc và trạng thái hoàn thành qua API đã có.
- Xác nhận tuyến trên Web là **xác nhận thủ công**, không phải bằng chứng Pilot tự báo đã chạy đúng KMZ. Không bổ sung lệnh cất cánh từ Web.
- Tuyến kế hoạch, GPS thực tế và vị trí ảnh hiển thị riêng. Ảnh IR hoặc ảnh nhiệt cao không tự bị đánh dấu là ảnh lỗi nếu chưa có kết quả phát hiện.
- Gửi Vision theo phiếu/chuyến tạo job thật, có phân trang và chống trùng theo ảnh/hash. Chưa cấu hình worker sẽ báo lỗi, không báo đã phân tích xong.
- Tải báo cáo PDF/DOCX thật. PDF dùng font tiếng Việt có sẵn trong project để chạy trên Windows.

## Điều khiển live

- Khôi phục đầy đủ DOM adapter để module readiness không dừng vì thiếu nút/select.
- UAV/camera và các nút kiểm tra, xin/trả quyền, bật/dừng live nằm ngay trong khung live; kích thước nút và tương phản được thống nhất.
- Combo camera tiếp tục gọi bộ xử lý đổi camera đã có; lựa chọn bị từ chối sẽ được hoàn lại. Xem live phiếu sử dụng đúng ticket, không tự gửi lệnh bật live khi chỉ mở xem.
- Không sửa bộ gửi lệnh `deviceCommands`, route `deviceControl`, ACL MQTT hoặc mã Pilot login/bridge trong bản sửa này.

## Lưu cấu hình và bản đồ

- Cấu hình được lưu tại `backend/data/operator-config.json` trên **máy chạy server**, không chỉ localStorage trình duyệt. File này không đưa lên Git.
- Đường dẫn ảnh phải là đường dẫn tuyệt đối trên máy chủ, ví dụ `D:/UAV/AnhGoc`. Lưu xong phải dừng/chạy lại server để áp dụng; giao diện báo rõ điều này. Không tự di chuyển/xóa ảnh cũ. URL ảnh cũ vẫn có cơ chế đọc từ đường dẫn đã ghi nhận trong DB.
- Khóa callback/API token Vision lưu trong file cấu hình riêng, không trả về giao diện đọc cấu hình. Quyền file là 0600 trên hệ thống hỗ trợ; trên Windows cần giữ thư mục dữ liệu trong tài khoản người chạy server.
- Kiểm tra endpoint Vision chỉ xác nhận phản hồi HTTP, không chứng minh AI đã xử lý ảnh.
- Upload bản đồ nhận **ZIP ô ảnh XYZ/TMS** (`{z}/{x}/{y}.png` hoặc `.jpg`). Chọn đúng hệ ô ảnh. Cần xuất tiles từ DJI Terra/QGIS trước; chưa có bộ chuyển GeoTIFF/MBTiles/ảnh JPG sang bản đồ địa lý trực tiếp.
- Bỏ dữ liệu gói bản đồ mẫu. Thêm/sửa/xóa gói gọi API thật; xóa có xác nhận vì sẽ xóa các ô ảnh tương ứng.

## Cập nhật và thử local

1. Dừng cửa sổ server đang chạy; sao lưu DB và thư mục dữ liệu/ảnh hiện có.
2. Pull `main`, hoặc giải nén bản phát hành mới vào thư mục riêng rồi chép lại `.env` và dữ liệu hiện có. Không lấy dữ liệu test của bộ kiểm thử làm dữ liệu vận hành.
3. Chạy `CHAY_WIFI.bat`, mở địa chỉ LAN được in ra. Nếu trình duyệt còn giữ giao diện cũ, tải lại bằng Ctrl+F5.
4. Admin kiểm tra đường dẫn ảnh/Vision, tài khoản và gói bản đồ trên các node tương ứng. Khởi động lại sau khi đổi cấu hình runtime.
5. Khi nối RC thật: kiểm tra MQTT/OSD, xin quyền, bật live, đổi camera, chụp một ảnh gốc, đối chiếu file trên máy tính và ảnh trong phiếu; xuất log nếu có lỗi.

Kiểm thử tự động chạy với DB test riêng và fixture trình duyệt. Chưa có RC/UAV vật lý nối vào môi trường phát triển, nên không xem các kiểm thử mô phỏng là nghiệm thu thiết bị thật.

## Kết quả xác minh

- Backend: 105/105 đạt, không bỏ qua; dùng MySQL test riêng.
- Chromium: các bộ `test:browser`, `test:workspace`, `test:mobile`, `test:auth`, `test:accounts`, `test:pilot`, `test:live` đạt.
- Giao diện mới kiểm tra lưu chu kỳ tuần/nhiều tuyến, payload nhà máy khi lập đường bay, tách danh sách/editor, cấu hình lưu qua server, job Vision thật qua endpoint, ảnh IR chưa có phát hiện không bị gọi là ảnh lỗi và các khổ màn hình 390/768/1366.
- Kiểm thử tích hợp gửi Vision lặp giữ nguyên job ID; xuất Word/PDF trả đúng chữ ký file.
- `npm audit --omit=dev`: 0 lỗ hổng tại thời điểm kiểm tra.
- Các file core điều khiển/Pilot/MQTT nêu trên giữ nguyên so với `217ec81`.
