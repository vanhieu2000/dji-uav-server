> **Tài liệu cũ trước phần E/H/I.** Cổng, auth, mật khẩu và storage bên dưới có thể đã đổi. Dùng [README hiện tại](README.md) và [hướng dẫn vận hành](docs/OPERATIONS.md); không dùng hướng dẫn cũ để mở dịch vụ production.

# HƯỚNG DẪN KẾT NỐI MAVIC 3T & DJI PILOT 2 VÀO MÁY CHỦ GIÁM SÁT

Hệ thống máy chủ đã được cài đặt và thiết lập sẵn sàng tại thư mục:
`C:\Users\dohie\.gemini\antigravity-ide\scratch\dji_uav_server`

---

## I. CÁC CỔNG DỊCH VỤ ĐÃ CẤU HÌNH

| Dịch vụ | Cổng (Port) | Giao thức | Chức năng |
| :--- | :--- | :--- | :--- |
| **Pilot 2 Login Portal** | `8080` | HTTP | Cổng kết nối cho app DJI Pilot 2 trên Remote (`/pilot-login`) |
| **Trung Tâm Giám Sát GIS** | `8080` | HTTP | Màn hình hiển thị bản đồ độ phân giải cao & phiếu kiểm tra (`/dashboard`) |
| **MQTT Broker** | `1883` | TCP | Cổng nhận dữ liệu OSD tọa độ, góc quay, pin và lệnh điều khiển UAV |
| **WebSocket Realtime** | `8080` | WS | Cổng đẩy tọa độ thời gian thực về Dashboard & Phần mềm C# (`/ws`) |
| **Media Livestream** | `1935` | RTMP | Cổng nhận luồng video trực tiếp từ Mavic 3T (RGB & Camera Nhiệt) |
| **WebRTC Stream** | `8889` | WebRTC | Xem video trực tiếp độ trễ cực thấp (<0.5 giây) trên máy tính |
| **MySQL Database** | `3306` | TCP | Cơ sở dữ liệu quản lý phiếu, đường bay KMZ, ảnh kiểm tra |

---

## II. HAI PHƯƠNG ÁN KHỞI CHẠY MÁY CHỦ

### Phương Án 1: Chạy Ngay Lập Tức (Bản Standalone - Không cần chờ cài Docker)
*(Hệ thống đã cài sẵn thư viện và kiểm tra thông mạng 100%)*
1. Mở thư mục `C:\Users\dohie\.gemini\antigravity-ide\scratch\dji_uav_server`.
2. Nhấp đúp chuột vào file:
   👉 **`3_Chạy_Server_Local_Ngay.bat`**
3. Màn hình console sẽ xuất hiện và tự động mở trình duyệt `http://localhost:8080/dashboard`.
4. Lúc này MQTT Broker (1883) và HTTP Server (8080) đã kích hoạt sẵn sàng nhận tín hiệu từ flycam.

---

### Phương Án 2: Chạy Bằng Docker Compose (Bản Đầy Đủ Mang Đi Triển Khai Server Lớn)
*(Dành cho môi trường Production gồm đầy đủ EMQX + MySQL + MinIO S3 + MediaMTX)*
1. Click chuột phải vào file:
   👉 **`1_Cài_Đặt_Docker.bat`** -> Chọn **Run as administrator**.
   *(Script sẽ tự động cài WSL2 và Docker Desktop trên Windows 11)*.
2. Khởi động lại máy tính nếu Windows yêu cầu để kích hoạt Hyper-V/Virtualization.
3. Sau khi bật Docker Desktop, nhấp đúp vào:
   👉 **`2_Chạy_Server_Docker.bat`**
4. Toàn bộ 5 container Docker sẽ được dựng lên tự động:
   - `dji_emqx` (MQTT Broker)
   - `dji_mediamtx` (Video Streaming)
   - `dji_mysql` (Database)
   - `dji_minio` (Lưu ảnh S3)
   - `dji_backend` (Cổng kết nối Pilot 2 & API)

---

## III. HƯỚNG DẪN THAO TÁC TRÊN TAY ĐIỀU KHIỂN DJI PILOT 2

