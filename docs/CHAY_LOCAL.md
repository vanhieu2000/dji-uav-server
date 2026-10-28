# Clone và chạy local với MySQL

Bản hướng dẫn ngày 27/10/2026. Code hoàn thiện nằm trên **nhánh `codex/uav-completion`**, chưa gộp vào `main`. Không clone mặc định `main` nếu muốn thử các phần vừa hoàn thiện.

## Chạy bằng một nút (Windows)

1. Lấy code nhánh `codex/uav-completion` (hoặc `git pull --ff-only` nếu đã clone).
2. Bấm đúp **`CHAY_LOCAL.bat`** ở thư mục gốc. File `3_Chạy_Server_Local_Ngay.bat` cũ cũng gọi launcher này.
3. Lần đầu chưa có `.env`, nhập mật khẩu MySQL root một lần trong cửa sổ được che ký tự. Tự dùng DB `dji_uav_management` trên `127.0.0.1:3306`; cấu hình và file mật khẩu `backend/data/local-mysql-password` chỉ lưu ngoài git. Wizard dùng MYSQL_PASSWORD_FILE để giữ nguyên các ký tự đặc biệt như @, dấu nháy và dấu gạch chéo; nếu di chuyển thư mục, cập nhật đường dẫn file này trong .env. Nếu đã có `.env`, giữ nguyên cấu hình.
4. Chờ cửa sổ báo `SERVER SAN SANG`; trình duyệt tự mở dashboard. Giữ cửa sổ server mở, Ctrl+C để dừng.

Launcher kiểm tra Node24/npm, tự cài dependency theo lockfile khi cần, khởi tạo DB rỗng hoặc nâng cấp DB hiện hữu an toàn, tạo `local-admin` **chỉ khi chưa tồn tại**. Mật khẩu Web ban đầu nằm trong `backend/data/local-admin-password.txt`; khác mật khẩu MySQL. Nếu đã đổi mật khẩu Web, dùng mật khẩu mới, file cũ chỉ là mật khẩu ban đầu. Không đặt lại mật khẩu/tạo lại DB mỗi lần chạy.

Bấm lần nữa khi server do launcher này mở vẫn đang chạy sẽ mở lại đúng trang, không tạo thêm server. Nếu cổng đang bị ứng dụng khác dùng, launcher chọn cổng trống gần đó và in URL chính xác; đọc URL trong cửa sổ thay vì đoán cổng. Sau thay đổi code/cấu hình, đóng cửa sổ server cũ rồi bấm lại. Mật khẩu không được ghi trong file `.bat`/`.ps1` hay GitHub.

Cần cài Node24 và MySQL8 trước; launcher không cài hệ điều hành/MySQL và không tự thay mật khẩu root. MySQL phải đang chạy. Lần đầu cài thư viện cần Internet; các lần sau không cài lại nếu lockfile không đổi. Sao lưu DB/ảnh trước khi nâng cấp bản cũ.

Nếu hiện lỗi `local-launcher.lock`: kiểm tra cửa sổ server trước, chờ lần khởi động hiện tại hoàn tất. Chỉ xóa `backend/data/local-launcher.lock` khi chắc chắn cửa sổ launcher/server cũ đã đóng. Không xóa DB hoặc thư mục `backend/data` để thử lại.

macOS/Linux có thể chạy `cd backend && npm run local` sau khi đã cấu hình `.env`; dùng `LOCAL_NO_BROWSER=1` nếu không muốn tự mở trình duyệt. File `.bat`/PowerShell dành cho Windows.

## 1. Chuẩn bị

- Git, Node.js **24 LTS**, MySQL **8.x** đang chạy tại `127.0.0.1:3306`.
- DB: `dji_uav_management`, tài khoản DB: `root`. Điền mật khẩu MySQL bạn đã cung cấp vào `.env` trên máy của bạn; tài liệu và mã nguồn không lưu mật khẩu đó.
- Nếu MySQL đã có dữ liệu: sao lưu trước nâng cấp. Không nhập lại `mysql_init/01_schema.sql` vì file gốc có DROP TABLE. Lệnh `setup:local` bên dưới chỉ khởi tạo khi DB rỗng; DB hiện hữu chỉ chạy migration và giữ dữ liệu.
- MySQL root dùng để thử trên máy cá nhân theo yêu cầu. Khi triển khai thật, dùng tài khoản ứng dụng riêng theo [OPERATIONS.md](OPERATIONS.md).

