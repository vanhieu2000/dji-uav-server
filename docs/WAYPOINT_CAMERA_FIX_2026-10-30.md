# Chỉnh waypoint và cập nhật hình sau đổi camera

Áp dụng sau `221bf25`.

## Waypoint

- Thanh cấu hình chia cột đều, không ghép nhiều label/select vào một field. Bỏ cột điều khiển hẹp dài; bố trí thanh cấu hình, bản đồ toàn chiều ngang rồi bảng điểm bên dưới.
- Bảng có ô nhập trực tiếp độ cao, tốc độ, gimbal, thời gian dừng và lens. Các nút lên/xuống/xóa giữ thứ tự waypoint. Bảng cuộn trong khối trên màn hình nhỏ, không kéo rộng cả trang.
- Sửa popup cùng các tham số và kiểm tra giới hạn; không âm thầm đổi thời gian dừng 0 thành 1 giây. Gimbal nhập được giá trị trong khoảng hỗ trợ thay vì chỉ ba lựa chọn cố định.
- Độ cao tính so với điểm cất cánh. WPML đã có `executeHeightMode=relativeToStartPoint`, `executeHeight`, `waypointSpeed`, thao tác `hover` trước chụp. Dừng bằng 0 nghĩa là không thêm thao tác hover; không sinh hoverTime bằng 0 vì DJI yêu cầu hoverTime > 0 khi có thao tác hover.
- DJI WPML có liệt kê M3E/M3T/M3M hỗ trợ độ cao từng điểm, tốc độ và hover. Không coi cấu hình Web là bằng chứng RC đã thực thi tuyến; cần tải KMZ và kiểm tra trên Pilot trước chuyến bay thực.

Nguồn: [DJI waylines.wpml](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/00.dji-wpml/30.waylines-wpml.md), [DJI common elements — hover](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/00.dji-wpml/40.common-element.md#hover).

## Camera

- Sau khi API đổi nguồn trả địa chỉ xem, khởi tạo lại trình phát với URL được cấp. Trước đây handler chỉ cập nhật combo/nhãn, chưa mở lại player sau đổi nguồn native bằng stop/start.
- Cập nhật ID nguồn đang chọn từ phản hồi; chế độ Theo tay cầm xóa mốc thử cũ khi đã về đúng nguồn. Nhờ vậy việc quay lại một nguồn RC đã dùng trước đó không bị chặn bởi mốc cũ.
- Theo tay cầm vẫn kiểm tra trạng thái mỗi 5 giây; Wide/Zoom/IR chọn riêng trên Web không phải chế độ tự theo RC. Không tăng retry MQTT hoặc bỏ qua ACK.

## Xác minh

- 17 kiểm thử điều khiển/upgrade đạt.
- Chromium live, monitoring và workspace đạt, gồm mở lại player sau đổi nguồn và đổi capability Wide → Zoom trong chế độ Theo tay cầm, không tự gửi lặp khi lần chuyển chưa xác nhận.
- Kiểm thử nhập trên bảng: 44.5 m, 4.2 m/s, -45°, 4.5 s và điểm khác dừng 0 s; kiểm tra payload và giải nén KMZ từ builder thật xác nhận các giá trị, không sinh hoverTime 0.
- Kiểm tra bố cục 390/768/1366 px. Đã xem ảnh chụp giao diện kiểm thử desktop.
- Đã bổ sung kiểm tra file KMZ vào bộ Ticket Core dùng DB. Lần chạy tích hợp này bị bỏ qua vì môi trường hiện tại không có MySQL chạy; không tính là kiểm thử DB đạt.
- Chưa có RC/UAV vật lý trong môi trường phát triển; khả năng chuyển hình thực tế cần kiểm tra lại tại máy khách.

Cập nhật main hoặc ZIP, giữ .env và dữ liệu, chạy CHAY_WIFI.bat rồi Ctrl+F5. Chọn Theo tay cầm khi muốn Web đi theo RC; khi chọn riêng Wide/Zoom/IR, Web yêu cầu đúng nguồn đó.
