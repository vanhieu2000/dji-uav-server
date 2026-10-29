/**
 * Lập đường bay từ khu / tài sản + hồ sơ chụp (Giai đoạn A2).
 *   POST   /api/flight-plans/preview   tính thử (không lưu): đường đi, số ảnh, thời gian, cảnh báo
 *   POST   /api/flight-plans           tạo file KMZ + lưu flight_routes
 *   GET    /api/flight-plans           danh sách
 *   GET    /api/flight-plans/:id       chi tiết (kèm đường đi để vẽ lại)
 *   GET    /api/flight-plans/:id/kmz   tải file KMZ
 *   DELETE /api/flight-plans/:id
 * Body preview/tạo:
 *   { profile_id, area_id }                       hồ sơ kiểu GRID: quét lưới khu pin
 *   { profile_id, targets: [{asset_type, asset_id}] }  hồ sơ kiểu POINTS: các điểm chụp ảnh của tài sản
 *                                                   (chọn ngăn lộ / DCL thì gồm luôn DCL / mối nối bên trong)
 * File KMZ lưu trong uploads/waylines nên DJI Pilot 2 thấy ngay trong thư viện đường bay.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const v = require('../utils/validate');
const { deriveGeometry } = require('../services/captureMath');
const { gridPlan, pointsPlan } = require('../services/flightPlanner');
const { buildGridKmz, buildPointsKmz } = require('../services/wpmlBuilder');
const { ASSET_TABLES } = require('../services/photoPoints');
const ticketRoutes = require('../services/ticketRoutes');

const WAYLINE_DIR = process.env.WAYLINE_DIR || path.join(__dirname, '..', '..', 'uploads', 'waylines');
const MAX_POINTS = 500;

async function loadProfile(id) {
    const rows = await query('SELECT * FROM capture_profiles WHERE profile_id = ?', [v.parseId(id, 'hồ sơ chụp')]);
    if (!rows.length) throw new NotFoundError('Không tìm thấy hồ sơ chụp');
    return rows[0];
}

/**
 * Quét lưới một khu. polygonRaw (tùy chọn): vùng con trong khu (VD vùng thiếu ảnh cần bay bù);
 * hướng bay vẫn lấy theo dãy pin của khu.
 */
async function planGrid(profile, areaIdRaw, polygonRaw) {
    const areaId = v.parseId(areaIdRaw, 'khu pin');
    const areas = await query('SELECT area_id, area_code, area_name, polygon_geojson FROM solar_areas WHERE area_id = ?', [areaId]);
    if (!areas.length) throw new NotFoundError('Không tìm thấy khu pin');
    const area = { ...areas[0] };
    const sub = v.optionalPolygonGeoJson(polygonRaw, 'vùng bay bù');
    if (sub) area.polygon_geojson = sub;
    if (!area.polygon_geojson) throw new v.ValidationError(`Khu ${area.area_code} chưa vẽ ranh giới. Vẽ ở Cài đặt tài sản trước.`);
    const strings = await query('SELECT line_geojson FROM solar_strings WHERE area_id = ? AND line_geojson IS NOT NULL', [areaId]);
    const geometry = deriveGeometry(profile);
    let plan;
    try {
        plan = gridPlan({
            polygon: area.polygon_geojson,
            lineSpacingM: geometry.line_spacing_m,
            triggerDistanceM: geometry.trigger_distance_m,
            speedMps: geometry.max_speed_mps,
            marginM: 0,
            headingMode: profile.heading_mode,
            headingDeg: profile.heading_deg,
            rowLines: strings.map(s => { try { return JSON.parse(s.line_geojson); } catch (e) { return null; } })
        });
    } catch (e) {
        throw new v.ValidationError(e.message);
    }
    const path_ = { type: 'LineString', coordinates: plan.waypoints.map(p => [p.lng, p.lat]) };
    return {
        kind: 'GRID', area, geometry, plan,
        stats: plan.stats,
        warnings: [...geometry.warnings, ...plan.warnings],
        geojson: { path: path_, points: [] }
    };
}