## 2. Clone và cài thư viện

Mở PowerShell trên Windows (Terminal trên macOS/Linux dùng cùng các lệnh Git/npm):

```powershell
git clone --branch codex/uav-completion --single-branch https://github.com/vanhieu2000/dji-uav-server.git
cd dji-uav-server
Copy-Item .env.example .env
notepad .env
```

macOS/Linux: thay hai dòng cuối bằng `cp .env.example .env` và mở `.env` bằng trình soạn thảo của bạn.

Điền/sửa các dòng sau trong `.env` ở **thư mục gốc repo**, không đặt trong `backend/`:

```dotenv
HOST_IP=auto
LOCAL_NETWORK_MODE=lan
PORT=8080
MQTT_PORT=1883
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD="DIEN_MAT_KHAU_MYSQL_CUA_BAN"
MYSQL_DATABASE=dji_uav_management
BOOTSTRAP_ADMIN_USER=local-admin
JWT_SECRET=
LIVE_STREAM_ENABLED=false
DJI_LIVE_CONTROL_ENABLED=false
ENABLE_MQTT_DEBUG=false
VISION_ENABLED=false
```

Thay đúng giá trị `MYSQL_PASSWORD` bằng mật khẩu bạn cung cấp; giữ dấu ngoặc kép. Mật khẩu có `@` không cần đổi thành `%40` trong `.env`. Đây là mật khẩu DB, **không phải mật khẩu đăng nhập Web**. Bỏ trống `JWT_SECRET` sẽ sinh khóa riêng trong `backend/data/`, không phải dùng một mật khẩu mặc định chung. Không commit `.env` hay `backend/data/`.

Nếu cổng 8080/1883 đang dùng, đổi thành `PORT=8081`, `MQTT_PORT=1884`; mở Web bằng cổng đã đổi. Khi chỉ kiểm tra trên máy tính, không cần điền license DJI/AI/S3 và không cần mở firewall. Thư viện giao diện được phục vụ ngay trong repo, không cần CDN; ảnh nền bản đồ Internet vẫn cần mạng hoặc bộ tiles nhà máy đã nhập.

```powershell
cd backend
npm ci
npm run setup:local
npm run admin:create
npm start
```

`setup:local` tự tạo DB/schema nếu DB chưa có hoặc còn rỗng, không nạp dữ liệu nhà máy mẫu. Nếu DB đang có bảng không thuộc ứng dụng UAV thì dừng để kiểm tra, không xóa bảng đó. Nếu tài khoản `local-admin` đã có, lệnh tạo admin từ chối ghi đè: dùng tài khoản hiện có, chức năng khôi phục trên Web, hoặc chọn tên quản trị mới trong `BOOTSTRAP_ADMIN_USER`.

## 3. Đăng nhập kiểm tra

Giữ cửa sổ server mở. Dùng IP LAN và cổng thực được launcher in ra (không nhập nguyên dấu ngoặc nhọn):

- `http://<IP-LAN-PC>:<PORT>/dashboard/` — dashboard.
- `http://<IP-LAN-PC>:<PORT>/m/` — giao diện điện thoại.
- `http://<IP-LAN-PC>:<PORT>/pilot-login/` — trang Pilot; trình duyệt máy tính không có DJI Bridge nên không phải kết nối UAV.
- `http://<IP-LAN-PC>:<PORT>/api/health` — tình trạng kết nối DB/MQTT, HTTP200 khi sẵn sàng.

