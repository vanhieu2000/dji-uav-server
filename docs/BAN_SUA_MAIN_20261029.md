# Bản sửa main ngày 29/10/2026

## Phạm vi

Mavic 3T + RC/Pilot 2 + module RTK, chạy native Windows/MySQL và Wi-Fi LAN. Không dùng Dock. Đây là bản sửa hiện tại để đối chiếu với nhánh thiết kế lại mà chủ dự án đang thực hiện riêng theo PDF/Excel; không coi đây là lần thiết kế lại cuối cùng.

## Sửa lỗi và bổ sung

- Sửa lỗi cú pháp await trong hàm không async làm toàn bộ script Dashboard không chạy; sửa hàm kênh phiếu thiếu export và hằng chưa khai báo.
- Dọn các tham chiếu player không tồn tại, xử lý placeholder thiếu phần tử; tự chọn đúng stream có publisher, dùng URL FLV được cấp quyền; điều hướng vẫn hoạt động khi API nghiệp vụ trả503.
- Pilot không còn chọn phiếu. Đăng nhập tạo Gateway độc lập; báo MQTT thành công chỉ sau broker xác nhận, cấu hình Media/mission lỗi không được coi là MQTT lỗi.
- Trả credentials MQTT đúng phiên, kiểm tra mật khẩu/phiên và ACL; không cho đăng nhập broker với mọi username/password như bản main trước. Giữ thứ tự freshThing từ bản từng dùng ổn định và không gọi getter native gây lỗi615011.
- Cấu hình ws/mission độc lập sau xác nhận MQTT; native WS xác thực token ở endpoint /ws. Gateway có thể tải thư viện KMZ bằng signed URL và xin STS mà không có phiếu.
- Giữ nguyên deviceCommands.js và chuỗi payload điều khiển đang có trên main. deviceControl chỉ bổ sung chính sách Gateway, kiểm tra nguồn video đầu vào và trả trạng thái publisher theo bằng chứng thật. Đồng bộ trạng thái quyền từ RC cho cache UAV để không giữ quyền cũ.
- Thư viện đường bay tạo độc lập trước. Phiếu chọn một hoặc nhiều tuyến đã lưu; không bắt buộc tạo tuyến mới cho mỗi phiếu. Các menu phiếu gom về Phiếu kiểm tra & Lịch bay.
- Phiếu có chu kỳ ngày/tuần/tháng/đột xuất, nhóm đối tượng, RC và kỹ sư; Dashboard có bảng phiếu ngày Việt Nam và nút live. Chu kỳ hiện là thuộc tính quản lý, chưa tự sinh hàng loạt phiếu lặp vô hạn.
- Waypoint click/kéo, chỉnh riêng độ cao/tốc độ/gimbal/lens/thời gian dừng; marker cảnh báo ngoài vùng. KMZ giữ thông số từng điểm. Tạo và kiểm tra tuyến dùng chung pipeline; chặn API Dock flighttask_prepare.
- Geofence lấy polygon do người vận hành khai báo. Kiểm tra cả điểm và đoạn nối với ranh giới, polygon lõm, lỗ và vùng cấm tại backend. Không tự tạo ranh giới từ số51,27ha; không tuyên bố đó là GEO Zone DJI.
- Web có xác nhận thủ công tuyến đã chọn trên Pilot và gắn phiên vào phiếu. Không gán đồng thời hai phiên trên cùng UAV; không đổi phân công khi chuyến chưa đóng; lưu snapshot tuyến/MD5; không xóa tuyến đang phân công.
- Khi người vận hành báo sai tuyến, khóa tự gán cả ingest và job ghép ảnh về sau. Ảnh vẫn lưu thật vào kho chưa gán. Chưa có bằng chứng giao thức để xác minh tuyến Pilot tự động.
- Đối soát vị trí chụp so waypoint có suffix MAP_n, đúng execution và RTK50: <=1,5m Đạt, >1,5m Cảnh báo. Không đủ dữ liệu để Chưa xác định. Đây là vị trí camera, không phải phép định vị tấm pin trong ảnh nghiêng.
- Đổi nhãn bản đồ nền Esri về đúng nhà cung cấp, không gọi lớp ảnh Esri là bản đồ DJI.
- Migration017 bổ sung trường/bảng và cho phép stream chưa gán phiếu, không xóa database/ảnh thật. Kho ảnh native có thể lưu ảnh chưa gán và callback lặp không thay đổi phiếu lịch sử.
- Sửa môi trường CI MySQL xác thực, pin Ubuntu24.04 và tài khoản test riêng; không dùng mật khẩu DB máy người dùng trong CI.

