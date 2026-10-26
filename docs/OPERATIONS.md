# Triển khai và vận hành (I)

## Trạng thái đã kiểm chứng

| Kiểm tra | Kết quả 26/10/2026 |
|---|---|
| Node/MySQL | 76 đạt, 0 skip; DB riêng được tạo/xóa |
| Server thật + MQTT | 10 client fixture đồng thời, 400 OSD, đúng 10 UAV/phiếu; không topic điều khiển |
| Quyền transport | Anonymous MQTT bị từ chối; wildcard/serial khác bị chặn; API 401/403; debug publish tắt |
| KMZ | Signed URL 5 phút theo phiên, hết hạn/tamper/thu hồi bị chặn; không fallback thư viện ngoài phiếu Pilot |
| Livestream | NMS 4.4.3 + ffmpeg thật trên localhost: publisher/play grant, không cấp byte video cho viewer thiếu grant, play grant không publish được |
| Backup | AES-256-GCM/scrypt chống sửa/không ghi đè; SQL dump → mã hóa → giải mã → restore DB test khác + ảnh SHA256 khớp |
| Chromium | Dashboard và mobile 390px/GPS fixture/queue qua reload/retry/owner isolation đạt |
| npm audit | 0 lỗ hổng được báo cáo (không thay thế kiểm toán bảo mật toàn diện) |
| Docker compose | Parse/validate cả profile TLS và Vision đạt; chưa build/run stack đầy đủ |
| MinIO | SDK STS/S3 contract đã test với HTTP stub local; registry và binary MinIO bị môi trường từ chối tải, chưa thử MinIO thật |
| Firefox/WebKit/Edge/Android/iOS | Chưa nghiệm thu; tải Firefox từ Playwright CDN bị HTTP403. Có CI matrix ba engine, chưa tính là kết quả đã đạt |

## Stack mới

Một backend giữ MQTT Aedes có auth/ACL và NMS. Không chạy song song EMQX/MediaMTX cũ trên cùng cổng. MySQL và MinIO không publish cổng quản trị ra host. MySQL dùng user `uav`, không dùng root cho ứng dụng, không nạp demo seed. `01_schema.sql` chỉ mount khởi tạo volume mới; **không nhập lại file này trên DB đang dùng**. Backend tự chạy migrations additive; snapshot DB/ảnh trước nâng cấp.

1. Điền `UAV_DOMAIN`, `S3_DOMAIN`, `HOST_IP` trong `.env`. Hai domain cần DNS/cert đúng, Pilot phải tin cậy CA. Không dùng IP ví dụ trong tài liệu cũ.
2. `python3 ops/init-secrets.py`: tạo bí mật ngẫu nhiên ngoài git, không ghi đè file đã có. Thư mục host 0700, file mount cho user node đọc; backup key 0600. Sao chép backup key tới kho độc lập.
3. `docker compose config --quiet`, rồi `docker compose up -d --build`.
4. `docker compose ps` và `/api/health`: chỉ HTTP200 sau DB/migrations sẵn sàng; kiểm tra MQTT connected. Không coi container start là đã kết nối UAV.
5. `docker compose exec backend npm run admin:create`; lấy mật khẩu một lần từ `/app/data/bootstrap-password` bằng terminal quản trị riêng, đổi ngay trên Web và xóa file. Nếu tài khoản tồn tại, dùng `BOOTSTRAP_ADMIN_USER` khác hoặc UI quản trị; không reset ngầm user thật.
6. Gán đơn vị/nhà máy/UAV/phiếu và quyền. Dữ liệu chưa có phạm vi chỉ ADMIN thấy. Cấu hình SMTP_* để reset email hoạt động.

Caddy phục vụ HTTPS443, WebSocket upgrade, `/stream` → NMS HTTP nội bộ và domain S3 riêng → MinIO. Không đưa MinIO dưới path prefix để tránh sai chữ ký S3. Caddy tự cấp chứng chỉ qua ACME khi DNS/Internet phù hợp; nhà máy kín cần chứng chỉ/CA được quản trị cấp và kiểm tra trên RC/thiết bị thật. Không tắt kiểm tra certificate.

