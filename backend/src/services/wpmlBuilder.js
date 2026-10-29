/**
 * Dựng file KMZ đường bay theo DJI WPML 1.0.2 cho Mavic 3T (Giai đoạn A2).
 * Tài liệu: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/overview.html
 *
 * PHẢI KIỂM CHỨNG KHI BAY THỬ (ghi trong docs/KE_HOACH_BAN_GIAO.md):
 *   - payloadLensIndex nhận "ir,wide,zoom" đúng camera M3T
 *   - đơn vị actionTriggerParam của multipleDistance (m) / multipleTiming (s)
 *   - zoom: focalLength theo tiêu cự tương đương (mm) = 24 × độ zoom
 * Độ cao: relativeToStartPoint (so với điểm cất cánh). KHÔNG dùng EGM96/WGS84 với giá trị 30 m
 * (đó là độ cao so với mực nước biển, sai hoàn toàn ở nhà máy cách mặt biển hàng trăm mét).
 */
const AdmZip = require('adm-zip');

const DRONE = { enum: 77, sub: 1 };    // Mavic 3 Enterprise series – M3T
const PAYLOAD = { enum: 67, sub: 0 };  // Camera M3T
const WIDE_EQUIV_FOCAL_MM = 24;

const fmt = n => (Math.round(Number(n) * 1e7) / 1e7).toString();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function missionConfig(speed) {
    return `    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${fmt(speed)}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>${DRONE.enum}</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>${DRONE.sub}</wpml:droneSubEnumValue>
      </wpml:droneInfo>
      <wpml:payloadInfo>
        <wpml:payloadEnumValue>${PAYLOAD.enum}</wpml:payloadEnumValue>
        <wpml:payloadSubEnumValue>${PAYLOAD.sub}</wpml:payloadSubEnumValue>
        <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
      </wpml:payloadInfo>
    </wpml:missionConfig>`;
}

let actionSeq = 0;
function action(func, params) {
    const body = Object.entries(params).map(([k, v]) => `              <wpml:${k}>${esc(v)}</wpml:${k}>`).join('\n');
    return `          <wpml:action>
            <wpml:actionId>${actionSeq++}</wpml:actionId>
            <wpml:actionActuatorFunc>${func}</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
${body}
            </wpml:actionActuatorFuncParam>
          </wpml:action>`;
}

const gimbalRotate = pitch => action('gimbalRotate', {
    gimbalHeadingYawBase: 'aircraft', gimbalRotateMode: 'absoluteAngle',
    gimbalPitchRotateEnable: 1, gimbalPitchRotateAngle: fmt(pitch),
    gimbalRollRotateEnable: 0, gimbalRollRotateAngle: 0,
    gimbalYawRotateEnable: 0, gimbalYawRotateAngle: 0,
    gimbalRotateTimeEnable: 0, gimbalRotateTime: 0, payloadPositionIndex: 0
});
const takePhoto = (lenses, suffix) => action('takePhoto', {
    payloadPositionIndex: 0, fileSuffix: suffix, payloadLensIndex: lenses, useGlobalPayloadLensIndex: 0
});
const zoom = factor => action('zoom', { payloadPositionIndex: 0, focalLength: fmt(WIDE_EQUIV_FOCAL_MM * factor) });
const hover = seconds => action('hover', { hoverTime: fmt(seconds) });

function actionGroup(id, startIdx, endIdx, trigger, actions) {
    const param = trigger.param != null ? `\n            <wpml:actionTriggerParam>${fmt(trigger.param)}</wpml:actionTriggerParam>` : '';
    return `        <wpml:actionGroup>
          <wpml:actionGroupId>${id}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${startIdx}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${endIdx}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>${trigger.type}</wpml:actionTriggerType>${param}
          </wpml:actionTrigger>
${actions.join('\n')}
        </wpml:actionGroup>`;
}

