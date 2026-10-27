/**
 * Theo dõi chuyến bay từ OSD (Giai đoạn C1).
 *  - Tự nhận cất cánh / hạ cánh, mở / đóng flight_sessions, gắn phiếu theo phiên Pilot.
 *  - Ghi telemetry tối đa 1 lần/giây (trước đây ghi mọi gói OSD, 2 câu SQL mỗi gói).
 *  - Máy bay không gửi OSD quá 30 s → OFFLINE; đang bay thì đóng chuyến với lý do LOST_LINK.
 * createTracker({ query, now, onEvent }) để test được với đồng hồ giả.
 */

const TAKEOFF_HEIGHT_M = 1.5;
const TAKEOFF_SPEED_MPS = 1.0;
const LANDED_HEIGHT_M = 0.8;
const LANDED_SPEED_MPS = 0.3;
const LANDED_HOLD_MS = 10000;
const OFFLINE_AFTER_MS = 8000;
const TELEMETRY_INTERVAL_MS = 1000;
const DEVICE_ROW_INTERVAL_MS = 5000;

/** Trạng thái RTK từ position_state.is_fixed của DJI (0 chưa bắt đầu, 1 đang fix, 2 FIX, 3 thất bại). */
function rtkState(isFixed) {
    if (isFixed === 2) return 'FIX';
    if (isFixed === 1) return 'FLOAT';
    if (isFixed === 0 || isFixed === 3) return 'NONE';
    return null;
}