/** Quét lưới theo ranh giới nhà máy (VD quét bản đồ 2D khi chưa vẽ khu nào). */
async function planPlant(profile, plantIdRaw) {
    const plantId = v.parseId(plantIdRaw, 'nhà máy');
    const rows = await query('SELECT plant_id, plant_code, boundary_geojson FROM plants WHERE plant_id = ?', [plantId]);
    if (!rows.length) throw new NotFoundError('Không tìm thấy nhà máy');
    if (!rows[0].boundary_geojson) throw new v.ValidationError('Nhà máy chưa vẽ ranh giới. Vẽ ở Cây tài sản → chọn nhà máy → Vẽ ranh giới.');
    const geometry = deriveGeometry(profile);
    let plan;
    try {
        plan = gridPlan({
            polygon: rows[0].boundary_geojson, lineSpacingM: geometry.line_spacing_m, triggerDistanceM: geometry.trigger_distance_m,
            speedMps: geometry.max_speed_mps, marginM: 0,
            headingMode: profile.heading_mode === 'FIXED' ? 'FIXED' : 'AUTO', headingDeg: profile.heading_deg
        });
    } catch (e) {
        throw new v.ValidationError(e.message);
    }
    return {
        kind: 'GRID', area: { area_id: null, area_code: rows[0].plant_code }, geometry, plan, stats: plan.stats,
        warnings: [...geometry.warnings, ...plan.warnings],
        geojson: { path: { type: 'LineString', coordinates: plan.waypoints.map(p => [p.lng, p.lat]) }, points: [] }
    };
}

/** Mở rộng tài sản đã chọn thành danh sách (loại, id) gồm cả tài sản con có điểm chụp. */
async function expandTargets(targets) {
    if (!Array.isArray(targets) || !targets.length) throw new v.ValidationError('Chọn ít nhất 1 tài sản có điểm chụp ảnh');
    const out = new Map();
    const add = (t, id) => out.set(`${t}:${id}`, { asset_type: t, asset_id: Number(id) });
    for (const raw of targets) {
        const type = v.oneOf(raw && raw.asset_type, Object.keys(ASSET_TABLES), 'loại tài sản');
        const id = v.parseId(raw.asset_id, 'tài sản');
        add(type, id);
        if (type === 'BAY') {
            const dcls = await query('SELECT disconnector_id FROM disconnectors WHERE bay_id = ?', [id]);
            dcls.forEach(d => add('DISCONNECTOR', d.disconnector_id));
            const cs = await query('SELECT c.contact_id FROM dcl_contacts c JOIN disconnectors d ON c.disconnector_id = d.disconnector_id WHERE d.bay_id = ?', [id]);
            cs.forEach(c => add('DCL_CONTACT', c.contact_id));
        }
        if (type === 'DISCONNECTOR') {
            const cs = await query('SELECT contact_id FROM dcl_contacts WHERE disconnector_id = ?', [id]);
            cs.forEach(c => add('DCL_CONTACT', c.contact_id));
        }
    }
    return [...out.values()];
}

async function planPoints(profile, targets) {
    const expanded = await expandTargets(targets);
    const where = expanded.map(() => '(asset_type = ? AND asset_id = ?)').join(' OR ');
    const rows = await query(
        `SELECT * FROM photo_points WHERE ${where} ORDER BY asset_type, asset_id, sort_order LIMIT ${MAX_POINTS + 1}`,
        expanded.flatMap(t => [t.asset_type, t.asset_id])
    );
    if (rows.length > MAX_POINTS) throw new v.ValidationError(`Quá ${MAX_POINTS} điểm chụp trên 1 tuyến, hãy chia nhỏ`);
    if (rows.length < 2) throw new v.ValidationError('Tuyến điểm cần ít nhất 2 điểm chụp ảnh. Thêm điểm trong Nhà máy & thiết bị kiểm tra hoặc chuyển sang Chọn trực tiếp trên bản đồ.');
    const points = rows.map(r => ({
        lat: r.latitude, lng: r.longitude, altitude_m: r.altitude_m, gimbal_pitch: r.gimbal_pitch,
        aircraft_heading: r.aircraft_heading, zoom_factor: r.zoom_factor, hover_seconds: r.hover_seconds,
        point_id: r.point_id, asset_type: r.asset_type, asset_id: r.asset_id,
        label: `${r.asset_type === 'DCL_CONTACT' ? 'C' : r.asset_type === 'DISCONNECTOR' ? 'D' : 'P'}${r.asset_id}_${r.point_id}`
    }));
    let plan;
    try {
        plan = pointsPlan(points, { speedMps: profile.speed_mps, hoverSeconds: profile.hover_seconds, photosPerPoint: profile.photos_per_point });
    } catch (e) {
        throw new v.ValidationError(e.message);
    }
    const warnings = [...plan.warnings];
    const lowPts = plan.points.filter(p => p.altitude_m < 5);
    if (lowPts.length) warnings.push(`${lowPts.length} điểm chụp thấp dưới 5 m: kiểm tra vật cản (dây, thiết bị trạm)`);
    return {
        kind: 'POINTS', targets: expanded, plan,
        geometry: { max_speed_mps: Number(profile.speed_mps) },
        stats: plan.stats,
        warnings,
        geojson: {
            path: { type: 'LineString', coordinates: plan.points.map(p => [p.lng, p.lat]) },
            points: plan.points.map(p => ({ lat: p.lat, lng: p.lng, label: p.label, altitude_m: p.altitude_m }))
        }
    };
}

