# Đối chiếu log live RC Pro/Mavic 3T ngày 30/10/2026

Nguồn: ZIP chẩn đoán người dùng gửi lúc 01:48 UTC (08:48 Việt Nam). Không đưa ZIP/raw log vào Git.

## Bằng chứng

- 08:40:29: `live_start_push` cho `39-0-7/normal-0` nhận ACK `result:0` khoảng 0,4 giây sau. Các lệnh dừng cũng có ACK. Vì vậy lỗi này không thể được kết luận là mất MQTT.
- Capability chứa cụm chính `67-0-0` với các ID `wide-0`, `zoom-0`, `thermal-0`; đồng thời có nguồn khác `39-0-7/normal-0`. UI đã ưu tiên mọi nguồn tên normal-0 nên chọn nguồn phụ thay vì cụm M3T chính.
- 08:45:46: HTTP yêu cầu switch `67-0-0/wide-0`, nhưng gói MQTT thực tế bị code đổi thành `67-0-0/normal-0`. ID đó không nằm trong danh sách cụm 67-0-0. Không có ACK cho lệnh đổi lens này trong ZIP.
- 08:46:03: lệnh zoom lặp lại sai ID trên, tiếp tục timeout. Không phải trường hợp đã nhận ACK nhưng parser bỏ qua theo dữ liệu log này.
- Log status cho thấy nguồn đầu của cụm chính thay đổi wide/thermal/zoom khi vận hành. Không lấy nguồn phụ normal-0 làm đại diện cho chế độ theo tay cầm.
- Chất lượng gửi xuống là mức 2, tương ứng SD 1280×720 khoảng 1 Mbps theo tài liệu DJI.

## Sửa

- Chọn Theo tay cầm trên cụm chính `67-0-0`, dựa trên nguồn thiết bị đang công bố; không ưu tiên `39-0-7` chỉ vì tên normal. Khi capability chính đổi trong phiên live và Web vẫn ở chế độ Theo tay cầm, cập nhật nguồn theo lần kiểm tra trạng thái (chu kỳ hiện tại 5 giây). Mỗi nguồn chỉ tự thử một lần nếu thao tác không thành công; không lặp lệnh timeout vô hạn.
- Giữ nguyên video ID công bố. Các lựa chọn Wide/Zoom/Thermal dùng ID riêng nếu có, đổi nguồn bằng stop ACK → start ACK. Không gọi đổi lens sai ID hoặc tự ghép normal-0 vào cụm 67.
- Nếu camera công bố một stream có nhiều lens, dùng `live_lens_change` trên chính ID đó. Enum camera nhiệt gửi là `thermal`; `ir` chỉ là alias đầu vào để tương thích giao diện cũ. normal/default là giá trị hợp lệ khi chủ động đổi chế độ của stream hỗ trợ.
- Không ghim lens khi bắt đầu theo tay cầm. Giữ khả năng báo lỗi đổi lens thực tế, không bỏ qua timeout để báo thành công.
- Mặc định chất lượng live là mức 4 (1920×1080, khoảng 3 Mbps theo DJI). Có thể đặt `LIVE_VIDEO_QUALITY=0` trong .env để dùng adaptive nếu mạng yếu, hoặc đặt mức 0–4; giá trị không hợp lệ bị từ chối. Đây là yêu cầu gửi tới Pilot, không phải bằng chứng đã nhận video 1080p thực tế.
- Giữ các sửa restart player và khung điều khiển gọn ở commit trước.

## Nguồn giao thức

[DJI Cloud API — Pilot/RC Pro livestream](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/10.pilot-to-cloud/00.mqtt/20.rc-pro/20.live.md), đối chiếu snapshot `4ec6b0c7f9472aeb09a0a47949855d19c473ea07`.

## Kiểm tra

17 kiểm thử điều khiển/upgrade đạt; Chromium camera, monitoring và workspace đạt. Fixture tái hiện hai cụm 67-0-0/39-0-7 của log để kiểm tra chọn cụm chính, không chọn nhầm nguồn phụ, giữ ID wide/zoom/thermal, gửi enum thermal, chuyển nguồn có ACK và chất lượng mặc định.

Cần thử tiếp với thiết bị thật để xác nhận màu, độ nét, khả năng 1080p và chuyển camera theo tay cầm. Không có video nhị phân hoặc quyền nối RC thật trong môi trường kiểm thử.
