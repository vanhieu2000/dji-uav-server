const os=require('os'),net=require('net');
const loopback=host=>!host||host==='localhost'||host==='0.0.0.0'||host.startsWith('127.');
function addresses(interfaces=os.networkInterfaces()){
 const out=[];
 for(const [name,list]of Object.entries(interfaces)){
  if(/docker|veth|br-|vmnet|virtualbox|vbox|vethernet|wsl|tailscale|zerotier|vpn|tun\d|tap\d|loopback/i.test(name))continue;
  for(const item of list||[])if((item.family==='IPv4'||item.family===4)&&!item.internal&&net.isIP(item.address)===4&&!loopback(item.address)&&!item.address.startsWith('169.254.'))out.push({name,address:item.address,wifi:/wi[ -]?fi|wlan|wireless|airport/i.test(name)});
 }
 return out;
}
function resolveHost({configured,mode='lan',interfaces}={}){
 if(!['lan','loopback'].includes(mode))throw Error('LOCAL_NETWORK_MODE phải là lan hoặc loopback');
 const host=String(configured||'auto').trim();
 if(mode==='loopback')return host==='auto'||loopback(host)?'127.0.0.1':host;
 if(host!=='auto'&&!loopback(host))return host;
 const all=addresses(interfaces),wifi=all.filter(x=>x.wifi),choices=wifi.length?wifi:all,unique=[...new Set(choices.map(x=>x.address))];
 if(unique.length===1)return unique[0];
 if(!unique.length)throw Error('Không tìm thấy IPv4 LAN. Kết nối Wi-Fi, đặt HOST_IP=<IPv4 của PC> trong .env; hoặc LOCAL_NETWORK_MODE=loopback để chỉ thử trên máy.');
 throw Error('Có nhiều card mạng: '+choices.map(x=>x.name+'='+x.address).join(', ')+'. Đặt HOST_IP=<IPv4 cùng Wi-Fi với RC> trong .env, không tự đoán địa chỉ.');
}
function urls(host,port,mqtt){return {dashboard:`http://${host}:${port}/dashboard/`,pilot:`http://${host}:${port}/pilot-login/`,mqtt:`tcp://${host}:${mqtt}`};}
module.exports={addresses,resolveHost,urls};
