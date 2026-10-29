/** Giám sát thuần nhận dữ liệu. Không có MQTT publisher hoặc lệnh điều khiển. */
const crypto = require('crypto');
const SN_RE = /^[A-Za-z0-9_-]{1,64}$/;
const digest = text => crypto.createHash('sha256').update(text).digest('hex');

function hmsItems(data) {
    const list = Array.isArray(data) ? data : (data && (data.list || data.hms));
    if (!Array.isArray(list)) return [];
    return list.slice(0, 100).filter(x => x && (typeof x.code === 'string' || typeof x.code === 'number'))
        .map(x => ({ code: String(x.code).slice(0, 128), level: Number.isInteger(x.level) ? x.level : null,
            message: typeof x.message === 'string' ? x.message.slice(0, 500) : null,
            device_sn: SN_RE.test(x.device_sn || '') ? x.device_sn : null }));
}

function channelFor(ticketId, sn) {
    if ((ticketId!=null&&(!Number.isSafeInteger(Number(ticketId))||Number(ticketId)<=0)) || !SN_RE.test(sn || '')) {
        throw new Error('Phiếu hoặc mã thiết bị phát không hợp lệ');
    }
    // Không dùng ticket_code như path: mã nghiệp vụ có thể đổi hoặc có ký tự không hợp lệ với RTMP.
    return ticketId==null?`gateway_${digest(sn).slice(0,16)}`:`ticket_${Number(ticketId)}_${digest(sn).slice(0, 16)}`;
}

function createMonitoring({ query, onEvent = () => {}, now = () => Date.now(), playbackBase = '' }) {
    const publishers = new Map();
    // Serialize per path so delayed DB lookup cannot reverse publish/unpublish order.
    const chains = new Map();
    async function ensureStream(ticketId, sn) {
        const channel = channelFor(ticketId, sn);
        await query(`INSERT INTO ticket_live_streams (ticket_id, device_sn, channel) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE channel = VALUES(channel)`, [ticketId==null?null:Number(ticketId), sn, channel]);
        return { ticket_id: ticketId==null?null:Number(ticketId), device_sn: sn, channel, streamPath: `/live/${channel}` };
    }
    function state(row) {
        const streamPath = `/live/${row.channel}`;
        const p = publishers.get(streamPath);
        const nativeStatus = p?.session?.broadcast?.getPublishStatus?.();
        const status = !p || nativeStatus === 'idle' ? 'STOPPED' : nativeStatus === 'reconnecting' ? 'RECONNECTING' : 'STREAMING';
        return { ...row, streamPath, flv_url: playbackBase ? `${playbackBase.replace(/\/$/, '')}${streamPath}.flv` : null, status, publisher_seen_at: p ? p.at : null };
    }
    async function streams(ticketId) {
        return (await query('SELECT * FROM ticket_live_streams WHERE ticket_id <=> ? ORDER BY stream_id', [ticketId])).map(state);
    }
    async function streamsForDevice(sn){return (await query('SELECT * FROM ticket_live_streams WHERE device_sn=? ORDER BY stream_id DESC',[sn])).map(state);}
    function publisherEvent(kind, session, legacyPath) {
        const streamPath = typeof session === 'object' && session ? session.streamPath : legacyPath;
        const id = typeof session === 'object' && session ? session.id : session;
        if (!/^\/live\/(?:ticket_\d+|gateway)_[a-f0-9]{16}$/.test(streamPath || '')) return Promise.resolve(null);
        const run = (chains.get(streamPath) || Promise.resolve()).then(async () => {
            const [row] = await query('SELECT * FROM ticket_live_streams WHERE channel = ?', [streamPath.slice(6)]);
            if (!row) return null;
            if (kind === 'start') {
                const current = publishers.get(streamPath);
                if (session && typeof session === 'object' && session.isPublisher === false) return null;
                if (current && current.id !== id && session?.isPublisher !== true) return null; // native v4 accepts reconnect before postPublish's async lookup completes
                publishers.set(streamPath, { id, session: typeof session === 'object' ? session : null, at: new Date(now()).toISOString() });
            } else {
                const current = publishers.get(streamPath);
                if (!current || current.id !== id) return null;
                publishers.delete(streamPath);
            }
            const event = { type: kind === 'start' ? 'stream_started' : 'stream_stopped', ...state(row) };
            onEvent(event);
            return event;
        });
        const tail = run.catch(() => {});
        chains.set(streamPath, tail);
        tail.finally(() => { if (chains.get(streamPath) === tail) chains.delete(streamPath); });
        return run;
    }
    async function hms(sn, packet, gatewaySn = null) {
        if (!SN_RE.test(sn || '')) return [];
        const timestamp = Number.isSafeInteger(packet.timestamp) && packet.timestamp >= 0 ? packet.timestamp : null;
        const out = [];
        for (const item of hmsItems(packet.data)) {
            const deviceSn = item.device_sn || sn;
            const key = digest(JSON.stringify([deviceSn, packet.tid || null, timestamp, item.code, item.level, item.message]));
            const result = await query(`INSERT IGNORE INTO uav_hms_events
                (event_key, device_sn, gateway_sn, code, level, message, source_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [key, deviceSn, gatewaySn || sn, item.code, item.level, item.message, timestamp]);
            if (result.affectedRows) {
                const event = { type: 'hms', event_id: result.insertId, device_sn: deviceSn, gateway_sn: gatewaySn || sn,
                    ...item, source_timestamp: timestamp, received_at: new Date(now()).toISOString() };
                event.device_sn = deviceSn;
                onEvent(event); out.push(event);
            }
        }
        return out;
    }
    return { ensureStream, streamsForDevice, streams, publisherEvent, hms };
}
module.exports = { createMonitoring, channelFor, hmsItems };
