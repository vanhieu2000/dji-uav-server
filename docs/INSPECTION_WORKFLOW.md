# Nhiệm vụ, nhiều lượt bay và đối soát ảnh – giai đoạn F

Ngày 26/10/2026. Mã mới giữ MySQL/Express/Pilot 2. Migration 009 additive; backup DB và ảnh trước khi nâng cấp. Kiểm thử dùng DB test riêng và fixture, chưa có ca bay M3T thật.

## Quy trình

1. Cài đặt tài sản → **Nhiệm vụ kiểm tra**. Tạo phiếu pin/DCL/tổng hợp; chọn phạm vi khu/chuỗi/tấm hoặc ngăn lộ/DCL/mối nối, tổ công tác, UAV, hồ sơ chụp, tuyến và giờ dự kiến. Thời gian từ trình duyệt được gửi ISO kèm múi giờ. API không đoán múi giờ của chuỗi kế hoạch không có offset.
2. Thành viên tổ được chụp lại vào phiếu khi giao việc; sửa tổ về sau không đổi người đã giao trong phiếu cũ. Sửa phiếu có `revision`; dữ liệu cũ bị từ chối 409. Thay scope/route/member đều trong transaction; tài sản không tồn tại rollback toàn bộ.
3. Người vận hành đăng nhập Pilot, chọn phiếu, tải đường bay qua thư viện Cloud và bay trong Pilot 2. KMZ cài action chụp theo hồ sơ. Không có quyền bay tự động từ web/Dock dispatch trên M3T được suy diễn trong đợt này.
4. Nhiều `flight_sessions` cùng ticket; ảnh giữ captured_at, uploaded_at, serial, flight_session_id và assignment_status. Giao diện chi tiết phiếu hiện các lượt, ảnh, số trùng/lỗi/đến muộn, job Vision; cập nhật từ sự kiện WebSocket.
5. Đối chiếu số file gốc trên thẻ/manifest. Nhập số kỳ vọng và nguồn đối soát, xác nhận đã kiểm tra original. Server kiểm số bản ghi có SHA256, file tồn tại và hash khớp. Lỗi/thiếu file không đánh RECONCILED. Không coi vài callback 200 hoặc UAV đã hạ cánh là đủ ảnh.
6. Hoàn tất chỉ khi không có chuyến mở, đã đối soát đúng số ảnh và đủ kết quả Vision nếu phiếu yêu cầu. Ảnh mới đến làm mất hiệu lực đối soát; phiếu đã đóng vẫn cần xem trạng thái dữ liệu và mở lại để đối soát bổ sung nếu cần. Không tự xóa ảnh hoặc giả định ảnh còn thiếu là đã đủ.

## Gán ảnh muộn và ảnh chưa xác định

Mỗi phiên Pilot mới có `upload_namespace` UUID. Response login có `upload_prefix: media/<UUID>/` và JWT gắn `pilot_session_id`. Token phiên giúp thư viện/form upload không lấy phiên gần nhất của người khác. Với receiver local hiện có, giữ UUID trong đường object key khi PUT/multipart; lưu riêng các phần để ghép.

**Giới hạn:** đây là cơ chế định danh ảnh, không phải STS/S3 production hoặc bằng chứng Pilot đã dùng prefix. Luồng storage credentials/S3 thật và tính tương thích Pilot phải thử riêng. Receiver local cũ không có context sẽ không tự nhận task toàn cục gần nhất. Không tạo credential STS giả mới để đánh dấu hoàn thành. Ảnh không đủ căn cứ vẫn được lưu, nằm trong inbox để gán có xác nhận.

Ưu tiên:

- Nhập thẻ nhớ chọn ticket rõ ràng: EXPLICIT, không tự chuyển ảnh trùng sang phiếu mới.
- Biết serial + giờ chụp và chỉ có đúng một chuyến khớp: FLIGHT; task theo chuyến đó, kể cả lúc ảnh về RC đang dùng task mới.
- Có namespace của phiên và thời gian chụp nằm trong khoảng phiên: SESSION.
- Không đủ serial/context/time hoặc hai chuyến cùng khớp: không đoán flight. Không có bằng chứng task thì ticket=null, UNRESOLVED.

Giờ EXIF/XMP không có timezone cần được kiểm chứng với camera/server ở hiện trường; chưa tự cộng/trừ 7 giờ để làm kết quả “khớp”. Một offset sai có thể khiến ảnh vào inbox, an toàn hơn gán sai task. Không dùng upload time thay capture time để ghép.

Inbox **Ảnh chưa xác định nhiệm vụ**: mở phiếu đích rồi xác nhận ảnh thuộc phiếu đó. API cho phép chọn flight của chính phiếu khi operator có căn cứ; từ chối chuyển ảnh đang thuộc phiếu khác, từ chối serial ảnh khác UAV của flight. Lưu ticket_changes. Không ghi lại EXIF để che sự không chắc chắn.

## API

- POST `/api/tickets`, PUT `/api/tickets/:id`: thêm `scope:[{type,id}]` (AREA/STRING/PANEL/BAY/DISCONNECTOR/CONTACT), `team_id`, `member_ids`, `capture_profile_id`, `assigned_device_sn`, `planned_start_at`, `planned_end_at`, `route_ids`, `vision_required`; PUT bắt buộc revision hiện tại.
- GET `/api/tickets/:id`: ticket, scope, crew, routes, photos, defects, progress.
- GET `/api/tickets/:id/progress`: flight_state, sync_state, vision_ready, can_complete, số liệu ảnh/lượt.
- POST `/api/tickets/:id/reconcile`: `{expected_count, originals_checked:true, note}`.
- GET `/api/tickets/:id/ingest-events`: created/duplicate/failed, thời điểm nhận và chú thích nếu trùng ảnh ở phiếu khác.
- GET `/api/tickets/unresolved-media`; POST `/api/tickets/:id/media/:mediaId/assign`: `{confirmed:true, flight_session_id?:...}`.
- GET/POST `/api/teams`; PUT `/api/teams/:id`; GET `/api/teams/people`. Thành viên phải tồn tại/ACTIVE.

## Bỏ dữ liệu giả và lệnh ngoài phạm vi

Đã bỏ code tạo canvas giả/snapshot gắn THERMAL_PHOTO; nút thử mô phỏng không ghi ảnh/không phát lệnh. Các endpoint photo/gimbal/RTH/media-sync/push-to-drone và snapshot cũ trả 410 cùng hướng dẫn dùng Pilot/KMZ. Live web là đường riêng có guard/capability của C; không tự bật. Raw MQTT debug chưa thay cho API sản phẩm được phân quyền, thuộc E/I.

Bỏ parser Kelvin raw/64 chưa được xác minh: thiếu DJI CLI hoặc CLI thất bại → không có ma trận nhiệt, không sinh nhiệt mặc định. Engine label `DJI_TSDK_CLI` không tự khẳng định version SDK 1.8 hay độ chính xác 0,1 °C. Đối chiếu SDK/DTAT3 trên ảnh gốc thật vẫn là bước cần làm.

## Kiểm thử và giới hạn

Fixture trên DB test: scope/team snapshot, invalid FK rollback, revision conflict, hai chuyến/phiếu, ảnh đến sau phiên task khác vẫn thuộc chuyến cũ, no-context UNRESOLVED, duplicate không chuyển task, đối soát hash, file hỏng bị từ chối; Chromium smoke chạy riêng. Không phải nghiệm thu GPS/RTK/firmware hoặc ảnh gốc đang bay. Phân quyền chức năng/workspace và triển khai TLS/stream auth tiếp tục ở E/I, chưa mở public.