function planManualPoints(profile,raw){
 if(!Array.isArray(raw)||raw.length<2||raw.length>MAX_POINTS)throw new v.ValidationError(`Chọn từ 2 đến ${MAX_POINTS} điểm trên bản đồ rồi xem trước.`);
 const points=raw.map((p,i)=>{if(!p||typeof p!=='object'||Array.isArray(p))throw new v.ValidationError('Điểm chụp không hợp lệ');return {lat:v.requiredNumber(p.lat,'vĩ độ',{min:-90,max:90}),lng:v.requiredNumber(p.lng,'kinh độ',{min:-180,max:180}),altitude_m:v.requiredNumber(p.altitude_m,'độ cao so với điểm cất cánh',{min:2,max:500}),gimbal_pitch:v.requiredNumber(p.gimbal_pitch,'góc camera',{min:-90,max:35}),aircraft_heading:v.optionalNumber(p.aircraft_heading,'hướng máy bay',{min:-180,max:180}),hover_seconds:v.requiredNumber(p.hover_seconds,'thời gian dừng',{min:0,max:120}),speed_mps:v.requiredNumber(p.speed_mps??profile.speed_mps,'tốc độ',{min:0.1,max:15}),lenses:(()=>{const xs=String(p.lenses||profile.lenses).split(',');if(!xs.length||xs.length>3||xs.some(x=>!['wide','ir','zoom'].includes(x)))throw new v.ValidationError('Ống kính không hợp lệ');return [...new Set(xs)].join(',');})(),label:'MAP_'+(i+1)};});
 const plan=pointsPlan(points,{speedMps:profile.speed_mps,hoverSeconds:profile.hover_seconds,photosPerPoint:profile.photos_per_point,preserveOrder:true});
 return {kind:'POINTS',targets:[],plan,geometry:{max_speed_mps:Number(profile.speed_mps)},stats:plan.stats,warnings:[...plan.warnings,'Điểm chọn trên bản đồ giữ đúng thứ tự. Kiểm tra tọa độ, độ cao so với điểm cất cánh và vật cản trên Pilot 2 trước khi bay.'],geojson:{path:{type:'LineString',coordinates:points.map(p=>[p.lng,p.lat])},points:points.map(p=>({...p}))}};
}

async function buildPlan(body) {
    const profile = body?.profile_id ? await loadProfile(body.profile_id) : {profile_id:null,route_kind:'POINTS',speed_mps:3,lenses:'wide,ir',gimbal_pitch:-90,hover_seconds:1,photos_per_point:1};
    const result = profile.route_kind === 'GRID'
        ? (v.isBlank(body.plant_id) ? await planGrid(profile, body.area_id, body.polygon) : await planPlant(profile, body.plant_id))
        : (body.points!==undefined?planManualPoints(profile,body.points):await planPoints(profile, body.targets));
    let safetyPlant=body.plant_id;
    if(!safetyPlant&&body.area_id){const [a]=await query('SELECT plant_id FROM solar_areas WHERE area_id=?',[body.area_id]);safetyPlant=a?.plant_id;}
    if(!safetyPlant&&result.targets?.length){const t=result.targets[0],sql={BAY:'SELECT s.plant_id FROM substation_bays b JOIN substations s ON s.substation_id=b.substation_id WHERE b.bay_id=?',DISCONNECTOR:'SELECT s.plant_id FROM disconnectors d JOIN substation_bays b ON b.bay_id=d.bay_id JOIN substations s ON s.substation_id=b.substation_id WHERE d.disconnector_id=?',DCL_CONTACT:'SELECT s.plant_id FROM dcl_contacts c JOIN disconnectors d ON d.disconnector_id=c.disconnector_id JOIN substation_bays b ON b.bay_id=d.bay_id JOIN substations s ON s.substation_id=b.substation_id WHERE c.contact_id=?'}[t.asset_type];if(sql){const [a]=await query(sql,[t.asset_id]);safetyPlant=a?.plant_id;}}
    await require('../services/safetyGeofence').validate(query,safetyPlant,result.kind==='GRID'?result.plan.waypoints:result.plan.points);
    result.plant_id=Number(safetyPlant);
    if (profile.time_window_start && profile.time_window_end) {
        result.warnings.push(`Chỉ bay trong khung giờ ${profile.time_window_start.slice(0, 5)}–${profile.time_window_end.slice(0, 5)}`);
    }
    if (profile.min_irradiance_wm2) result.warnings.push(`Bức xạ tối thiểu ${profile.min_irradiance_wm2} W/m² khi bay`);
    if (profile.require_rtk) result.warnings.push('Bắt buộc RTK FIX trước khi cất cánh');
    return { profile, ...result };
}

