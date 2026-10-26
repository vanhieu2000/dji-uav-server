/** Chỉ dùng index thiết bị thực sự công bố; không suy từ tên camera/lens. */
function videoIds(capacity) {
    if (!capacity || !Array.isArray(capacity.device_list)) return [];
    const out = [];
    for (const device of capacity.device_list) {
        if (typeof device.sn !== 'string' || !Array.isArray(device.camera_list)) continue;
        for (const camera of device.camera_list) {
            if (typeof camera.camera_index !== 'string' || !Array.isArray(camera.video_list)) continue;
            for (const video of camera.video_list) {
                if (typeof video.video_index === 'string') out.push(`${device.sn}/${camera.camera_index}/${video.video_index}`);
            }
        }
    }
    return [...new Set(out)];
}
module.exports = { videoIds };