MQTT1883/RTMP1935 mặc định chỉ bind loopback. Khi Pilot hỗ trợ TLS và có cert `deploy/certs/fullchain.pem`, `privkey.pem`, dùng `--profile transport-tls`, đặt `MQTT_PUBLIC_URL=ssl://<domain>:8883`, `RTMP_PUBLIC_BASE_URL=rtmps://<domain>:1936`. Profile Nginx kết thúc TLS1.2+; cấu hình này chưa chạy nghiệm thu trong môi trường hiện tại. Nếu firmware chỉ hỗ trợ TCP/RTMP, dùng mạng/VPN nhà máy được cô lập và đặt `MQTT_BIND_IP`/`RTMP_BIND_IP` có chủ đích; không mở hai cổng plaintext ra Internet.

`LIVE_STREAM_ENABLED=false` mặc định; bật sau khi transport và license thực được kiểm tra. `DJI_LIVE_CONTROL_ENABLED=false`, `ENABLE_MQTT_DEBUG=false` giữ mặc định. Không có RTH/chụp ảnh/lệnh bay giả được gửi từ UI. MQTT external broker là đường legacy, chỉ dùng khi có credentials và ACL tương thích phiên; stack chuẩn dùng embedded broker đã test.

## Phiên, MQTT, storage và streaming

Pilot login cấp password MQTT random riêng, DB chỉ giữ SHA256, gắn user session/auth_version/RC+aircraft serial. Chưa biết serial thì từ chối broker, không đoán máy bay. Chỉ publish OSD/state/events/requests/status và reply hợp lệ trên serial của phiên; không retained/wildcard, giới hạn 1MB/gói và 100 gói/giây/client. Chặn serial khác trong body. Khóa/đăng xuất qua ứng dụng đóng MQTT/stream ngay; broker kiểm tra lại mỗi publish và sweep 10 giây. Cần thử topic/payload trên firmware Pilot thật; nếu bị từ chối, sửa allowlist dựa vào tài liệu/payload thực, không bật anonymous.

Native Pilot APIs cần workspace+phiếu đúng phiên; KMZ có URL ký 5 phút khi trình tải không giữ header. Upload form/callback chỉ trong namespace phiên. Raw S3 local receiver cũ dành cho ADMIN/test, **không phải STS production**.

Production dùng AWS SigV4 `AssumeRole` tới MinIO/S3 STS. Inline policy chỉ PutObject/abort/list multipart parts trong `media/<uuid-phiên>/*`, TTL 900 giây. Callback cần object_key chính xác, tải ảnh gốc có giới hạn 200MB/JPEG header, ghi SQL/hash rồi mới xác nhận. Thiếu cấu hình/provider trả lỗi rõ ràng, không cấp access key giả. Khuyến nghị identity storage riêng với quyền bucket cần thiết thay root, và hard quota/lifecycle tại MinIO; backend quota chỉ tính ảnh đã mirror vào SQL, không tính object đang tải chưa callback.

`storage-init` tạo bucket riêng tư nếu chưa có, không cấp anonymous policy. STS endpoint/model credentials thực và receiver callback vẫn cần nghiệm thu M3T/Pilot/MinIO thật.

NMS kiểm tra native signature và grant đồng thời trước byte stream, phân biệt publish/play, đúng path/phiên, thu hồi khi logout/khóa. Grant xem 1 giờ, phát tối đa 12 giờ, kiểm tra phiên 30 giây. Cần mở lại kênh sau hết hạn. NMS có thể trả HTTP200 rỗng khi từ chối FLV; kiểm thử xác nhận không có byte video, không dựa riêng status200. Restart xóa grant trong RAM; cần lấy URL mới. Stream URL là bearer secret: không chia sẻ public. MQTT/raw log redact credentials/token, audit không lưu query/body/cookie/header.