function haversine(a, b) {
    const R = 6371008.8;
    const r = d => (d * Math.PI) / 180;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function createTracker({ query, now = () => Date.now(), onEvent = () => {}, findSession = async () => null }) {
    const state = new Map(); // sn -> trạng thái

    function get(sn) {
        if (!state.has(sn)) {
            state.set(sn, { sn, airborne: false, flightId: null, lastSeen: 0, lastLog: 0, lastRow: 0, quietSince: null,
                lastPos: null, distance: 0, maxHeight: 0, fixSamples: 0, samples: 0, ticketId: null, pilotSessionId: null,
                startedAt: null, batteryStart: null, battery: null, online: false, rtk: null, chain: Promise.resolve() });
        }
        return state.get(sn);
    }

    /**
     * Gắn ảnh vào chuyến theo thời điểm chụp (ảnh thường về sau khi hạ cánh nên gọi lại định kỳ).
     * Ảnh có device_sn thì phải trùng máy bay; ảnh nhập thẻ nhớ không có SN thì chỉ theo thời gian.
     */
    async function attachMedia(flightId) {
        // Chỉ ghép khi đúng serial + phiếu (nếu đã biết), và chỉ có đúng 1 chuyến phù hợp.
        const where = flightId ? 'AND f.flight_session_id = ?' : 'AND f.ended_at > NOW() - INTERVAL 7 DAY';
        const r = await query(
            `UPDATE media_files m JOIN (
                SELECT m2.media_id,MIN(f.flight_session_id) AS flight_id,MIN(f.ticket_id) AS ticket_id
                FROM media_files m2 JOIN flight_sessions f ON m2.device_sn=f.device_sn
                  AND m2.captured_at BETWEEN f.started_at - INTERVAL 30 SECOND AND COALESCE(f.ended_at,NOW()) + INTERVAL 30 SECOND
                  AND (m2.ticket_id IS NULL OR m2.ticket_id=f.ticket_id)
                WHERE m2.flight_session_id IS NULL AND f.ended_at IS NOT NULL
                  AND m2.device_sn NOT IN ('','UNKNOWN')
                GROUP BY m2.media_id HAVING COUNT(*)=1
            ) candidate ON m.media_id=candidate.media_id
            JOIN flight_sessions f ON f.flight_session_id=candidate.flight_id
            SET m.flight_session_id=f.flight_session_id,m.ticket_id=COALESCE(m.ticket_id,f.ticket_id),m.assignment_status='FLIGHT'
            WHERE m.flight_session_id IS NULL ${where}`,
            flightId ? [flightId] : []
        );
        if (r.affectedRows) {
            await query(
                `UPDATE flight_sessions f SET photo_count = (SELECT COUNT(*) FROM media_files m WHERE m.flight_session_id = f.flight_session_id)
                 WHERE ${flightId ? 'f.flight_session_id = ?' : 'f.ended_at > NOW() - INTERVAL 7 DAY'}`,
                flightId ? [flightId] : []
            );
        }
        return r.affectedRows || 0;
    }

    async function startFlight(s, dev) {
        const session = await findSession(s.sn);
        s.airborne = true;
        s.startedAt = now();
        s.distance = 0;
        s.maxHeight = 0;
        s.fixSamples = 0;
        s.samples = 0;
        s.batteryStart = dev.battery ?? null;
        s.ticketId = session ? session.ticket_id : null;
        s.pilotSessionId = session ? session.session_id : null;
        const r = await query(
            `INSERT INTO flight_sessions (device_sn, ticket_id, pilot_session_id, started_at, start_lat, start_lng, battery_start)
             VALUES (?, ?, ?, FROM_UNIXTIME(? / 1000), ?, ?, ?)`,
            [s.sn, s.ticketId, s.pilotSessionId, s.startedAt, dev.lat ?? null, dev.lng ?? null, s.batteryStart]
        );
        s.flightId = r.insertId;
        onEvent({ type: 'flight_started', device_sn: s.sn, flight_session_id: s.flightId, ticket_id: s.ticketId });
    }

    async function endFlight(s, reason) {
        if (!s.flightId) { s.airborne = false; return; }
        const id = s.flightId;
        const endedAt = now();
        s.airborne = false;
        s.flightId = null;
        await query(
            `UPDATE flight_sessions SET ended_at = FROM_UNIXTIME(? / 1000), end_reason = ?, duration_s = ?, distance_m = ?,
                max_relative_height = ?, battery_end = ?, rtk_fix_ratio = ? WHERE flight_session_id = ?`,
            [endedAt, reason, Math.round((endedAt - s.startedAt) / 1000), Math.round(s.distance * 10) / 10,
                Math.round(s.maxHeight * 10) / 10, s.battery ?? null, s.samples ? Math.round((s.fixSamples / s.samples) * 100) / 100 : null,
                id]
        );
        await attachMedia(id);
        onEvent({ type: 'flight_ended', device_sn: s.sn, flight_session_id: id, reason });
    }

    /**
     * Xử lý 1 gói OSD máy bay đã chuẩn hóa.
     * dev: { lat, lng, alt, rel_alt, speed, battery, yaw, pitch, roll, satellites, is_fixed, mode_code, gateway_sn }
     */
    function onOsd(sn, dev) {
        // Xử lý tuần tự từng máy bay: 2 gói OSD sát nhau không được mở 2 chuyến
        const s = get(sn);
        const run = s.chain.then(() => handleOsd(s, dev));
        s.chain = run.catch(() => {});
        return run;
    }

    async function handleOsd(s, dev) {
        const sn = s.sn;
        const t = now();
        s.lastSeen = t;
        s.battery = dev.battery ?? s.battery;
        s.rtk = rtkState(dev.is_fixed);
        if (!s.online) { s.online = true; onEvent({ type: 'device_online', device_sn: sn }); }

        const height = Number(dev.rel_alt) || 0;
        const speed = Number(dev.speed) || 0;
        const pos = dev.lat != null && dev.lng != null && !(dev.lat === 0 && dev.lng === 0) ? { lat: dev.lat, lng: dev.lng } : null;

        if (!s.airborne && (height > TAKEOFF_HEIGHT_M || speed > TAKEOFF_SPEED_MPS)) {
            await startFlight(s, dev);
        } else if (s.airborne) {
            if (height < LANDED_HEIGHT_M && speed < LANDED_SPEED_MPS) {
                s.quietSince = s.quietSince ?? t;
                if (t - s.quietSince >= LANDED_HOLD_MS) await endFlight(s, 'LANDED');
            } else {
                s.quietSince = null;
            }
        }

        if (s.airborne) {
            if (pos && s.lastPos) s.distance += haversine(s.lastPos, pos);
            s.maxHeight = Math.max(s.maxHeight, height);
        }
        if (pos) s.lastPos = pos;

        // Telemetry ≤ 1 lần/giây
        if (pos && t - s.lastLog >= TELEMETRY_INTERVAL_MS) {
            s.lastLog = t;
            if (s.airborne) {
                s.samples += 1;
                if (s.rtk === 'FIX') s.fixSamples += 1;
            }
            await query(
                `INSERT INTO telemetry_logs (device_sn, ticket_id, flight_session_id, latitude, longitude, altitude, relative_height,
                    horizontal_speed, yaw, pitch, roll, battery_percent, satellites, rtk_fixed, flight_mode)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [sn, s.airborne ? s.ticketId : null, s.airborne ? s.flightId : null, pos.lat, pos.lng, dev.alt ?? 0, height, speed,
                    dev.yaw ?? 0, dev.pitch ?? 0, dev.roll ?? 0, dev.battery ?? null, dev.satellites ?? 0,
                    s.rtk == null ? null : (s.rtk === 'FIX' ? 1 : 0), dev.mode_code != null ? String(dev.mode_code) : 'UNKNOWN']
            );
        }

        // Bảng thiết bị ≤ 1 lần / 5 giây
        if (t - s.lastRow >= DEVICE_ROW_INTERVAL_MS) {
            s.lastRow = t;
            await query(
                `INSERT INTO uav_devices (device_sn, device_name, device_model, device_type, status, last_latitude, last_longitude,
                    last_altitude, last_relative_height, last_battery, last_speed, last_yaw, last_pitch, last_roll, gateway_sn, rtk_state, last_mode_code, last_seen)
                 VALUES (?, ?, 'Mavic 3T', 'DRONE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE status = VALUES(status), last_latitude = VALUES(last_latitude), last_longitude = VALUES(last_longitude),
                    last_altitude = VALUES(last_altitude), last_relative_height = VALUES(last_relative_height), last_battery = VALUES(last_battery),
                    last_speed = VALUES(last_speed), last_yaw = VALUES(last_yaw), last_pitch = VALUES(last_pitch), last_roll = VALUES(last_roll),
                    gateway_sn = COALESCE(VALUES(gateway_sn), gateway_sn), rtk_state = VALUES(rtk_state), last_mode_code = VALUES(last_mode_code), last_seen = NOW()`,
                [sn, `DJI Mavic 3T (${sn})`, s.airborne ? 'IN_FLIGHT' : 'ONLINE', pos ? pos.lat : null, pos ? pos.lng : null, dev.alt ?? null, height,
                    dev.battery ?? null, speed, dev.yaw ?? null, dev.pitch ?? null, dev.roll ?? null, dev.gateway_sn ?? null, s.rtk, dev.mode_code ?? null]
            );
        }
        return { airborne: s.airborne, flight_session_id: s.flightId, rtk: s.rtk };
    }

    /** Gọi định kỳ (vd 5 s): máy bay im lặng quá 30 s → OFFLINE, đóng chuyến đang bay. */
    async function sweep() {
        const t = now();
        for (const s of state.values()) {
            if (!s.online || t - s.lastSeen < OFFLINE_AFTER_MS) continue;
            s.online = false;
            if (s.airborne) {
                const run = s.chain.then(() => (s.airborne ? endFlight(s, 'LOST_LINK') : null));
                s.chain = run.catch(() => {});
                await run;
            }
            await query("UPDATE uav_devices SET status = 'OFFLINE' WHERE device_sn = ?", [s.sn]);
            onEvent({ type: 'device_offline', device_sn: s.sn, last_seen: new Date(s.lastSeen).toISOString() });
        }
    }

    /** Khi khởi động: chuyến nào còn mở (server tắt giữa chừng) thì đóng lại. */
    async function closeDangling() {
        const r = await query("UPDATE flight_sessions SET ended_at = NOW(), end_reason = 'SERVER_RESTART' WHERE ended_at IS NULL");
        return r.affectedRows || 0;
    }

    function snapshot() {
        return [...state.values()].map(s => ({
            device_sn: s.sn, online: s.online, airborne: s.airborne, flight_session_id: s.flightId,
            ticket_id: s.ticketId, rtk: s.rtk, battery: s.battery, last_seen: s.lastSeen ? new Date(s.lastSeen).toISOString() : null,
            position: s.lastPos
        }));
    }

    return { onOsd, sweep, closeDangling, attachMedia, snapshot, isOnline: sn => Boolean(state.get(sn) && state.get(sn).online) };
}

module.exports = { createTracker, rtkState, OFFLINE_AFTER_MS };