Tài khoản Web là `local-admin`. Mật khẩu ban đầu được tạo ngẫu nhiên trong `backend/data/bootstrap-password` (khi đang đứng trong `backend`: file `data/bootstrap-password`). Mở file này bằng trình soạn thảo trên máy cá nhân, đăng nhập và đổi mật khẩu ngay theo màn hình yêu cầu. Sau khi đổi, dùng mật khẩu mới và xóa file mật khẩu ban đầu. Không gửi mật khẩu hoặc file này lên GitHub.

Kiểm tra nhanh sau đăng nhập:

1. Mở **Quản trị**, xác nhận thông tin tài khoản/đơn vị/phạm vi nhà máy.
2. Với DB mới: tự tạo nhà máy/tài sản của bạn; dữ liệu trống là bình thường, ứng dụng không tự dựng UAV/ảnh/nhiệt độ giả.
3. Vào **Nhiệm vụ kiểm tra** để tạo phiếu và gán nhà máy/đơn vị; trên `/m/` mở phiếu, nhập JPEG gốc để thử nhận ảnh và tải Word/PDF. Dùng phiếu kiểm thử riêng, không sửa phiếu đang vận hành chỉ để thử.
4. Đăng xuất rồi đăng nhập lại. API nghiệp vụ không có phiên sẽ trả401.

PDF cần font Unicode. Linux: cài `fonts-dejavu-core` (Ubuntu/Debian). Windows: thêm vào `.env`, ví dụ `REPORT_FONT_PATH=C:/Windows/Fonts/arial.ttf` nếu font này tồn tại. macOS: đặt `REPORT_FONT_PATH` tới một font TTF Unicode đã cài. DOCX không yêu cầu công cụ Word trên server; mở bằng Word/LibreOffice.

GPS điện thoại cần HTTPS hoặc localhost. Truy cập qua IP LAN bằng HTTP có thể bị trình duyệt từ chối GPS; hàng đợi ảnh không thay thế sao lưu file gốc trên thiết bị. Cấu hình HTTPS xem OPERATIONS.md.

## 4. Lần chạy sau và cập nhật

Lần chạy sau:

```powershell
cd dji-uav-server/backend
npm start
```

Khi lấy code mới, dừng server bằng Ctrl+C, sao lưu DB/ảnh và thực hiện:

```powershell
cd dji-uav-server
git pull --ff-only
cd backend
npm ci
npm run setup:local
npm start
```

Không chạy `admin:create` mỗi lần, không xóa `backend/data` (chứa khóa phiên), không chạy lại SQL schema gốc. Nếu cần chuyển máy, chuyển cả DB, ảnh/tiles và cấu hình bí mật qua kênh riêng có bảo vệ, không chỉ clone git.

## 5. Xử lý lỗi thường gặp

| Lỗi | Cách kiểm tra |
|---|---|
| `ECONNREFUSED` MySQL | Dịch vụ MySQL đã chạy chưa, đúng host/port3306 chưa |
| `ER_ACCESS_DENIED_ERROR` | Kiểm tra tài khoản root/mật khẩu trong `.env`; mật khẩu Web là thông tin khác |
| DB không tồn tại/thiếu bảng | Chạy `npm run setup:local`; không tự nhập SQL DROP TABLE lên DB đang dùng |
| `EADDRINUSE` | Đổi PORT/MQTT_PORT hoặc dừng đúng ứng dụng đang giữ cổng |
| `JWT_SECRET cần ít nhất 32 byte` | Xóa chuỗi mẫu, để trống để tự sinh khóa local hoặc dùng secret ngẫu nhiên đủ dài |
| Không đăng nhập bằng `admin123` | Mật khẩu chung đã bị bỏ; dùng tài khoản/mật khẩu do `admin:create` tạo |
| Vision/live/S3 chưa hoạt động | Các tích hợp này cần endpoint/model/license/thiết bị/cấu hình thật; không bắt buộc để thử Web và nhập JPEG thủ công |
| Cảnh báo `npm ci` | Nếu lỗi thực sự thì gửi mã lỗi đã bỏ bí mật; không gửi `.env`. Không chạy `npm audit fix --force` tùy tiện |

## Bản chạy thử trong môi trường cloud này

