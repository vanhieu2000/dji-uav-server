# Mavic 3T: kiểm tra kết nối bản sửa 28/10/2026

Đối chiếu DJI Cloud-API-Doc commit `4ec6b0c7f9472aeb09a0a47949855d19c473ea07`:

- [Model hỗ trợ](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/10.overview/30.product-support.md): M3T type77/subtype1, camera67-0-0; controller RC Pro + Pilot 2 trong bảng hỗ trợ.
- [JSBridge](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/10.pilot-to-cloud/30.jsbridge.md): verify license trước đọc SN; workspace và thing trước media; ảnh gốc type0.
- [Điều khiển qua Pilot](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/30.feature-set/10.pilot-feature-set/90.drc.md): xin quyền trên tay điều khiển, xác nhận trạng thái cấp quyền rồi mới thao tác camera. Không đồng nhất quyền API Web với quyền điều khiển do phi công cấp.
- [Camera commands](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/10.pilot-to-cloud/00.mqtt/20.rc-pro/30.drc.md): mode switch, photo_storage_set vision/ir, camera_photo_take, gimbal_reset.

## Cập nhật local

1. Sao lưu DB và thư mục ảnh. Đóng cửa sổ server cũ.
2. Trong repo: `git switch codex/uav-completion`, `git pull --ff-only`. Giữ `.env`, mật khẩu Web và dữ liệu hiện có; không nhập lại schema hoặc seed.
3. Chạy `CHAY_LOCAL.bat`. Dùng đúng cổng launcher in ra; máy thử cần Node24 và MySQL8 như [CHAY_LOCAL.md](CHAY_LOCAL.md).
4. Ctrl+F5 trình duyệt để tải JS/CSS mới. Tài khoản/mật khẩu Web hiện có được giữ nguyên.

## Kết nối thiết bị

PC và tay điều khiển phải truy cập được nhau. Đổi HOST_IP trong `.env` thành IP LAN của PC, không dùng127.0.0.1 cho địa chỉ tay điều khiển. Kiểm tra firewall theo đúng cổng cấu hình: HTTP, MQTT; RTMP/FLV khi bật live. URL vào Pilot: `http://<IP-PC>:<PORT>/pilot-login/`. Dùng appId/appKey/license DJI của ứng dụng trong cấu hình hệ thống, không đưa chúng lên Git.

Chọn một phiếu đang mở thuộc phạm vi người đăng nhập. Bridge xác thực license, đọc RC/UAV SN rồi gắn vào phiên. Nếu máy bay chưa bật, aircraft SN có thể chờ topology từ đúng RC; không tự lấy serial từ topic bất kỳ. Trang chỉ báo MQTT đã kết nối khi callback/getter xác nhận; lỗi license/module phải được xử lý trước khi tiếp tục. MQTT kết nối không chứng minh có OSD mới, ảnh đã nhận hoặc đã được cấp quyền camera.

## Kiểm tra tại chỗ, chưa bay

1. Giữ động cơ tắt. Vào Điều khiển & live, chọn rõ UAV; Kiểm tra kết nối.
2. Xác nhận SN aircraft/gateway đúng thiết bị, OSD mới, model thực từ topology. Chuyển UAV phải xóa các thông số cũ, không trộn các máy.
3. Bấm Xin quyền từ Pilot, đồng ý trên tay điều khiển. Chờ trạng thái Quyền đã cấp từ bản tin state; HTTP chấp nhận yêu cầu chưa đủ. Nếu phi công thu hồi, lệnh tiếp theo phải bị từ chối.
4. Chụp RGB/nhiệt/kép. Server gửi mode switch → đợi reply → chọn lưu vision/ir → đợi reply → chụp. QoS1, chỉ gửi services tới gateway đã xác nhận; không gửi cùng lệnh tới cả gateway và aircraft. Các lệnh có tid/bid và timeout12s, không tự retry. Thông báo chụp là UAV chấp nhận lệnh, chưa phải xác nhận đã nhận ảnh.
5. Trong Pilot bật Media File Upload, tự tải ảnh gốc hoặc tải thủ công từ thư viện. Xác nhận ảnh gốc thực tế xuất hiện trong đúng phiếu; có thể nhập thẻ nhớ nếu storage chưa cấu hình. Nút Đồng bộ giải thích luồng native, không phát media_files_sync không được kiểm chứng.