## Sao lưu và khôi phục

Host Linux có Docker Compose, Node24, Python3, tar. Dữ liệu app dùng named volumes. Quản trị chạy trong cửa sổ bảo trì:

```sh
ops/backup.sh /secure/backups/2026-10-26.uavbackup
# Kiểm chứng trên stack độc lập trước; lệnh sau ghi đè dữ liệu stack hiện tại:
ops/restore.sh --confirm-restore /secure/backups/2026-10-26.uavbackup
```

Backup dừng proxy/backend/MinIO để chặn ghi qua STS đang sống, dump SQL, snapshot uploads/tiles/app data và S3 objects, kèm revision/config/secrets; AES-256-GCM/scrypt mã hóa+xác thực, file0600, plaintext tạm xóa khi kết thúc. Trap bật lại dịch vụ sau backup. Cần giữ bản sao ở máy/ổ khác và giữ `BACKUP_KEY_FILE` riêng; mất khóa sẽ không giải mã được.

Restore xác thực archive trước khi dừng dịch vụ, chỉ ghi đè các volume cố định, import SQL, hủy phiên/key/Pilot cũ sau rollback; giữ stack dừng để kiểm tra revision/config/bí mật tương thích. Không tự ghi đè secrets host. Để xem bộ cấu hình cũ: `node ops/archive.js decrypt BACKUP.uavbackup /secure/snapshot.tar KEY_FILE`, giải nén vào thư mục kín, xem/sao chép thủ công trước khi `docker compose start minio backend proxy`. Khôi phục secrets/JWT đồng bộ với snapshot; CA/cert Caddy cần giữ/cấp lại theo vận hành nhà máy. Toàn bộ Compose restore chưa được fire-drill vì không chạy được MinIO image; bài thử DB/ảnh mã hóa riêng đã đạt.

Đặt lịch backup lúc không bay; chỉ xóa bản cũ sau khi có bản mới được thử khôi phục. Retention ảnh mặc định tắt. `docker compose exec backend node scripts/retention.js` chỉ preview; `--apply-after-backup` xóa file local cũ của phiếu đã kết thúc và giữ metadata/detections/audit. Không tự xóa S3; cần lifecycle storage và đối soát riêng. Không chạy tác vụ xóa khi chưa có backup đã kiểm tra. Ngưỡng GB chặn upload mới, không âm thầm xóa ảnh. Re-upload JPEG trùng có thể phục hồi bản local thiếu mà vẫn giữ đúng task/media ID; một backend đơn tiến trình serialize cùng hash để chống ingest trùng đồng thời.

## Kiểm tra tại nhà máy còn lại

- M3T/RC+RTK thật: license, serial, takeoff/landing thresholds, camera index/KMZ, HMS, MQTT allowlist, hai lượt một phiếu, R-JPEG gốc, callback S3, live và reconnect. Chưa nghiệm thu bay thật.
- Vision: image/container/endpoint/model do đội Vision cung cấp, bật profile `vision` và `VISION_IMAGE` thực; contract 2.0. Compose chỉ khai báo cổng tích hợp, không chứa model giả. Worker yêu cầu HTTPS hoặc loopback; dùng endpoint HTTPS tin cậy kể cả Vision trong LAN.
- D2: ảnh/calibration RTK+AGL+FOV/địa hình để kiểm chứng pixel → tài sản; thiếu thì UNRESOLVED và kỹ sư xác nhận, không đoán từ relative altitude.
- SMTP, domain/cert, PMIS schema/auth/mapping/tài sản; chưa có adapter PMIS cụ thể.
- Chrome/Edge/Firefox/Safari và Android/iOS/RC thật. Fixture Chromium/mobile không đại diện mọi thiết bị. CI matrix là công cụ chuẩn bị, không phải chứng cứ các job đã đạt.

Không đổi DB/dịch vụ nhà máy, DNS hay gửi lệnh UAV trong lần kiểm thử trên cloud này.
