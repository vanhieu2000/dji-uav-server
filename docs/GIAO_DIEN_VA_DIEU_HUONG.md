# Giao diện và điều hướng

Sidebar được chia thành các nhóm có thể mở/đóng. Mục đang xem tự mở nhóm tương ứng. Có thể bấm tên tài khoản ở chân sidebar để vào Cài đặt tài khoản; cạnh tên chỉ còn nút đăng xuất.

| Nhóm | Chức năng |
| --- | --- |
| Tổng quan | Chỉ số tổng hợp, live theo phiếu, biểu đồ kiểm tra gần đây, 5 sự cố mới nhất |
| Bản đồ | Theo dõi pin mặt trời và trạm biến áp |
| Kiểm tra & vận hành | Nhiệm vụ/phân công, phiếu pin và DCL, lập đường bay, lịch sử chuyến bay, UAV và buồng lái |
| Ảnh & phân tích | Nhập ảnh thẻ nhớ, đối chiếu đủ ảnh, xử lý Vision, xuất tập ảnh, tiếp nhận cảnh báo và xem lịch sử nhiệt |
| Danh mục & báo cáo | Nhà máy & thiết bị kiểm tra; Báo cáo & thống kê |
| Cài đặt | Cài đặt chung và Cài đặt tài khoản |

“Nhà máy & thiết bị kiểm tra” là danh mục những đối tượng UAV cần kiểm tra: nhà máy, khu pin, chuỗi pin, tấm pin, trạm biến áp, ngăn lộ, dao cách ly và mối nối. Tại đây có thể sửa thông tin, vị trí, ranh giới và điểm chụp trên bản đồ. Các chức năng xử lý ảnh/đường bay/nhiệm vụ đã có mục riêng, không còn nằm lẫn trong trang này.

Cài đặt chung có các tab Hệ thống, Hồ sơ chụp, Nhập danh mục Excel và Bản đồ nền. Cài đặt tài khoản chứa thông tin tài khoản, đổi mật khẩu và đường dẫn Quản trị người dùng & phân quyền (ADMIN).

Tổng quan chọn kỳ 7/30/90 ngày cho biểu đồ; mặc định 30 ngày. Cột phân chia số phiếu đã hoàn tất và phần còn lại theo **ngày tạo phiếu**, tối đa 14 ngày có phát sinh gần nhất. Biểu đồ tròn thể hiện trạng thái hiện tại của các phiếu tạo trong kỳ. Chỉ số KPI phía trên là số tổng toàn hệ thống, có nhãn phân biệt với thống kê trong kỳ.

Danh sách sự cố nhanh lấy tối đa 5 cảnh báo mới nhất theo thời gian, không chỉ cảnh báo chưa xem. “Xem tất cả” mở Báo cáo ở kỳ Tất cả thời gian và cuộn đến bảng sự cố. Bảng có lọc từ khóa, mức độ, trạng thái và phân trang 20 dòng; mở Nội dung chi tiết để đọc đầy đủ hoặc Xem ảnh nếu có ảnh gắn kèm. Bộ lọc mức độ/từ khóa/trạng thái chỉ áp dụng cho bảng; kỳ thời gian áp dụng cả biểu đồ lẫn bảng.

Live trên Tổng quan dùng cùng một video/player với buồng lái; chuyển màn hình không tạo player trùng. Chọn phiếu, chọn kênh đang phát trên Pilot 2. Không có publisher sẽ hiện trạng thái chờ, không hiển thị dữ liệu bay hay hình ảnh giả.

Sau khi cập nhật mã có thay đổi backend: đóng cửa sổ server cũ, chạy lại CHAY_LOCAL.bat, rồi Ctrl+F5 trình duyệt. Tài khoản và dữ liệu MySQL được giữ nguyên.