function publicPlan(r) {
    return {
        kind: r.kind,
        profile: { profile_id: r.profile.profile_id, profile_name: r.profile.profile_name, lenses: r.profile.lenses },
        area: r.area ? { area_id: r.area.area_id, area_code: r.area.area_code } : null,
        targets: r.targets || null,
        geometry: r.geometry,
        heading_deg: r.plan.heading_deg ?? null,
        stats: r.stats,
        warnings: r.warnings,
        geojson: r.geojson
    };
}

router.get('/geofence/:plantId',asyncHandler(async(req,res)=>{
 const id=v.parseId(req.params.plantId,'nhà máy');require('../services/authorization').plant(req.user,id);
 const [p]=await query('SELECT boundary_geojson FROM plants WHERE plant_id=?',[id]);
 ok(res,{boundary:p?.boundary_geojson||null,exclusions:await query('SELECT exclusion_id,polygon_geojson FROM safety_exclusions WHERE plant_id=?',[id])});
}));
router.put('/geofence/:plantId',asyncHandler(async(req,res)=>{
 const access=require('../services/authorization'),id=v.parseId(req.params.plantId,'nhà máy');access.permission(req.user,'assets:write');access.plant(req.user,id);
 const fence=require('../services/safetyGeofence'),boundary=fence.polygon(req.body.boundary),blocked=req.body.exclusions||[];
 if(!Array.isArray(blocked)||blocked.length>30)throw new v.ValidationError('Tối đa 30 vùng cấm');blocked.forEach(fence.polygon);
 await require('../config/db').withTransaction(async conn=>{await conn.execute('UPDATE plants SET boundary_geojson=? WHERE plant_id=?',[JSON.stringify(boundary),id]);await conn.execute('DELETE FROM safety_exclusions WHERE plant_id=?',[id]);for(const g of blocked)await conn.execute('INSERT INTO safety_exclusions (plant_id,polygon_geojson) VALUES (?,?)',[id,JSON.stringify(g)]);});ok(res,{saved:true});
}));

router.post('/preview', asyncHandler(async (req, res) => {
    ok(res, publicPlan(await buildPlan(req.body || {})));
}));

function slug(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
        .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'route';
}

