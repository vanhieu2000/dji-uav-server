const nodemailer=require('nodemailer');
async function sendReset(to,token){
    const url=new URL(process.env.PASSWORD_RESET_BASE_URL);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('PASSWORD_RESET_BASE_URL cần HTTPS');
    url.hash='reset_token='+token;
    const port=Number(process.env.SMTP_PORT||465);
    const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:true,
        ...(process.env.SMTP_USER?{auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}}:{}),tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}});
    await transport.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to,subject:'Đặt lại mật khẩu UAV Server',text:`Bạn đã yêu cầu đặt lại mật khẩu. Link dùng một lần, hết hạn sau 20 phút:\n${url}\nNếu không yêu cầu, hãy bỏ qua email này.`});
}
module.exports={sendReset};
