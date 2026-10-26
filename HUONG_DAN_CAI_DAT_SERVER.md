# 🚀 HƯỚNG DẪN ĐÓNG GÓI VÀ CÀI ĐẶT SERVER UAV NHANH NHẤT

Tài liệu này hướng dẫn cách đưa toàn bộ hệ thống Server điều khiển UAV & phân tích ảnh nhiệt sang máy chủ (Server vật lý, VPS Cloud, hoặc máy tính trạm).

---

## 📌 CÁC CỔNG MẠNG HỆ THỐNG SỬ DỤNG (CẦN MỞ FIREWALL):
* **`8080`**: Web Dashboard giám sát, REST API, Webhook cho DJI Pilot 2 và WebSocket telemetry.
* **`1883`**: MQTT Broker (nhận dữ liệu bay, tọa độ GPS, pin, trạng thái từ UAV).
* **`1935`**: RTMP Streaming Server (nhận luồng camera quang học & camera nhiệt phát từ flycam).
* **`8000`**: HTTP-FLV / HLS Video Server (phát luồng livestream lên trình duyệt Web).

---

## 🌟 PHƯƠNG ÁN 1: MÁY CHỦ CHẠY WINDOWS / WINDOWS SERVER (NHANH NHẤT - 2 PHÚT)
> **Phù hợp nhất** khi máy chủ server chạy Windows Server 2019/2022 hoặc Windows 10/11 Pro.

