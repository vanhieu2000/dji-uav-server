# Giao tiếp UAV Server ↔ đội Vision, bản 2.0

Ngày 26/10/2026. Đây là contract triển khai theo bản nháp trong plan; **chưa có bằng chứng đội Vision đã triển khai hoặc xác nhận chất lượng mô hình**. Server không chọn/train mô hình. Fixture chứng minh giao thức và DB, không chứng minh phát hiện lỗi trên ảnh M3T.

## Bật dịch vụ

Mặc định `VISION_ENABLED=false`, không gửi dữ liệu ra ngoài. Khi có dịch vụ thật, cấu hình an toàn ngoài Git:

- `VISION_ENDPOINT`: HTTPS endpoint nhận job (ví dụ `https://vision.example.com/jobs`). Chỉ HTTP loopback được phép cho dev.
- `VISION_PUBLIC_BASE_URL`: HTTPS gốc UAV server mà Vision truy cập được; không có dấu `/` cuối.
- `VISION_API_TOKEN`: nếu dịch vụ nhận job yêu cầu Bearer token.
- `VISION_WEBHOOK_SECRET`: shared secret riêng cho callback. Không đưa giá trị vào chat/log/commit. Không dùng cùng khóa JWT.
- `VISION_ENABLED=true`: sau khi cấu hình hợp lệ; restart server. Worker chỉ khởi động sau migration/kết nối DB thành công.

Đường HTTP nội bộ chưa được cho phép qua URL ngoài loopback; triển khai proxy HTTPS đúng CA thay vì tắt kiểm tra TLS. Không bật worker vào endpoint chưa được đội Vision cung cấp. Không có AI container/model giả để làm test trông như production.

## Job request

POST tới VISION_ENDPOINT, JSON, header `Idempotency-Key: <job_id>`, Bearer VISION_API_TOKEN nếu có. Một job cho một ảnh; cùng media/hash không tạo hai job. Ảnh RGB/IR ghép cặp qua manifest export hiện có; phiên bản này không tự ghép hai job thành một ảnh đăng ký hình học.

```json
{
  "contract_version": "2.0",
  "job_id": "3cf6fe0b-07fa-4186-a968-c93c9aeb5126",
  "media_id": 123,
  "input_sha256": "<sha256-64-hex>",
  "callback_url": "https://uav.example.com/api/vision/results",
  "input": {
    "url": "<link-ảnh-có-chữ-ký-hết-hạn-sau-10-phút>",
    "width": 640,
    "height": 512,
    "bytes": 1200000,
    "verification": "JPEG_HEADER_AND_SHA256",
    "lens": "IR",
    "source": "CLOUD",
    "captured_at": "2026-10-26T03:15:30.000Z",
    "ticket_id": 12,
    "rtk_flag": 50,
    "position_quality": "HIGH",
    "thermal_engine": null
  }
}
```

Kích thước/giờ/lens trong ví dụ chỉ minh họa schema, không phải số liệu của khách hàng. Validation server đọc SOI/EOI/SOF và SHA256; **không thay thế decoder JPEG hoàn chỉnh, xác thực xuất xứ R-JPEG hay kiểm định radiometric**. Đội Vision phải kiểm tra decode và trả FAILED khi ảnh hỏng/không hỗ trợ. Không gửi snapshot MANUAL; không tự coi thermal_engine/fallback là số nhiệt đã được kiểm chứng. Link ảnh chỉ đọc đúng job/hash, sống 10 phút, không cache; callback secret không nằm trong link. Khi worker gửi lại cùng job, URL có thể đổi nhưng ảnh/hash không đổi.

## Callback

POST `/api/vision/results`; header `Authorization: Bearer <VISION_WEBHOOK_SECRET>`. Không gửi khóa trong JSON hoặc query. Nếu chưa cấu hình server trả 503; sai key trả 401.

```json
{
  "contract_version": "2.0",
  "job_id": "3cf6fe0b-07fa-4186-a968-c93c9aeb5126",
  "media_id": 123,
  "input_sha256": "<sha256-64-hex>",
  "result_version": 1,
  "model_version": "<mô-hình-và-phiên-bản-do-đội-Vision-cung-cấp>",
  "status": "SUCCEEDED",
  "detections": [{
    "defect_type": "HOTSPOT_CELL",
    "confidence": 0.93,
    "image": "thermal",
    "image_width": 640,
    "image_height": 512,
    "bbox": [100, 120, 30, 40],
    "max_temp_c": null,
    "mean_temp_c": null,
    "ref_temp_c": null,
    "delta_t_c": null
  }]
}
```

BBox `[x,y,w,h]` pixel gốc chưa xoay/resize, gốc trái trên. Kích thước phải khớp file, `image=thermal` chỉ với lens IR, `rgb` cho WIDE/ZOOM. Confidence 0..1. Nhiệt chưa đo = null, không mặc định 0 hoặc 65 °C. FAILED dùng detections=[] và `error` ngắn, không chứa bí mật/đường dẫn khách hàng.

Danh mục lỗi theo plan: HOTSPOT_CELL, HOTSPOT_MULTI_CELL, BYPASS_DIODE, MODULE_HOT, STRING_OFFLINE, PID, JUNCTION_BOX_HOT; CRACKED_GLASS, PHYSICAL_DAMAGE, SOILING, BIRD_DROPPING, SHADING, VEGETATION, DELAMINATION, MISSING_MODULE; DCL_CONTACT_OVERHEAT, DCL_PHASE_IMBALANCE, DCL_NOT_FULLY_CLOSED, INSULATOR_DAMAGE, CORROSION, FOREIGN_OBJECT; OTHER. Mã cũ HOTSPOT_PANEL/CRACKED_CELL/DIRT_DUST/DISCONNECTOR_OVERHEAT/CONTACT_DEFECT vẫn được nhận. `defect_code` giữ mã chuẩn mới, `defect_type` ánh xạ nhóm tương thích enum cũ.

