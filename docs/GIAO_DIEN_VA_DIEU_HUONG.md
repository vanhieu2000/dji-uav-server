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

Cài đặt chung có các tab Ngưỡng cảnh báo, Hồ sơ chụp, Nhập danh mục Excel và Bản đồ nền. Cài đặt tài khoản chứa thông tin tài khoản, đổi mật khẩu và đường dẫn Quản trị người dùng & phân quyền (ADMIN).

Tổng quan chọn kỳ 7/30/90 ngày cho biểu đồ; mặc định 30 ngày. Cột phân chia số phiếu đã hoàn tất và phần còn lại theo **ngày tạo phiếu**, tối đa 14 ngày có phát sinh gần nhất. Biểu đồ tròn thể hiện trạng thái hiện tại của các phiếu tạo trong kỳ. Chỉ số KPI phía trên là số tổng toàn hệ thống, có nhãn phân biệt với thống kê trong kỳ.

Danh sách sự cố nhanh lấy tối đa 5 cảnh báo mới nhất theo thời gian, không chỉ cảnh báo chưa xem. “Xem tất cả” mở Báo cáo ở kỳ Tất cả thời gian và cuộn đến bảng sự cố. Bảng có lọc từ khóa, mức độ, trạng thái và phân trang 20 dòng; mở Nội dung chi tiết để đọc đầy đủ hoặc Xem ảnh nếu có ảnh gắn kèm. Bộ lọc mức độ/từ khóa/trạng thái chỉ áp dụng cho bảng; kỳ thời gian áp dụng cả biểu đồ lẫn bảng.

Live trên Tổng quan dùng cùng một video/player với buồng lái; chuyển màn hình không tạo player trùng. Chọn phiếu, chọn kênh đang phát trên Pilot 2. Không có publisher sẽ hiện trạng thái chờ, không hiển thị dữ liệu bay hay hình ảnh giả.

Sau khi cập nhật mã có thay đổi backend: đóng cửa sổ server cũ, chạy lại CHAY_LOCAL.bat, rồi Ctrl+F5 trình duyệt. Tài khoản và dữ liệu MySQL được giữ nguyên.

## Bố cục các màn nghiệp vụ

Các màn dùng chung nhãn ở trên ô nhập, khối bộ lọc, bảng danh sách và các khối nhập liệu có viền. Nhiệm vụ và cảnh báo có lọc từ khóa/trạng thái và phân trang 15 dòng. Những bảng lịch sử/danh sách đã tải có ô Tìm trong danh sách và phân trang 20 dòng; chức năng này lọc trên dữ liệu hiện có, kết hợp với bộ lọc máy chủ của từng màn. Cảnh báo quản lý tối đa 500 mục gần nhất; muốn tra toàn bộ dùng Báo cáo.

Tại các màn nhập ảnh/Excel/ZIP, bấm Chọn tệp hoặc Chọn thư mục ảnh. Vùng bên dưới liệt kê tên/dung lượng và xem trước ảnh đọc được trong trình duyệt. Chọn tệp chỉ chuẩn bị dữ liệu trên máy; nút Nhập/Tải lên riêng mới gửi tệp đến server. Preview giới hạn 4 ảnh trên màn hình nhỏ hoặc 12 ảnh trên desktop; toàn bộ tệp được giữ nguyên để xử lý. File không phải ảnh vẫn có danh sách tên/dung lượng; module Excel có bước kiểm tra nội dung riêng.

## Bố cục ưu tiên hiển thị trực tiếp (cập nhật 28/10/2026)

Tên màn hình nằm ở thanh trên, bỏ tiêu đề lớn lặp. Bộ lọc, form, biểu đồ, ảnh xem trước và thông số chuẩn hiển thị ngay trên trang. Không tự chuyển cả khối thành nút chỉ vì trang cao hơn cửa sổ. Màn nhỏ cho phép cuộn trang tự nhiên; không cắt mất nội dung để đạt chỉ số không cuộn.

Lập đường bay: cấu hình nằm bên trái, bản đồ bên phải; hồ sơ và phiếu đặt cạnh nhau, thao tác Xem trước/Tạo KMZ chung hàng. Bảng đường bay bên dưới giữ các cột và thao tác. Trên mobile, cấu hình và bản đồ xếp dọc; bảng có thể cuộn ngang riêng. Chi tiết một bản ghi vẫn có thể mở dialog theo yêu cầu của người dùng.

Lịch sử: mã UAV, phiếu, từ ngày, đến ngày và Lọc nằm cùng một hàng trên desktop; xuống hai cột trên mobile. Bản đồ và bảng danh sách luôn hiển thị. Chọn dòng để xem vết bay/thông tin; nút Chi tiết mở bản ghi và trình phát lại trong dialog, đóng sẽ trả lại chính bản đồ cũ. Bộ lọc không bị đưa vào popup.

Tổng quan và Báo cáo giữ biểu đồ/thống kê/sự cố trực tiếp. Nhiệm vụ giữ form và bộ lọc trực tiếp; Tạo/Sửa đưa tới form hiện hữu, không giấu form sau nút. Ảnh chọn xem trước hiển thị ngay dưới nút chọn tệp.

Sidebar mở từng nhóm. Chỉ khi chiều cao thực sự không đủ, danh mục nhóm mở trong dialog để giữ mọi liên kết có thể truy cập. Dialog bản ghi hỗ trợ Đóng, Escape và chạm nền ngoài. Các kiểm thử kiểm tra cả vị trí/không chồng lấn, thay vì chỉ kiểm tra kích thước viewport.

Chỉ trên màn hình cực thấp (<500px), khối trạng thái/quyền UAV trên bản đồ có disclosure thu gọn để không phủ kín bản đồ. Desktop giữ đầy đủ controls; khối này không áp dụng cho bộ lọc/form ở các trang nghiệp vụ.
