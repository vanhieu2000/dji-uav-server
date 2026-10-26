/**
 * Kiểm tra đủ ảnh (Giai đoạn A4).
 *   GET /api/coverage?area_id=&ticket_id=&lens=ir|wide|zoom[&route_id=]
 *     → % phủ, vùng thiếu (để bay bù), vệt ảnh, vị trí ảnh (chất lượng RTK), số ảnh dự kiến / đã nhận.
 */
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const v = require('../utils/validate');
const { computeCoverage } = require('../services/coverage');
const { outerRing } = require('../services/flightPlanner');

const LENS_DB = { ir: 'IR', wide: 'WIDE', zoom: 'ZOOM' };
const MAX_PHOTOS = 20000;
const MAX_FOOTPRINTS_RETURNED = 3000;
const MARGIN_DEG = 0.0005; // ~55 m quanh khu: ảnh ở mép vẫn phủ vào khu

router.get('/', asyncHandler(async (req, res) => {
    const areaId = v.parseId(req.query.area_id, 'khu pin');
    const ticketId = v.parseId(req.query.ticket_id, 'phiếu kiểm tra');
    const lens = v.oneOf(req.query.lens, ['IR', 'WIDE', 'ZOOM'], 'camera', 'IR').toLowerCase();

    const areas = await query('SELECT area_id, area_code, polygon_geojson FROM solar_areas WHERE area_id = ?', [areaId]);
    if (!areas.length) throw new NotFoundError('Không tìm thấy khu pin');
    if (!areas[0].polygon_geojson) throw new v.ValidationError(`Khu ${areas[0].area_code} chưa vẽ ranh giới`);
    const ring = outerRing(areas[0].polygon_geojson);
    const lats = ring.map(p => p.lat);
    const lngs = ring.map(p => p.lng);

    const photos = await query(
        `SELECT media_id, latitude, longitude, relative_altitude, gimbal_pitch, gimbal_yaw, flight_yaw, position_quality, captured_at
         FROM media_files
         WHERE ticket_id = ? AND lens = ? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
         ORDER BY captured_at LIMIT ${MAX_PHOTOS}`,
        [ticketId, LENS_DB[lens], Math.min(...lats) - MARGIN_DEG, Math.max(...lats) + MARGIN_DEG, Math.min(...lngs) - MARGIN_DEG, Math.max(...lngs) + MARGIN_DEG]
    );
    const [counts] = await query(
        `SELECT COUNT(*) AS total,
                SUM(position_quality = 'HIGH') AS rtk_fix,
                SUM(position_quality = 'LOW') AS rtk_low,
                SUM(position_quality = 'UNKNOWN') AS no_position
         FROM media_files WHERE ticket_id = ? AND lens = ?`,
        [ticketId, LENS_DB[lens]]
    );

    // Số ảnh dự kiến: tuyến được chọn, hoặc tuyến quét lưới mới nhất của khu
    let expected = null;
    const routeRows = req.query.route_id
        ? await query('SELECT route_id, route_name, photo_count FROM flight_routes WHERE route_id = ?', [v.parseId(req.query.route_id, 'đường bay')])
        : await query("SELECT route_id, route_name, photo_count FROM flight_routes WHERE area_id = ? AND route_kind = 'GRID' ORDER BY route_id DESC LIMIT 1", [areaId]);
    if (routeRows.length) expected = { route_id: routeRows[0].route_id, route_name: routeRows[0].route_name, photo_count: routeRows[0].photo_count };

    const cov = computeCoverage({ polygon: areas[0].polygon_geojson, photos, lens });
    ok(res, {
        area: { area_id: areaId, area_code: areas[0].area_code },
        lens,
        ...cov,
        footprints: cov.footprints.slice(0, MAX_FOOTPRINTS_RETURNED),
        photos_in_area: photos.length,
        ticket_photos: {
            total: Number(counts.total) || 0,
            rtk_fix: Number(counts.rtk_fix) || 0,
            rtk_low: Number(counts.rtk_low) || 0,
            no_position: Number(counts.no_position) || 0
        },
        expected,
        points: photos.map(p => ({ id: p.media_id, lat: p.latitude, lng: p.longitude, q: p.position_quality }))
    });
}));

module.exports = router;
