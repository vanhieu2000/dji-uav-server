/** Chiếu lên mặt phẳng đất: chỉ chạy với RTK và AGL/FOV đã được xác nhận riêng.
 * RelativeAltitude so điểm cất cánh KHÔNG được tự coi là AGL tại mục tiêu.
 * Chưa hỗ trợ địa hình/zoom chưa hiệu chuẩn/ống kính méo; trường hợp đó để UNRESOLVED.
 */
const finite = x => typeof x === 'number' && Number.isFinite(x);
function projectPixel(media, detection, calibration) {
    const c = calibration;
    if (!c || c.confirmed !== true || !finite(c.agl_m) || c.agl_m <= 0 || c.agl_m > 500 ||
        !finite(c.hfov_deg) || c.hfov_deg <= 0 || c.hfov_deg >= 160 || !finite(c.vfov_deg) || c.vfov_deg <= 0 || c.vfov_deg >= 160 ||
        media.rtk_flag !== 50 || !finite(media.latitude) || !finite(media.longitude) ||
        !finite(media.gimbal_pitch) || media.gimbal_pitch > -89.8 || media.gimbal_pitch < -90.2 ||
        !finite(media.gimbal_yaw) || (media.gimbal_roll != null && Math.abs(media.gimbal_roll) > 0.2)) return null;
    if (c.image_width !== detection.image_width || c.image_height !== detection.image_height || c.lens !== media.lens) return null;
    const [x,y,w,h] = detection.bbox;
    const r = Math.PI/180, yaw=media.gimbal_yaw*r;
    const eastCamera=(2*(x+w/2)/detection.image_width-1)*c.agl_m*Math.tan(c.hfov_deg*r/2);
    const northCamera=(1-2*(y+h/2)/detection.image_height)*c.agl_m*Math.tan(c.vfov_deg*r/2);
    const east=eastCamera*Math.cos(yaw)+northCamera*Math.sin(yaw);
    const north=northCamera*Math.cos(yaw)-eastCamera*Math.sin(yaw);
    const latitude=media.latitude+north/111195;
    const longitude=media.longitude+east/(111195*Math.cos(media.latitude*r));
    if (!Number.isFinite(longitude) || Math.abs(longitude)>180 || Math.abs(latitude)>90) return null;
    return { latitude, longitude, status:'PROJECTED_APPROXIMATE' };
}
module.exports = { projectPixel };