Đảm bảo Remote DJI RC và máy tính đang bắt **chung mạng Wi-Fi**.

* Địa chỉ IP Wi-Fi của máy tính: **`10.20.28.50`**

### Các bước trên DJI Pilot 2:
1. Mở ứng dụng **DJI Pilot 2** trên màn hình tay cầm.
2. Chọn mục **Cloud Service** (Dịch vụ đám mây).
3. Nhấp vào biểu tượng **Open Platforms** (Nền tảng mở / 自建云平台).
4. Nhập địa chỉ máy chủ:
   ```text
   http://10.20.28.50:8080/pilot-login
   ```
5. Nhấn **Connect** (Kết nối).
6. Giao diện đăng nhập xuất hiện:
   - Tài khoản: `pilot`
   - Mật khẩu: `pilot123`
   - Chọn Phiếu kiểm tra:
     * *PKT-PIN-2026-001 (Kiểm tra nhiệt Dãy Pin Block A)*
     * *PKT-DCL-2026-002 (Kiểm tra tiếp xúc Dao cách ly 171)*
7. Nhấn **KẾT NỐI VÀO MÁY CHỦ**.
8. Màn hình Pilot 2 sẽ báo trạng thái **Connected**. Lúc này:
   - Tự động nạp **Đường bay KMZ** tương ứng với phiếu vào flycam.
   - Kích hoạt cơ chế **Tự động đồng bộ ảnh chụp** (ảnh quang học & ảnh nhiệt R-JPEG) về server.
   - Thiết lập luồng **Livestream RTMP** về Media Server.
   - Bắt đầu đẩy dữ liệu bay **OSD Telemetry** (GPS, độ cao, góc quay, pin) về MQTT Broker.

---

## IV. XEM DỮ LIỆU THỜI GIAN THỰC TRÊN TRÌNH DUYỆT

Mở trình duyệt trên máy tính và truy cập:
👉 **`http://localhost:8080/dashboard`**

Tại đây bạn sẽ quan sát thấy:
1. **Cột trái**: Danh sách Phiếu kiểm tra đang thực hiện và file đường bay KMZ đã đồng bộ.
2. **Khu vực giữa**: Bản đồ vệ tinh độ phân giải cao hiển thị icon Mavic 3T di chuyển thời gian thực kèm góc xoay mũi tên và vệt bay (flight trail).
3. **Cột phải**: Màn hình xem Camera trực tiếp (Livestream) + Thông số bay thời gian thực (Độ cao, Pin, Vận tốc, Góc Yaw) + Kho ảnh chụp kiểm tra (ảnh nhiệt phát hiện điểm quá nhiệt Hotspot).

---

## V. HƯỚNG DẪN TÍCH HỢP VÀO PHẦN MỀM C# WINFORMS CỦA BẠN

Để đưa dữ liệu trực tiếp vào phần mềm C# WinForms (như form `frmMonitoringDashboard.cs` của bạn):

1. **Cài đặt thư viện**: Sử dụng NuGet Package `MQTTnet`.
2. **Kết nối vào MQTT Broker**:
   ```csharp
   var factory = new MqttFactory();
   var mqttClient = factory.CreateMqttClient();
   var options = new MqttClientOptionsBuilder()
       .WithTcpServer("127.0.0.1", 1883)
       .WithClientId("CSharp_Monitoring_App")
       .Build();

   await mqttClient.ConnectAsync(options);
   ```
3. **Lắng nghe tọa độ OSD của Mavic 3T**:
   ```csharp
   await mqttClient.SubscribeAsync("thing/product/+/osd");

   mqttClient.ApplicationMessageReceivedAsync += e =>
   {
       string topic = e.ApplicationMessage.Topic;
       string payload = Encoding.UTF8.GetString(e.ApplicationMessage.PayloadSegment);
       
       // Parse JSON lấy: latitude, longitude, height, battery, yaw...
       // Cập nhật vị trí lên Bản đồ GMap.NET hoặc WebView
       return Task.CompletedTask;
   };
   ```
