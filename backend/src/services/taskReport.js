const fs=require('fs'),path=require('path');
const {query}=require('../config/db');
const {Document,Packer,Paragraph,TextRun,ImageRun}=require('docx');
const PDFDocument=require('pdfkit');
const FONT=process.env.REPORT_FONT_PATH||path.resolve(__dirname,'../../public/dashboard/assets/fonts/BeVietnamPro-Regular.ttf');
async function snapshot(id){
 const [ticket]=await query('SELECT t.*,u.full_name AS inspector_name FROM inspection_tickets t LEFT JOIN users u ON t.inspector_id=u.user_id WHERE ticket_id=?',[id]);
 if(!ticket)throw new Error('Phiếu không tồn tại');
 const [photos,defects,measurements]=await Promise.all([
  query('SELECT media_id,file_name,file_path_local,lens,latitude,longitude,captured_at,position_quality FROM media_files WHERE ticket_id=? ORDER BY media_id',[id]),
  query('SELECT detection_id,media_id,COALESCE(defect_code,defect_type) AS code,confidence,max_temperature,model_version,verified_by_human,mapping_status FROM ai_defect_detections WHERE ticket_id=? ORDER BY detection_id',[id]),
  query('SELECT asset_type,asset_id,max_temp_c,delta_t_c,captured_at FROM temperature_history WHERE ticket_id=? AND valid=1 ORDER BY captured_at',[id])
 ]);return {ticket,photos,defects,measurements};
}
function image(file,budget){
 if(!file)return null;
 const root=fs.realpathSync(require('../routes/mediaUpload').MEDIA_DIR),full=path.resolve(file);
 try{const real=fs.realpathSync(full);if(!real.startsWith(root+path.sep))return null;const stat=fs.statSync(real);if(stat.size>25*1024*1024||stat.size>budget.remaining)return null;budget.remaining-=stat.size;const bytes=fs.readFileSync(real);return bytes[0]===255&&bytes[1]===216?bytes:null;}catch(e){return null;}
}
function lines(d){
 const t=d.ticket;return [
 'BÁO CÁO KIỂM TRA UAV',`${t.ticket_code} — ${t.ticket_name}`,`Loại: ${t.inspection_type} | Trạng thái: ${t.status}`,`Phạm vi: ${t.target_facility}`,`Nhà máy ID: ${t.plant_id??'Chưa gán'} | Đơn vị ID: ${t.unit_id??'Chưa gán'}`,`Người phụ trách: ${t.inspector_name||'Chưa giao'}`,`Ngày lập báo cáo: ${new Date().toISOString()}`,`Ảnh gốc: ${d.photos.length} | Phát hiện Vision: ${d.defects.length}`,
 'KẾT QUẢ VISION (chưa xác nhận không đồng nghĩa lỗi đã nghiệm thu)',
 ...d.defects.map(x=>`#${x.detection_id} | Ảnh ${x.media_id} | ${x.code} | confidence ${x.confidence??'—'} | max ${x.max_temperature??'—'} °C | model ${x.model_version||'—'} | ${x.verified_by_human?'Đã xác nhận':'Chờ xác nhận'} | ${x.mapping_status||'UNRESOLVED'}`),
 'SỐ ĐO NHIỆT ĐÃ XÁC NHẬN',...d.measurements.map(x=>`${x.asset_type} #${x.asset_id} | ${new Date(x.captured_at).toISOString()} | max ${x.max_temp_c} °C | ΔT ${x.delta_t_c??'—'} °C`),
 'ẢNH, VỊ TRÍ VÀ THỜI GIAN',...d.photos.map(p=>`#${p.media_id} ${p.file_name} | ${p.lens||'Không rõ camera'} | ${p.latitude==null||p.longitude==null?'Chưa có GPS':p.latitude+', '+p.longitude} | ${p.position_quality||'Không rõ chất lượng vị trí'} | ${p.captured_at?new Date(p.captured_at).toISOString():'Chưa rõ giờ chụp'}`),
 'CHỮ KÝ XÁC NHẬN (bản xuất này chưa ký)', 'Người kiểm tra: ____________________    Ngày: ______________', 'Người phê duyệt: ___________________    Ngày: ______________'
 ];
}
async function build(id,format){
 const budget={remaining:40*1024*1024};
 const data=await snapshot(id),text=lines(data),photos=data.photos.slice(0,100);
 if(format==='docx'){
  const children=text.map((s,i)=>new Paragraph({children:[new TextRun({text:s,bold:i===0})],spacing:{after:120}}));
  children.push(new Paragraph(`Phụ lục ảnh: ${photos.length}/${data.photos.length} ảnh đầu tiên (tối đa 100). Ảnh gốc đầy đủ lưu trong phiếu.`));
  for(const p of photos){children.push(new Paragraph(p.file_name));const bytes=image(p.file_path_local,budget);if(bytes)children.push(new Paragraph({children:[new ImageRun({data:bytes,type:'jpg',transformation:{width:440,height:330}})]}));else children.push(new Paragraph('Không đọc được ảnh gốc hoặc ảnh quá lớn; kiểm tra tệp trong phiếu.'));}
  return Packer.toBuffer(new Document({sections:[{children}],styles:{default:{document:{run:{font:'DejaVu Sans',size:22}}}}}));
 }
 if(!fs.existsSync(FONT))throw Error('Chưa cài font Unicode cho báo cáo PDF');
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:45}),chunks=[];doc.on('data',c=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  try{doc.font(FONT).fontSize(11);for(const s of text)doc.text(s,{paragraphGap:8});doc.addPage().text(`Phụ lục ảnh: ${photos.length}/${data.photos.length} ảnh đầu tiên (tối đa 100).`);
   for(const p of photos){doc.addPage().text(p.file_name);const bytes=image(p.file_path_local,budget);if(bytes){try{doc.image(bytes,45,90,{fit:[500,650]});}catch(e){doc.text('Ảnh không giải mã được.');}}else doc.text('Không đọc được ảnh gốc hoặc ảnh quá lớn.');}doc.end();
  }catch(e){doc.destroy();reject(e);}
 });
}
let active=0;
async function generate(id,format){if(active>=2){const e=new(require('../utils/validate').ValidationError)('Máy chủ đang xuất báo cáo; thử lại sau');e.status=503;throw e;}active++;try{return await build(id,format);}finally{active--;}}
module.exports={generate,snapshot,lines};