router.post('/', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = v.requiredString(body.route_name, 'tên đường bay', 150);
    const r = await buildPlan(body);
    const kmz = r.kind === 'GRID'
        ? buildGridKmz({ name, plan: r.plan, geometry: r.geometry, profile: r.profile })
        : buildPointsKmz({ name, points: r.plan.points, profile: r.profile, speed: r.geometry.max_speed_mps });

    fs.mkdirSync(WAYLINE_DIR, { recursive: true });
    const fileName = `DJI_Mission_${Date.now()}_${slug(name)}.kmz`;
    const filePath = path.join(WAYLINE_DIR, fileName);
    fs.writeFileSync(filePath, kmz.buffer);
    const md5 = crypto.createHash('md5').update(kmz.buffer).digest('hex');
    const routeType = r.kind === 'GRID' ? 'SOLAR_FARM_MAPPING' : 'SUBSTATION_DISCONNECTOR';
    try {
        const result = await query(
            `INSERT INTO flight_routes (route_name, route_type, kmz_file_name, kmz_file_path, waypoint_count, target_area,
                route_uuid, capture_profile_id, route_kind, area_id, targets_json, plan_json, kmz_md5, altitude_m, photo_count, duration_s, description)
             VALUES (?, ?, ?, ?, ?, ?, UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, routeType, fileName, filePath, kmz.waypointCount, r.area ? r.area.area_code : null,
                r.profile.profile_id, r.kind, r.area ? r.area.area_id : null,
                r.targets ? JSON.stringify(r.targets) : null, JSON.stringify(publicPlan(r)), md5,
                r.geometry.altitude_m ?? null, r.stats.photo_count, r.stats.duration_s, v.optionalString(body.description, 'mô tả', 2000)]
        );
        await query('UPDATE flight_routes SET target_plant_id=? WHERE route_id=?',[r.plant_id,result.insertId]);
        if (!v.isBlank(body.ticket_id)) await ticketRoutes.addRoute(body.ticket_id, result.insertId);
        const rows = await query('SELECT * FROM flight_routes WHERE route_id = ?', [result.insertId]);
        ok(res, toPublic(rows[0]), `Đã tạo đường bay ${kmz.waypointCount} điểm, khoảng ${r.stats.photo_count} ảnh`);
    } catch (err) {
        fs.rm(filePath, { force: true }, () => {});
        throw err;
    }
}));

function toPublic(row) {
    let plan = null;
    try { plan = row.plan_json ? JSON.parse(row.plan_json) : null; } catch (e) { plan = null; }
    const { plan_json: _p, kmz_file_path: _f, ...rest } = row;
    return { ...rest, plan, kmz_url: `/api/flight-plans/${row.route_id}/kmz` };
}

router.get('/', asyncHandler(async (req, res) => {
    const params = [];
    let sql = `SELECT r.route_id, r.route_uuid, r.route_name, r.route_kind, r.area_id, r.target_area, r.capture_profile_id,
                      r.waypoint_count, r.altitude_m, r.photo_count, r.duration_s, r.kmz_file_name, r.created_at,
                      p.profile_name, p.purpose,
                      (SELECT GROUP_CONCAT(CONCAT(t.ticket_id, ':', t.ticket_code) ORDER BY t.ticket_id SEPARATOR ',')
                         FROM ticket_routes tr JOIN inspection_tickets t ON tr.ticket_id = t.ticket_id
                        WHERE tr.route_id = r.route_id) AS tickets_csv
               FROM flight_routes r LEFT JOIN capture_profiles p ON r.capture_profile_id = p.profile_id WHERE 1=1`;
    if (req.query.area_id) { sql += ' AND r.area_id = ?'; params.push(v.parseId(req.query.area_id, 'area_id')); }
    sql += ' ORDER BY r.route_id DESC LIMIT 500';
    ok(res, (await query(sql, params)).map(({ tickets_csv: csv, ...r }) => ({
        ...r,
        tickets: csv ? csv.split(',').map(x => { const i = x.indexOf(':'); return { ticket_id: Number(x.slice(0, i)), ticket_code: x.slice(i + 1) }; }) : [],
        kmz_url: `/api/flight-plans/${r.route_id}/kmz`
    })));
}));

async function loadRoute(id) {
    const rows = await query('SELECT * FROM flight_routes WHERE route_id = ?', [v.parseId(id, 'mã đường bay')]);
    if (!rows.length) throw new NotFoundError('Không tìm thấy đường bay');
    return rows[0];
}

router.get('/:id', asyncHandler(async (req, res) => {
    ok(res, toPublic(await loadRoute(req.params.id)));
}));

router.get('/:id/kmz', asyncHandler(async (req, res) => {
    const row = await loadRoute(req.params.id);
    // Chỉ phục vụ file nằm trong thư mục đường bay (tên file do server đặt)
    const file = path.join(WAYLINE_DIR, path.basename(row.kmz_file_name));
    if (!fs.existsSync(file)) throw new NotFoundError('File KMZ không còn trên máy chủ');
    res.download(file, row.kmz_file_name);
}));

// Gán / bỏ gán đường bay vào phiếu
router.post('/:id/tickets', asyncHandler(async (req, res) => {
    await ticketRoutes.addRoute((req.body || {}).ticket_id, req.params.id);
    ok(res, null, 'Đã gán đường bay vào phiếu');
}));

router.delete('/:id/tickets/:ticketId', asyncHandler(async (req, res) => {
    await ticketRoutes.removeRoute(req.params.ticketId, req.params.id);
    ok(res, null, 'Đã bỏ gán đường bay khỏi phiếu');
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const row = await loadRoute(req.params.id);
    const active=await query('SELECT execution_id FROM ticket_executions WHERE route_id=? AND ended_at IS NULL',[row.route_id]);if(active.length)throw Object.assign(new v.ValidationError('Tuyến đang được phân công; kết thúc phiên trước khi xóa'),{status:409});
    const affectedTickets = await ticketRoutes.ticketsOfRoute(row.route_id);
    await query('DELETE FROM flight_routes WHERE route_id = ?', [row.route_id]);
    for (const t of affectedTickets) await ticketRoutes.syncAssigned(t);
    fs.rm(path.join(WAYLINE_DIR, path.basename(row.kmz_file_name)), { force: true }, () => {});
    ok(res, null, 'Đã xóa đường bay');
}));

module.exports = router;
module.exports.WAYLINE_DIR = WAYLINE_DIR;