## Cách chạy bản ZIP trên Windows

1. Dừng cửa sổ server cũ. Giữ một bản sao thư mục hiện tại và sao lưu database trước khi nâng cấp.
2. Giải nén bản mới vào thư mục riêng. Không xóa database MySQL.
3. Nếu đã cài: dùng lại .env; nếu .env tham chiếu file mật khẩu hoặc khóa trong backend/data, giữ cả các file đó và các thư mục dữ liệu vận hành. Không đưa chúng lên Git. Giữ đúng MEDIA_DIR/LOCAL_STORAGE_DIR/WAYLINE_DIR hoặc chuyển dữ liệu sang vị trí tương ứng để không mất đường dẫn ảnh và KMZ. Thư mục ảnh mặc định là backend/uploads/media.
4. Bấm CHAY_WIFI.bat. Launcher tự cài thư viện khi cần, chạy migration bổ sung và in địa chỉ LAN/cổng thực tế. Không mở cùng lúc hai server dùng chung database để thử các phiên khác nhau.
5. Máy tính và RC cùng mạng LAN; mở URL Pilot được launcher in trên tay cầm. Không dùng localhost trên RC. Dùng tài khoản đã có; bản ZIP không chứa mật khẩu riêng của người dùng.
6. Nếu cấu hình kho ảnh cũ chưa chuyển sang native: dừng server, bấm CAI_DAT_KHO_ANH.bat rồi chạy lại CHAY_WIFI.bat. Script sao lưu .env và giữ thư mục MEDIA_DIR đang cấu hình.
7. Trên Web, tạo/kiểm tra ranh giới thật trong Lập đường bay, tạo tuyến mẫu và gán tuyến vào phiếu. Trên Pilot, mở thư viện đường bay để tải và chọn tuyến. Trên Web mở phiếu, xác nhận tuyến và gắn phiên. Việc này không phát lệnh cất cánh.
8. Kết thúc phân công sau khi hạ cánh/chuyến đã đóng. Ảnh chưa đủ ngữ cảnh nằm trong mục chưa gán, không bị xóa.
9. Nếu có lỗi RC thật: bấm XUAT_LOG.bat hoặc xuất chẩn đoán trên Web và gửi ZIP. Không gửi .env hoặc mật khẩu.

## Những phần vẫn cần RC thật hoặc nhánh thiết kế lại

Không xác nhận đã nghiệm thu kết nối/lens/live/Media trên RC thật trong môi trường cloud. Không có tự cất cánh kiểu Dock, không có xác minh MD5 đường bay thực thi tự động nếu Pilot không cung cấp bằng chứng, không tự coi waypoint progress là đã chụp, không dựng nhiệt độ từ video màu. Không có lớp DJI GEO Zone được cấp quyền, không có terrain following/DTM mới, không xác nhận đủ tọa độ toàn bộ tài sản thực địa. API Vision và báo cáo đang có được giữ lại; thiết kế lại theo PDF/Excel sẽ được đối chiếu trên nhánh do chủ dự án gửi sau.

Các kiểm thử phần mềm dùng MySQL cách ly dji_uav_test, telemetry/ảnh fixture chỉ nằm trong test; không seed dữ liệu giả vào database vận hành.

## Kết quả kiểm tra trước bàn giao

- Backend:104/104 đạt,0bỏ qua, chạy vớiMySQL cách ly; có server thật, MQTT thật qua loopback và bộ phát/ảnh fixture trong test.
- Trình duyệt Chromium: khởi động, điều hướng bằng nút thật khiAPI503, nhậnpublisher và tự chọnstream, desktop/mobile, luồngphiếu/waypoint, đăngnhập vàPilotBridge đềuđạt.
- Giao diện mobile390px và đăngnhập1440/768/390/320px đã kiểm tra.
- npm audit --omit=dev:0lỗhổng được công cụbáo tại thờiđiểmchạy.
- deviceCommands.js không thay đổi so với main b42fe0f.
- Chưa coi đây là nghiệm thu RC thật hoặc kết quảGitHubActions sau push.
