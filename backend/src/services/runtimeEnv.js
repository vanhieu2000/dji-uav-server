const fs=require('fs');
function load(){for(const name of ['MYSQL_PASSWORD','JWT_SECRET','S3_SERVICE_ACCESS_KEY','S3_SERVICE_SECRET_KEY','SMTP_PASSWORD','VISION_WEBHOOK_SECRET','VISION_API_TOKEN','MQTT_PASSWORD']){const file=process.env[name+'_FILE'];if(file){const value=fs.readFileSync(file,'utf8').trim();if(!value)throw Error(name+'_FILE rỗng');process.env[name]=value;}}require('./operatorConfig').apply();}
module.exports={load};