function headingParam(heading) {
    if (heading == null) {
        return `        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
        </wpml:waypointHeadingParam>`;
    }
    return `        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${fmt(heading > 180 ? heading - 360 : heading)}</wpml:waypointHeadingAngle>
        </wpml:waypointHeadingParam>`;
}

/** Placemark của waylines.wpml (bản máy bay thực thi). */
function execPlacemark(i, wp, groups) {
    return `      <Placemark>
        <Point><coordinates>${fmt(wp.lng)},${fmt(wp.lat)}</coordinates></Point>
        <wpml:index>${i}</wpml:index>
        <wpml:executeHeight>${fmt(wp.alt)}</wpml:executeHeight>
        <wpml:waypointSpeed>${fmt(wp.speed)}</wpml:waypointSpeed>
${headingParam(wp.heading)}
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
${groups.join('\n')}
      </Placemark>`;
}

/** Placemark của template.kml (bản để Pilot 2 hiển thị / chỉnh). */
function templatePlacemark(i, wp) {
    return `      <Placemark>
        <Point><coordinates>${fmt(wp.lng)},${fmt(wp.lat)}</coordinates></Point>
        <wpml:index>${i}</wpml:index>
        <wpml:height>${fmt(wp.alt)}</wpml:height>
        <wpml:useGlobalHeight>0</wpml:useGlobalHeight>
        <wpml:waypointSpeed>${fmt(wp.speed)}</wpml:waypointSpeed>
        <wpml:useGlobalSpeed>0</wpml:useGlobalSpeed>
        <wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>
        <wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>
        <wpml:gimbalPitchAngle>${fmt(wp.gimbalPitch)}</wpml:gimbalPitchAngle>
      </Placemark>`;
}

function documents(name, speed, waypoints, groupsByIndex) {
    const now = Date.now();
    const template = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:author>dji-uav-server</wpml:author>
    <wpml:createTime>${now}</wpml:createTime>
    <wpml:updateTime>${now}</wpml:updateTime>
${missionConfig(speed)}
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:waylineCoordinateSysParam>
        <wpml:coordinateMode>WGS84</wpml:coordinateMode>
        <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
      </wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${fmt(speed)}</wpml:autoFlightSpeed>
      <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
      <wpml:globalWaypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
      </wpml:globalWaypointHeadingParam>
      <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>
      <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>
${waypoints.map((wp, i) => templatePlacemark(i, wp)).join('\n')}
    </Folder>
  </Document>
</kml>`;
    const waylines = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <!-- ${esc(name)} -->
${missionConfig(speed)}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:autoFlightSpeed>${fmt(speed)}</wpml:autoFlightSpeed>
${waypoints.map((wp, i) => execPlacemark(i, wp, groupsByIndex[i] || [])).join('\n')}
    </Folder>
  </Document>
</kml>`;
    return { template, waylines };
}

/**
 * Tuyến quét lưới: mỗi đường bay = 2 điểm (đầu, cuối).
 * Tại điểm đầu đường bay: xoay gimbal; trên đoạn đầu→cuối: chụp mỗi N m (hoặc N s).
 */
function buildGridKmz({ name, plan, geometry, profile }) {
    actionSeq = 0;
    const alt = geometry.altitude_m;
    const speed = geometry.max_speed_mps;
    const lenses = profile.lenses;
    const waypoints = plan.waypoints.map(p => ({ ...p, alt, speed, gimbalPitch: profile.gimbal_pitch, heading: null }));
    const trigger = profile.trigger_mode === 'TIME'
        ? { type: 'multipleTiming', param: geometry.trigger_interval_s || 1 }
        : { type: 'multipleDistance', param: geometry.trigger_distance_m };
    const groups = {};
    let gid = 0;
    for (let i = 0; i < waypoints.length; i += 2) {
        groups[i] = [
            actionGroup(gid++, i, i, { type: 'reachPoint' }, [gimbalRotate(profile.gimbal_pitch)]),
            actionGroup(gid++, i, i + 1, trigger, [takePhoto(lenses, `L${i / 2 + 1}`)])
        ];
    }
    return pack(name, speed, waypoints, groups);
}