Repo được clone riêng tại `/workspace/dji-uav-local`, cấu hình ngoài git, DB `dji_uav_management`, Web8081/MQTT1884 để tránh cổng đang dùng. Tài khoản Web của bản chạy này: `local-admin`; mật khẩu hiện tại lưu riêng tại `backend/data/local-web-password` sau khi đã đổi mật khẩu bắt buộc trong kiểm thử. Không có file mật khẩu này trên GitHub. Bản sao lưu trước nâng cấp: `backend/data/pre-local-upgrade.sql`, chỉ có trên môi trường chạy, không nằm trên GitHub. Đây là máy cloud hiện tại; trợ lý không có kết nối điều khiển trực tiếp máy tính cá nhân của bạn. Dùng các bước bên trên để chạy bản tương tự trên máy của bạn.

Kết quả kiểm tra bản clone ngày 27/10/2026: health200, DB/MQTT kết nối; đăng nhập và đổi mật khẩu bắt buộc, dashboard/bản đồ/quản trị/mobile/đăng xuất đạt với Chromium thật, không mock API/CDN; không lỗi JavaScript hay tải thư viện. DB hiện tại chưa có phiếu để xuất báo cáo nên không tự tạo dữ liệu giả; xuất Word/PDF đã kiểm tra bằng fixture trong bộ 77 test. Ảnh nền Internet vẫn có thể trống khi mạng chặn máy chủ tiles; cần nhập tiles nhà máy để xem offline. Ảnh chụp và JSON kết quả riêng ở backend/data, không commit thông tin tài khoản.

Kiểm chứng launcher một nút: 79 test Node/MySQL đạt (0 skip), gồm khởi tạo DB trong đường dẫn có dấu cách, bấm lại dùng đúng server và không đổi hash mật khẩu/dữ liệu, từ chối cấu hình đã thay đổi khi server cũ còn chạy, dừng và dọn khóa. PowerShell7 đã parse và chạy wizard bằng mật khẩu ký tự đặc biệt với Node/browser stub trong cloud; chưa kiểm thử thao tác GUI trực tiếp trên Windows. CI có job parse bằng Windows PowerShell.

## Thử Mavic 3T sau bản sửa kết nối

Xem [MAVIC_3T_LOCAL_TEST.md](MAVIC_3T_LOCAL_TEST.md) để dùng IP LAN, license DJI, xin quyền Pilot, storage MinIO/STS và chọn kênh camera thiết bị công bố. `CHAY_LOCAL.bat` chạy dashboard/API/MySQL đã cấu hình; không tự cung cấp license DJI hay cài MinIO. Lần sửa này giữ form/bộ lọc/biểu đồ hiển thị trực tiếp, chỉ dùng dialog cho chi tiết bản ghi khi người dùng yêu cầu.

## Chạy qua Wi-Fi/LAN (bản sửa bản đồ)

Chạy `CHAY_WIFI.bat` hoặc `CHAY_LOCAL.bat` (mặc định chế độ LAN). Launcher ưu tiên IPv4 của Wi-Fi, bỏ adapter Docker/WSL/VPN; nếu nhiều card phù hợp sẽ yêu cầu đặt HOST_IP rõ ràng, không tự chọn một IP giả. Cấu hình mới dùng:

```dotenv
HOST_IP=auto
LOCAL_NETWORK_MODE=lan
```

Cấu hình cũ HOST_IP=127.0.0.1 được launcher chuyển sang địa chỉ LAN lúc chạy mà không ghi đè `.env` hoặc mật khẩu. Nếu nhiều card, đổi HOST_IP thành IPv4 của PC trên cùng mạng với tay điều khiển (xem `ipconfig`, mục Wireless LAN adapter Wi-Fi). Không dùng IP minh họa của người khác. Để mở bằng URL localhost khi thử trên máy, đặt LOCAL_NETWORK_MODE=loopback.

Cửa sổ chạy in ba địa chỉ chính xác theo IP/cổng thực: SERVER SAN SANG (dashboard), PILOT 2 và MQTT. Trình duyệt mở bằng IP LAN, không còn mặc định localhost. Phép kiểm tra sức khỏe nội bộ vẫn gọi127.0.0.1; đó không phải địa chỉ cấp cho RC. Dịch vụ HTTP/MQTT lắng nghe trên các interface của máy.

