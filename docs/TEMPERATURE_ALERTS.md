# Cảnh báo, báo cáo và lịch sử nhiệt (G)

26/10/2026. Migration 010 additive, không seed số đo hoặc biểu đồ mẫu. Mỗi số đo có model/result version, thời gian chụp, phiếu/lượt và nguồn VISION. Chỉ kết quả đã được kỹ sư gắn tài sản mới vào lịch sử nhiệt; giữ nguyên giới hạn chất lượng/hiệu chuẩn của đội Vision.

## Lịch sử và ngưỡng

Cài đặt tài sản → **Cảnh báo & lịch sử nhiệt**. Tìm mã tấm pin/DCL/mối nối, xem đồ thị theo thời gian và chu kỳ, đặt ngưỡng riêng. Chọn phiếu để xem DCL đã kiểm tra và nhiệt cực đại thực nhận.

Thứ tự quy tắc: ngưỡng riêng tài sản → ngưỡng loại tài sản → ngưỡng max_allowed_temp của DCL/mối nối hiện có → OTHER. Quy tắc đã cấu hình nhưng tắt thì được tôn trọng, không tự fallback sang ngưỡng khác. Tấm pin chưa có quy tắc thì không tự dùng 65 °C. Nhiệt thiếu là null; nhiệt 0 °C vẫn là số đo hợp lệ. Cấu hình confidence và max/ΔT đều có kiểm tra kiểu/khoảng; ghi ngưỡng cần JWT ADMIN.

Khi xác nhận tài sản, cảnh báo được tính lại theo đúng ngưỡng tài sản; status và lịch sử nhận/xử lý được lưu. Khi kết quả phiên bản mới thay bản cũ, số đo cũ chuyển valid=0, không xóa lịch sử gốc; bảng hiện tại tính lại từ các số đo còn hiệu lực, không giữ nhiệt cực đại sai của bản đã thay. DCL tổng hợp contact/direct ở chu kỳ mới nhất có dữ liệu; màn theo phiếu trả max của đúng phiếu, không trộn phiếu khác.

Hộp cảnh báo Tổng quan và tab chuyên dụng lấy SQL. Thay trạng thái Chưa xem/Đã tiếp nhận/Đã xử lý/Đã loại có nhật ký, người thực hiện, thời gian; VIEWER không được xử lý. WebSocket thông báo khi có kết quả hoặc thay trạng thái. Xác thực/workspace toàn hệ thống tiếp tục ở E, không triển khai public trước E/I.

## Xu hướng

Lịch sử nhóm theo flight_session_id, nếu không có thì ticket_id, nếu cũng không có thì từng số đo. Trong một chu kỳ lấy cực đại, không coi nhiều bbox/ảnh của cùng lượt là nhiều chu kỳ. Hồi quy tuyến tính theo ngày thật, trả °C/ngày, chênh °C/chu kỳ và số chu kỳ. Không dự báo nếu dưới 2 chu kỳ, thời gian trùng, slope không tăng, chưa có ngưỡng hoặc đã vượt ngưỡng.

`trend_horizon_days` để trống thì không sinh cảnh báo sớm. Khi cấu hình, số đo cuối còn dưới ngưỡng và thời gian ước lượng tới ngưỡng nằm trong horizon thì sinh WARNING loại TREND, chống lặp theo số đo/asset. Đây là ước lượng, không phải mô hình dự báo đã kiểm định hay số đo mới. Cần kỹ sư kiểm tra điều kiện đo, tải điện, bức xạ, khí hậu và chất lượng radiometric trước so các chu kỳ. Dữ liệu thiếu/khác điều kiện không được dùng để cam kết vận hành an toàn.

Giới hạn truy vấn lịch sử 1.000 mẫu, có cờ limited; chưa tuyên bố dự báo trên toàn bộ lịch sử nếu bị giới hạn. Độ trễ cảnh báo sau kết quả Vision, không đồng nghĩa OSD/video/ảnh về dưới 1 giây.

## Báo cáo

Trang Báo cáo & Thống kê thay toàn bộ biểu đồ dựng tay bằng `/api/insights/charts?days=7|30|90|365`: phiếu theo ngày, lỗi theo mã, tấm pin có lỗi theo khu, nhiệt cao nhất đã xác nhận. Không có dữ liệu → ghi chưa có số liệu, không vẽ số giả. KPI tấm pin lỗi dùng số tấm có trạng thái lỗi, không đếm lẫn detections của DCL. KPI DCL lấy nhiệt/ngưỡng trong DB.

## API

- GET `/api/insights/temperature?asset_type=PANEL|DISCONNECTOR|CONTACT&asset_id=`: samples, rule, trend, limited.
- GET `/api/insights/disconnectors?ticket_id=`: DCL có số đo hiệu lực, max theo phạm vi chọn.
- GET/PUT/DELETE `/api/insights/rules/:type/:id`: ngưỡng riêng, xóa để kế thừa. Ghi/xóa ADMIN.
- GET `/api/insights/alerts?status=&ticket_id=`; PATCH `/alerts/:id` `{status}`; GET `/alerts/:id/history`.
- GET `/api/insights/charts?days=`: lọc 1..3660 ngày.

Webhook Vision v2 không nhận nhiệt cho ảnh RGB đơn lẻ: không có đầu vào IR/đăng ký cặp để chứng minh số đo. Dùng job IR gốc; hợp đồng ghép cặp RGB↔IR là bước cần thống nhất với đội Vision, không tự suy ma trận nhiệt từ pixel RGB/H.264.

Kiểm thử MySQL riêng: hai chu kỳ nhiệt mối nối, ngưỡng riêng, cảnh báo xu hướng, update trạng thái/audit, version mới làm mất hiệu lực số đo cũ; unit giảm nhiệt/trùng giờ/0 °C. Fixture không phải ảnh drone thật; cần PoC Vision/SDK/DTAT3 trước nghiệm thu nhiệt thực.