/**
 * Tuyến điểm: tại mỗi điểm dừng, xoay gimbal, zoom, chờ, chụp N ảnh.
 * points: [{lat,lng,altitude_m,gimbal_pitch,aircraft_heading,zoom_factor,hover_seconds,label}]
 */
function buildPointsKmz({ name, points, profile, speed }) {
    actionSeq = 0;
    const waypoints = points.map(p => ({
        lat: p.lat, lng: p.lng, alt: p.altitude_m, speed: p.speed_mps ?? speed, gimbalPitch: p.gimbal_pitch,
        heading: p.aircraft_heading == null ? null : Number(p.aircraft_heading)
    }));
    const groups = {};
    points.forEach((p, i) => {
        const pointLenses=p.lenses||profile.lenses;
        const acts = [gimbalRotate(p.gimbal_pitch)];
        const zf = p.zoom_factor != null ? p.zoom_factor : profile.zoom_factor;
        if (zf != null && pointLenses.split(',').includes('zoom')) acts.push(zoom(zf));
        const hv = p.hover_seconds != null ? p.hover_seconds : profile.hover_seconds;
        if (hv > 0) acts.push(hover(hv));
        const n = Math.max(1, Number(profile.photos_per_point) || 1);
        for (let k = 0; k < n; k += 1) acts.push(takePhoto(pointLenses, `${p.label || `P${i + 1}`}${n > 1 ? `_${k + 1}` : ''}`));
        groups[i] = [actionGroup(i, i, i, { type: 'reachPoint' }, acts)];
    });
    return pack(name, speed, waypoints, groups);
}

/**
 * Tuyến vẽ tay trên dashboard (Mission planner): đi qua các điểm theo thứ tự.
 * triggerDistance > 0: chụp mỗi N m suốt tuyến; ngược lại: xoay gimbal + chụp tại từng điểm.
 */
function buildManualKmz({ name, waypoints, altitude, speed, lenses = 'ir,wide', triggerDistance = 0, gimbalPitch = -90 }) {
    actionSeq = 0;
    const wps = waypoints.map(p => ({
        lat: p.lat, lng: p.lng, alt: p.alt != null ? p.alt : altitude, speed: p.speed ?? speed,
        gimbalPitch: p.gimbalPitch != null ? p.gimbalPitch : gimbalPitch, heading: null
    }));
    const groups = {};
    if (triggerDistance > 0) {
        groups[0] = [
            actionGroup(0, 0, 0, { type: 'reachPoint' }, [gimbalRotate(wps[0].gimbalPitch)]),
            actionGroup(1, 0, wps.length - 1, { type: 'multipleDistance', param: triggerDistance }, [takePhoto(lenses, 'M')])
        ];
    } else {
        wps.forEach((wp, i) => {
            groups[i] = [actionGroup(i, i, i, { type: 'reachPoint' }, [gimbalRotate(wp.gimbalPitch), hover(waypoints[i].hoverTime ?? 1), takePhoto(waypoints[i].lenses || lenses, `M${i + 1}`)])];
        });
    }
    return pack(name, speed, wps, groups);
}

function pack(name, speed, waypoints, groups) {
    if (waypoints.length < 2) throw new Error('Đường bay cần ít nhất 2 điểm');
    const { template, waylines } = documents(name, speed, waypoints, groups);
    const zip = new AdmZip();
    zip.addFile('wpmz/template.kml', Buffer.from(template, 'utf8'));
    zip.addFile('wpmz/waylines.wpml', Buffer.from(waylines, 'utf8'));
    return { buffer: zip.toBuffer(), template, waylines, waypointCount: waypoints.length };
}

module.exports = { buildGridKmz, buildPointsKmz, buildManualKmz };