### Bước 1: Chuẩn bị máy Server
1. Cài đặt **Node.js LTS** (khuyên dùng Node 20.x): [Tải tại https://nodejs.org](https://nodejs.org)
2. Copy toàn bộ thư mục `dji_uav_server` sang máy server (ví dụ đặt tại `C:\dji_uav_server`).

### Bước 2: Khởi động hệ thống
* Chỉ cần click đúp vào file:
  ```text
  3_Chạy_Server_Local_Ngay.bat
  ```
  File này sẽ tự động:
  - Cài đặt thư viện dependencies (`npm install`).
  - Khởi động đồng thời: Web Server (8080), MQTT Broker (1883), RTMP Server (1935), HTTP Video (8000) và động cơ DJI Thermal SDK v1.8.
  - Tự động mở Dashboard trên trình duyệt: `http://localhost:8080/dashboard`.

### Bước 2.1: Cấu hình (bắt buộc từ bản có Bản đồ & Tài sản)
1. Chép `.env.example` thành `.env` ở thư mục gốc dự án, điền mật khẩu MySQL (`MYSQL_PASSWORD`) và khóa DJI (`DJI_APP_ID`, `DJI_APP_KEY`, `DJI_APP_LICENSE`).
   Khi chạy local, server tự đọc file `.env` này. File `.env` không được đưa lên git.
2. Lần đầu: tạo CSDL bằng `mysql_init/01_schema.sql` (và `02_seed_data.sql` nếu cần dữ liệu mẫu).
3. Các bảng mới (bản đồ nền, mối nối dao cách ly, điểm chụp ảnh...) **tự được thêm khi server kết nối được MySQL**.
   Có thể chạy tay: `cd backend` rồi `npm run migrate`. Mỗi file trong `backend/src/db/migrations` chỉ chạy 1 lần, không xóa dữ liệu cũ.
4. Mất kết nối MySQL: Dashboard hiện thanh đỏ cảnh báo, API trả lỗi 503 (không còn tự dùng dữ liệu mẫu), server tự thử kết nối lại mỗi 10 giây.

### Bước 2.2: Khai báo tài sản và bản đồ nền
* Vào **Cài đặt tài sản** trên Dashboard:
  - **Cây tài sản & bản đồ**: tạo nhà máy (tâm bản đồ), khu vực pin (vẽ ranh giới), chuỗi pin (bấm điểm đầu/cuối để sinh vị trí tấm pin), trạm → ngăn lộ → dao cách ly → mối nối, điểm chụp ảnh.
  - **Nhập Excel**: tải file mẫu, điền theo mã đang quản lý, bấm *Kiểm tra* rồi *Ghi vào hệ thống*.
  - **Bản đồ nền**: xuất ảnh bay thành ô ảnh XYZ (DJI Terra / Pix4D / QGIS), nén `.zip` dạng `{z}/{x}/{y}.png` rồi tải lên.
    File quá lớn: chép thẳng thư mục vào `backend/tiles/basemaps/<tên>` và dùng *Đăng ký thư mục có sẵn*.

### Bước 2.3: Chạy kiểm thử (cho lập trình viên)
```bash
cd backend
npm test
```
Test tự tạo CSDL riêng `dji_uav_test` rồi xóa sau khi chạy, không đụng dữ liệu thật.
Để thử luồng UAV khi không có máy bay, có thể dùng bộ giả lập MQTT mã nguồn mở `YuYongJu/dji-cloud-simulator` (chạy riêng, trỏ về cổng 1883).

### Bước 3 (Tùy chọn - Chạy tự động cùng Windows không tắt):
Để server tự động chạy ngầm dưới nền và tự khởi động lại khi server reboot:
1. Mở PowerShell hoặc CMD với quyền Administrator trên server:
2. Chạy 3 lệnh:
   ```powershell
   npm install -g pm2
   cd C:\dji_uav_server\backend
   pm2 start server.js --name "dji-uav-server"
   pm2 save
   ```

---

## 🐳 PHƯƠNG ÁN 2: MÁY CHỦ CHẠY LINUX (UBUNTU / DEBIAN / DOCKER)
> **Phù hợp nhất** khi thuê Cloud VPS (AWS, Azure, DigitalOcean, Viettel Cloud, VNPT Cloud) hoặc Server Linux.

Hệ thống đã chuẩn bị sẵn file `docker-compose.yml` gồm các container:
* **EMQX Cluster** (MQTT Broker hiệu năng cao cho hàng ngàn UAV).
* **MediaMTX** (Server livestream WebRTC độ trễ siêu thấp < 0.5s).
* **MySQL 8.0** (Cơ sở dữ liệu quản lý chuyến bay, lịch sử nhiệt độ).
* **MinIO S3** (Kho lưu trữ đám mây chứa ảnh nhiệt R-JPEG và video bay).
* **DJI Cloud Backend** (Node.js tích hợp DJI Thermal SDK Linux x64).

### Các bước cài đặt:
1. Copy thư mục dự án lên máy chủ Linux qua SSH / SCP.
2. Mở terminal tại thư mục dự án và chạy duy nhất 1 lệnh:
   ```bash
   docker compose up -d --build
   ```
3. Kiểm tra trạng thái:
   ```bash
   docker compose ps
   ```
4. Truy cập Web Dashboard:
   ```text
   http://<IP_SERVER>:8080/dashboard
   ```

---

## 📱 CẤU HÌNH TRÊN TAY CẦM ĐIỀU KHIỂN DJI PILOT 2:
1. Kết nối tay điều khiển DJI RC Plus / Smart Controller vào mạng Wi-Fi / 4G chung dải mạng với Server.
2. Trên màn hình ứng dụng **DJI Pilot 2**:
   - Chọn mục **Cloud Service** (Dịch vụ đám mây) -> Chọn **Custom Cloud Service**.
   - Nhập địa chỉ Server:
     ```text
     http://<IP_CỦA_SERVER>:8080/pilot-login
     ```
3. Đăng nhập bằng tài khoản có trong hệ thống và **chọn phiếu kiểm tra** đang chờ / đang thực hiện
   (phiếu tạo trên Dashboard, mục *Phiếu kiểm tra*). Chưa có phiếu nào thì không đăng nhập được.
4. Khi kết nối thành công, drone sẽ tự động gửi:
   - Tọa độ GPS thời gian thực về bản đồ Dashboard.
   - Luồng camera nhiệt và camera quang học về Web.
   - Ảnh chụp tự động đồng bộ về Server và giải mã nhiệt độ bằng DJI Thermal SDK v1.8.
