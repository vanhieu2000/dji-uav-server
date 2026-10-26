-- =====================================================================
-- 005: Gán đường bay vào phiếu kiểm tra (Giai đoạn B2)
-- Một phiếu có nhiều tuyến (tuyến chính + tuyến bay bù); một tuyến dùng lại cho nhiều kỳ.
-- inspection_tickets.assigned_route_id giữ lại (= tuyến đầu tiên) cho các báo cáo cũ.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `ticket_routes` (
    `ticket_id` INT NOT NULL,
    `route_id` INT NOT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `assigned_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`ticket_id`, `route_id`),
    INDEX `idx_tr_route` (`route_id`),
    FOREIGN KEY (`ticket_id`) REFERENCES `inspection_tickets`(`ticket_id`) ON DELETE CASCADE,
    FOREIGN KEY (`route_id`) REFERENCES `flight_routes`(`route_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `ticket_routes` (`ticket_id`, `route_id`, `sort_order`)
SELECT `ticket_id`, `assigned_route_id`, 0 FROM `inspection_tickets` WHERE `assigned_route_id` IS NOT NULL;