PC, điện thoại và RC cần cùng LAN, không bật AP/client isolation hoặc dùng guest Wi-Fi tách thiết bị. Cho phép Node.js/các cổng thực được in qua Windows Firewall trên mạng Private; không tắt firewall toàn bộ. Live cần thêm cổng RTMP/FLV cấu hình; auto upload cần endpoint S3_PUBLIC_ENDPOINT mà RC truy cập được. Các biến MQTT_PUBLIC_URL/RTMP_PUBLIC_BASE_URL/MEDIA_HTTP_BASE_URL nếu đã đặt thủ công không được trỏlocalhost; để trống để dùng địa chỉ mặc định từ HOST_IP. MYSQL_HOST/S3_STS_ENDPOINT nội bộ vẫn có thể dùng127.0.0.1.

Bản đồ Google vệ tinh trở lại mặc định trên ba màn bản đồ. Chỉ chuyển offline khi bạn bấm chọn; ghi nhớ lựa chọn riêng mỗi màn. Ô ảnh lỗi không tự biến thành lưới giả hoặc tự đổi provider. Badge phản ánh tải ảnh trong trình duyệt, không suy ra tình trạng UAV. `/api/map/status` là phép thử OSM từ server (`scope=server-osm-probe`, `affects_basemap=false`), không quyết định chế độ bản đồ trên trình duyệt. Wi-Fi không có Internet vẫn nhận được UAV qua LAN nhưng cần bộ tile offline thực nếu muốn xem ảnh nền; lưới kỹ thuật không phải ảnh vệ tinh đã lưu.

## Operator, điểm chụp thủ công và log

Bản này tự tạo `operator` riêng khi chưa có, mật khẩu khởi tạo ở `backend/data/operator-password.txt` (mỗi PC khác nhau). Tài khoản đã có được giữ nguyên. Đăng nhập Web đổi mật khẩu một lần trước khi đăng nhập RC. Theo yêu cầu tạm thời, riêng operator bootstrap có toàn bộ phạm vi nghiệp vụ nhưng không có quyền Cài đặt chung/Quản lý tài khoản. Admin có tab riêng trên sidebar để quản lý hoặc thu hẹp phạm vi; xem ACCOUNTS_AND_SCOPES.md.

Pilot có Ghi nhớ đăng nhập30 ngày và Quên tài khoản đã lưu; không lưu password dạng rõ trong trình duyệt. Khi broker báo not authorized, bản mới nạp lại thing module và ghi reason code; cập nhật, thoát Cloud Service rồi đăng nhập lại.

Planner có chọn điểm trực tiếp trên map, kéo/sắp thứ tự/xóa, đặt thông số chụp và xuất KMZ theo thứ tự đã chọn. Xem GIAO_DIEN_VA_DIEU_HUONG.md. Nhật ký tự ghi trong backend/data/logs; khi lỗi bấm XUAT_LOG.bat, gửi ZIP ở backend/data/diagnostics. Admin có thể tải log từ console Web; log thô không tự đẩy Git. Chi tiết LOG_CHAN_DOAN.md.

## Bật đồng bộ ảnh gốc trên Wi-Fi local
MQTT chỉ chuyển telemetry. Pilot 2 tải JPEG qua S3/MinIO; `Storage: chưa cấu hình` đồng nghĩa chưa thể tải ảnh tự động.
1. Cài và mở Docker Desktop (Linux containers). Giữ nguyên MySQL hiện tại.
2. Chạy `CAI_DAT_KHO_ANH.bat` tại thư mục gốc. Script chỉ khởi động MinIO riêng, tạo bucket private,
   kiểm tra STS/PUT/GET rồi mới cập nhật các biến S3 trong `.env`. Không đổi DB hoặc tài khoản web.