Cùng job/result_version và nội dung chuẩn hóa giống nhau → 200 duplicate=true, không ghi trùng. Cùng version khác nội dung hoặc version thấp hơn → 409. Version lớn hơn thay toàn bộ kết quả thành công trong transaction (không sửa lịch sử kết quả của job khác). FAILED ghi trạng thái lỗi và giữ các phát hiện thành công gần nhất; không xóa kết quả đo vì timeout/lỗi mô hình. Kết quả SUCCEEDED rỗng xóa phát hiện của job, reset hotspot và trạng thái pin tương ứng khi không còn phát hiện được xác nhận. Có audit xác nhận tài sản lưu riêng.

Webhook cũ `/api/ai/webhook/vision-result` trả **410**, không nhận ghi vô danh như trước. Đội Vision cần chuyển endpoint/schema, không tự giả sử API v1 vẫn tương thích.

## Độ bền và vận hành

Migration 008 additive tạo vision_jobs/rules/reviews và thêm cột detections; backup trước nâng cấp DB nhà máy. Worker quét media chưa có job → QUEUED hoặc INVALID. SENDING có lease 5 phút, DISPATCHED chờ callback 10 phút; lease hết hạn → RETRY_WAIT, tối đa 5 lần gửi. Backoff 30, 60, 120… tối đa 3.600 giây. POST có thể đã tới Vision dù timeout: Vision **phải idempotent theo job_id**, không tạo tác vụ kép. Không suy timeout thành đã xử lý thất bại chắc chắn.

Callback có thể tới trước response POST; update có điều kiện không ghi đè SUCCEEDED. Job tồn tại qua restart; không dùng hàng đợi memory. Retry thủ công cần JWT ADMIN, chỉ job FAILED/INVALID và ảnh vẫn khớp hash. Job/signed input read không ghi token vào access log.

API vận hành:

- `GET /api/vision/jobs?ticket_id=`, `GET /jobs/:id`: theo dõi job, lỗi, detections.
- `GET /api/vision/media`: danh sách ảnh có hash, không phải snapshot MANUAL.
- `POST /api/vision/jobs` body `{media_id}` và `POST /jobs/:id/retry`: cần JWT ADMIN.
- `GET /api/vision/rules`, `PUT /rules/PANEL|DISCONNECTOR|CONTACT|OTHER`: ngưỡng max_temp_c/delta_t_c nullable, min_confidence 0..1, enabled boolean. Ghi cần JWT ADMIN. Không seed 65 °C; chưa có rule bật thì không tự sinh cảnh báo nhiệt. Có rule: đạt confidence → WARNING, vượt ngưỡng → CRITICAL. Đây là đánh giá sau Vision, không phải nhiệt MQTT dưới 1 giây.

Dashboard: Cài đặt tài sản → Xử lý Vision: hàng đợi, trạng thái, khung lỗi trên ảnh gốc, tìm/xác nhận tài sản và ngưỡng. Token dashboard `uav_token` được gửi qua GIS.api; màn đăng nhập đầy đủ thuộc giai đoạn E. Không mở public trước phân quyền workspace/TLS/stream ACL giai đoạn E/I.

## Định vị và tài sản

`PUT /api/vision/jobs/:id/projection` trước khi có kết quả, JWT ADMIN: `{confirmed:true,lens:"IR",agl_m:30,hfov_deg:...,vfov_deg:...,image_width:640,image_height:512}`. AGL phải được xác nhận tại mục tiêu, **không tự lấy RelativeAltitude theo điểm cất cánh**. Chỉ chiếu khi RTK FIX, gimbal gần nadir (±0,2°), roll gần 0, đúng lens/kích thước. Không hỗ trợ camera xiên, địa hình hoặc zoom chưa hiệu chuẩn: để UNRESOLVED. Tọa độ là PROJECTED_APPROXIMATE, chưa đủ để tự chốt ID tấm pin sát nhau.

Ảnh gắn photo_point chỉ gợi ý PHOTO_POINT_REVIEW_REQUIRED: một ảnh có thể thấy nhiều tài sản. Người có quyền xác nhận từng phát hiện bằng `POST /api/vision/detections/:id/asset`, `{asset_type:"PANEL"|"DISCONNECTOR"|"CONTACT",asset_id,result_version}`. Có khóa/version check và audit người duyệt. Pin được xác nhận có lỗi → DEFECT; không cập nhật DCL bằng nhiệt độ giả. Tự gán chắc chắn từ pixel khi chưa có địa hình/calibration và kiểm chứng RTK **còn bị chặn bởi dữ liệu thực/PoC**, không đánh dấu đã hoàn tất.

## Kiểm thử đã chạy

Unit contract/projection và SQL thật trên DB test riêng: duplicate job/callback, stale/conflicting version, hash sai, bbox ngoài ảnh, cập nhật rỗng, xác nhận asset/audit, input link đúng/sai, callback tới trong POST, timeout đưa retry, file thiếu INVALID. Input fixture JPEG trắng 16×16 do ffmpeg tạo, không phải ảnh M3T. Chưa đo precision/recall, thời gian GPU hoặc độ chính xác tọa độ thực tế.