## Storage tự tải ảnh

Bản này dùng cùng một STS thật cho HTTP và MQTT, prefix `media/<upload_namespace>/`; callback phải thuộc phiên. Không còn trả credentials giả hoặc tự báo object tồn tại. Cần cấu hình:

```dotenv
S3_STS_ENDPOINT=http://<MinIO-host>:9000
S3_PUBLIC_ENDPOINT=http://<IP-MinIO-RC-truy-cap-duoc>:9000
S3_BUCKET=dji-media
S3_REGION=us-east-1
```

Access/secret của identity storage điền riêng trong `.env` hoặc biến `_FILE`, không dùng giá trị mẫu làm mật khẩu thật. Bucket phải riêng tư và đã tạo; dùng `backend/scripts/init-storage.js` sau khi cấu hình. Nếu trực tiếp gọi script, cần nạp `.env` vào process (`node --env-file=../.env scripts/init-storage.js` từ backend với Node24). Production phải dùng HTTPS/CA hợp lệ; xem [OPERATIONS.md](OPERATIONS.md) về stack MinIO/proxy và secrets. Launcher local không tự cài MinIO hoặc cấp license DJI. Chưa cấu hình storage sẽ trả503 rõ ràng; nhập ảnh gốc thủ công vẫn hoạt động. Đã cấu hình không đồng nghĩa đã xác minh upload thành công: phải kiểm tra PUT/callback/ảnh nhận thực tế.

## Livestream

Bật `LIVE_STREAM_ENABLED=true`, kiểm tra cổng RTMP/FLV và URL công khai nếu có proxy; khởi động lại server. Trong Điều khiển & live chọn đúng video_id mà thiết bị công bố, không tự tạo wide-0/thermal-0. URL RTMP có grant đúng phiên/kênh, NMS kiểm tra cả publish/play. Pilot ACK chỉ là đã chấp nhận; trạng thái STREAMING cần publisher thực, sau đó trình duyệt mới xác minh phát hình. Không cấu hình storage hoặc video thì UI báo thiếu, không báo thành công giả.

## Giới hạn hiện tại

RTH/Fly-to từ Web trả410 và không phát lệnh suy đoán; RTH trên toolbar bị vô hiệu hóa có giải thích. Dùng Pilot 2 để điều khiển chuyển động. Chưa triển khai đầy đủ DRC/điều khiển đường bay từ Web. KMZ được tạo để phi công kiểm tra và vận hành trong Pilot, không tự thực thi nhiệm vụ. AI tự chụp khi quá nhiệt chưa được triển khai trong lần sửa này. Snapshot live không thay thế ảnh nhiệt radiometric gốc.

Đã thử bằng test Node/MySQL, broker MQTT thật trên localhost với UAV/camera giả lập và Chromium với API/Bridge giả lập. Chưa nghiệm thu trên Mavic 3T/Pilot 2/MinIO thật. Log gửi đối chiếu cần có thời điểm, phiên bản Pilot/firmware, method/result/tid/bid; che mật khẩu/JWT/access secret/license.

Các thao tác chưa hỗ trợ không giả báo thành công: Fly-and-capture không tự chụp sau một lệnh bay thất bại; Zoom shutter chưa kiểm chứng bị khóa. Bỏ các khung camera nhiệt/zoom mô phỏng và tab3 camera; một cửa sổ phát kênh thật được chọn từ capability. Dừng phát live gửi lệnh stop và chờ reply, khác với chỉ ẩn cửa sổ xem.