3. Khi script báo đạt, cho phép TCP9000 qua Windows Firewall mạng Private, cùng IP Wi-Fi với RC.
4. Dừng server cũ và chạy `CHAY_WIFI.bat`; thoát Cloud Service trên RC rồi đăng nhập lại để lấy STS mới.
5. Bật tự tải ảnh gốc trong Pilot 2, chụp một JPEG và kiểm tra ảnh đúng phiếu trên web.
   Ảnh đã chụp trước đó có thể cần chọn tải thủ công trong thư viện Pilot 2.
Không cần cấp quyền điều khiển camera từ web để chụp bằng nút tay cầm rồi tải ảnh.
MinIO giữ ảnh trong Docker volume riêng; không chạy `docker compose ... down -v` hoặc xóa volume.
Khóa lưu ở `backend/data/` (không lên Git); không xóa chúng hoặc thay bằng mật khẩu mẫu.
Console MinIO chỉ mở trên máy local tại127.0.0.1:9001. API9000 mở trên đúng IP LAN, không public Internet.
Đổi IP Wi-Fi cần cập nhật endpoint S3 cho RC; không dùng localhost/127.0.0.1 làm endpoint tải ảnh của RC.
Nếu đã có S3 khác, script từ chối ghi đè. Cấu hình nhà máy/production dùng HTTPS theo `OPERATIONS.md`.
Kiểm tra STS/PUT/GET không thay thế nghiệm thu ảnh thật từ Mavic 3T; cần xem callback/ảnh nhận thành công.

## Một UAV dùng chung và độ trễ live
Mặc định `UAV_DEVICE_MODE=single`: tự chọn khi đúng một UAV ONLINE trong phạm vi, dùng chung lựa chọn cho các chức năng.
Khi mở rộng, đặt `UAV_DEVICE_MODE=multi` rồi khởi động lại để chọn từng UAV rõ ràng.
Có thể đặt `UAV_DEFAULT_SN=<serial>` để cố định UAV mặc định; không chọn nhầm nếu serial đó chưa online.
Lựa chọn thiết bị không tự phát lệnh bay/chụp và không bỏ qua quyền cấp trên RC.
Trình phát FLV tắt stash buffer đúng tham số config, không lazy-load và đuổi sát live edge khi video tích lũy hơn1 giây.
Các thay đổi này giảm buffer trình duyệt, chưa chứng minh độ trễ đầu cuối; Pilot encode, GOP, Wi-Fi và relay vẫn gây trễ.
Nên dùng Wi-Fi ổn định, H.264/720p khi băng thông hạn chế. Muốn mức dưới1 giây ổn định cần đánh giá transport WebRTC riêng;
không thể suy ra đã đồng bộ thời gian thực chỉ từ cấu hình FLV. Ảnh JPEG gốc vẫn cần truyền toàn file và callback.

## Lưu ảnh gốc vào thư mục trên máy tính
Ảnh từ Pilot 2 sau khi tải lên kho ảnh và gửi callback được chép nguyên bản về `backend/uploads/media/`.
Muốn lưu trên ổ riêng, tạo/chọn thư mục rồi thêm vào `.env` ở gốc dự án:
```
MEDIA_DIR="D:/UAV/AnhGoc"
```
Dùng đường dẫn tuyệt đối, dấu `/` trên Windows; ổ phải còn dung lượng và tài khoản chạy server phải có quyền ghi.
Dừng server cũ rồi chạy `CHAY_WIFI.bat` lại. Hệ thống tự tạo thư mục còn thiếu, ảnh mới lưu tại đó;
URL web vẫn là `/uploads/media/...`, không công khai đường dẫn ổ đĩa. Tên file có thể thêm mã tránh trùng.
Đổi MEDIA_DIR không tự di chuyển ảnh cũ; nếu DB đã có ảnh, sao chép nguyên các file hiện có sang thư mục mới trước khi đổi.
Đây là ảnh truyền qua Pilot 2 Media Upload, không phải phần mềm duyệt/kéo file trực tiếp từ bộ nhớ RC.
Chỉ cấu hình MEDIA_DIR chưa đủ nếu STS vẫn 503: cần hoàn tất cấu hình kho ảnh để Pilot tải lên được.
