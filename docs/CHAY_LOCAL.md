# Clone và chạy local với MySQL

Bản hướng dẫn ngày 27/10/2026. Code hoàn thiện nằm trên **nhánh `codex/uav-completion`**, chưa gộp vào `main`. Không clone mặc định `main` nếu muốn thử các phần vừa hoàn thiện.

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
HOST_IP=127.0.0.1
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

Nếu cổng 8080/1883 đang dùng, đổi thành `PORT=8081`, `MQTT_PORT=1884`; mở Web bằng cổng đã đổi. Khi chỉ kiểm tra trên máy tính, không cần điền license DJI/AI/S3 và không cần mở firewall.

```powershell
cd backend
npm ci
npm run setup:local
npm run admin:create
npm start
```

`setup:local` tự tạo DB/schema nếu DB chưa có hoặc còn rỗng, không nạp dữ liệu nhà máy mẫu. Nếu DB đang có bảng không thuộc ứng dụng UAV thì dừng để kiểm tra, không xóa bảng đó. Nếu tài khoản `local-admin` đã có, lệnh tạo admin từ chối ghi đè: dùng tài khoản hiện có, chức năng khôi phục trên Web, hoặc chọn tên quản trị mới trong `BOOTSTRAP_ADMIN_USER`.

## 3. Đăng nhập kiểm tra

Giữ cửa sổ `npm start` mở. Mở:

- `http://localhost:8080/dashboard/` — dashboard.
- `http://localhost:8080/m/` — giao diện điện thoại.
- `http://localhost:8080/pilot-login/` — trang Pilot; trình duyệt máy tính không có DJI Bridge nên không phải kết nối UAV.
- `http://localhost:8080/api/health` — tình trạng kết nối DB/MQTT, HTTP200 khi sẵn sàng.

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

Repo được clone riêng tại `/workspace/dji-uav-local`, cấu hình ngoài git, DB `dji_uav_management`, Web8081/MQTT1884 để tránh cổng đang dùng. Bản sao lưu trước nâng cấp: `backend/data/pre-local-upgrade.sql`, chỉ có trên môi trường chạy, không nằm trên GitHub. Đây là máy cloud hiện tại; trợ lý không có kết nối điều khiển trực tiếp máy tính cá nhân của bạn. Dùng các bước bên trên để chạy bản tương tự trên máy của bạn.
