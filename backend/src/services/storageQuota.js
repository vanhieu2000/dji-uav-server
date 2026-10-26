const {query}=require('../config/db');
async function capacity(extra=0){
 const [setting]=await query("SELECT setting_value FROM system_settings WHERE setting_key='max_media_storage_gb'");const max=Number(setting?.setting_value)||0;if(max<=0)return;
 const [row]=await query('SELECT COALESCE(SUM(file_size),0) AS bytes FROM media_files WHERE file_path_local IS NOT NULL');if(Number(row.bytes)+extra>max*1024**3){const error=Error('Dung lượng ảnh đã đạt giới hạn; quản trị viên cần sao lưu và dọn dữ liệu');error.status=507;throw error;}
}
async function middleware(req,res,next){try{const bytes=Number(req.get('content-length')||0);await capacity(Number.isFinite(bytes)?bytes:0);next();}catch(e){res.status(e.status||503).json({code:e.status||503,message:e.status===507?e.message:'Chưa kiểm tra được dung lượng lưu ảnh'});}}
module.exports={capacity,middleware};
