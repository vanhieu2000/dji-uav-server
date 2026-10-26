const {query}=require('../config/db');
const access=require('./authorization');
async function eventAllowed(user,event){
    if(user.role==='ADMIN')return true;
    if(user.must_change_password)return false;
    if(['raw_mqtt','services_reply','settings_updated','client_connected','gateway_status','rc_osd','device_event','db_status'].includes(event.type))return false;
    let ticketId=event.ticket_id||event.data?.ticket_id;
    if(!ticketId && event.type==='vision_result'&&event.data?.job_id){
        const [row]=await query('SELECT m.ticket_id FROM vision_jobs j JOIN media_files m ON j.media_id=m.media_id WHERE j.job_id=?',[event.data.job_id]);ticketId=row?.ticket_id;
    }
    if(!ticketId&&event.type==='alert_status'&&event.data?.alert_id){const [row]=await query('SELECT ticket_id FROM defect_alerts WHERE alert_id=?',[event.data.alert_id]);ticketId=row?.ticket_id;}
    if(ticketId){try{access.permission(user,'tasks:read');await access.ticket(user,ticketId);return true;}catch(e){return false;}}
    const sn=event.device_sn||event.data?.device_sn;
    if(sn){
        const [device]=await query('SELECT plant_id,unit_id FROM uav_devices WHERE device_sn=?',[sn]);
        return !!device&&user.permissions.includes('assets:read')&&user.plant_ids.includes(device.plant_id)&&user.unit_id!=null&&device.unit_id===user.unit_id;
    }
    return false;
}
module.exports={eventAllowed};
