# Bật lại live, theo camera Pilot và khung điều khiển gọn

Áp dụng sau `2d8e1a7`.

- Dừng player: hủy timer, unload, detach và destroy player cũ; xóa MediaSource khỏi video trước khi tạo lại. Callback của player cũ không được khởi động lại luồng mới.
- Bắt cả lỗi FLV và kết thúc luồng để thử kết nối lại có giới hạn. Đồng bộ kênh đang xem với module giám sát, tránh giữ đường dẫn cũ rồi không mở lại khi publisher quay về.
- Sự kiện publisher dừng được đối chiếu lại API: sự kiện trễ của kết nối trước không tự hủy video mới đang phát.
- Mặc định camera **Theo tay cầm** (`normal-0`), không tự ưu tiên Wide/IR và không gửi `live_lens_change` cho lựa chọn normal. Nếu quay về Theo tay cầm từ một lens đã ghim, dừng và khởi tạo lại kênh normal sau ACK. Không tự gửi lại lệnh nếu thiếu ACK.
- Wide/IR chỉ được chọn chủ động. Lỗi đổi lens sau khi khởi động live được trả riêng trong `camera_switch_error`, không báo đã đổi thành công. Hỗ trợ tên capability IR thiết bị công bố.
- Không làm giả capability camera. Danh sách điều khiển không được làm trống mất serial đang chọn; khi chưa xác minh điều khiển, giữ serial và hiển thị nguyên nhân khi kiểm tra. Chỉ tự chọn khi có duy nhất một UAV điều khiển được.
- Khung live giữ các nút/selector và trạng thái ngắn. Bỏ đoạn hướng dẫn dài và mã tên kênh trên nhãn LIVE; thông tin chi tiết nằm trong tooltip/log. Video giữ đúng tỷ lệ, không kéo ảnh để lấp khung.

Không thêm bộ lọc màu hoặc tự tăng độ sáng. Video Web nhận được là luồng do Pilot phát; bản sửa xử lý việc ghim lens và vòng đời player. Chưa xác nhận màu, độ nét hoặc chuyển camera RC trên thiết bị vật lý.

Xác minh: 17 kiểm thử điều khiển/upgrade đạt; Chromium workspace, monitoring và camera đạt. Bổ sung teardown/restart/EOF, chống callback cũ, mặc định normal không ép lens, chuyển từ IR về theo tay cầm, lỗi đổi lens, publisher dừng/bật lại cùng đường dẫn không tải lại trang.

Dừng server, cập nhật main, giữ .env và dữ liệu, chạy CHAY_WIFI.bat. Ctrl+F5 một lần để nạp JavaScript mới. Trong Camera chọn Theo tay cầm; thử đổi chế độ trên RC, sau đó Dừng live/Bật live mà không reload trang.
