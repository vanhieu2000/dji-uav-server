# Font và chữ tiếng Việt

Các trang dùng font Be Vietnam Pro có đủ dấu tiếng Việt, phục vụ trực tiếp từ `backend/public/dashboard/assets/fonts/`. Không cần tải font từ Google/CDN. Font giữ nguyên bản gốc, có giấy phép OFL và checksum trong thư mục đó. Offline shell mobile v4 giữ cả font.

Chữ như `NhÃ `, `Máº·t` là dữ liệu bị giải mã sai trước khi lưu vào MySQL, không phải thiếu font. Đổi font không khôi phục được nội dung này.

Nếu DB cũ có chữ hỏng:

1. Lấy bản mã mới, chạy `CHAY_LOCAL.bat` để chuẩn bị môi trường nếu chưa làm.
2. Bấm `SUA_LOI_TIENG_VIET.bat` một lần. Công cụ tự lưu bản sao trước khi cập nhật, chỉ sửa trường văn bản mô tả/tên có thể khôi phục chắc chắn. Không sửa mật khẩu, mã thiết bị, URL, đường dẫn hoặc nhật ký lịch sử.
3. Xem kết quả `applied`, `unresolved` và `backup_file`. Nhấn Ctrl+F5 khi mở lại Web.

Có thể kiểm tra trước, không ghi dữ liệu:

```sh
cd backend
node scripts/repair-vietnamese.js
```

Thực hiện sửa có sao lưu:

```sh
node scripts/repair-vietnamese.js --apply
```

Bản sao riêng nằm trong `backend/data/vietnamese-backup-*.json`, chứa khóa dòng/cột và nội dung trước/sau; không đưa vào Git. Cập nhật chạy trong transaction và so khớp nguyên văn dữ liệu cũ. Nếu có thay đổi đồng thời, toàn bộ lượt cập nhật được rollback. Công cụ không ghi đè bản sao đã có. Chuỗi bị mất ký tự thành `�`, hoặc không thể chuyển đổi an toàn, được giữ nguyên và liệt kê để đối chiếu với nguồn gốc.

Các SQL khởi tạo đã có `SET NAMES utf8mb4`; kết nối ứng dụng/migration cũng khai báo charset. Khi nhập SQL thủ công, dùng client UTF-8:

```sh
mysql --default-character-set=utf8mb4 -u root -p dji_uav_management < file.sql
```

Không chạy lại schema có DROP trên DB hiện hữu để sửa chữ. Không nạp lại seed để sửa tên vì có thể đè dữ liệu nghiệp vụ.
