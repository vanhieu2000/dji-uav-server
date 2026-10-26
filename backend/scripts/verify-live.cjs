/** NMS v4 transport proof, loopback + generated video; no UAV connection. */
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert/strict'),{spawn}=require('child_process');
const NodeMediaServer=require('node-media-server'),access=require('../src/services/streamAccess');
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
(async()=>{
 process.chdir(fs.mkdtempSync(path.join(os.tmpdir(),'uav-live-verify-')));
 const rtmp=await port(),http=await port(),nms=new NodeMediaServer({rtmp:{port:rtmp},http:{port:http},auth:{play:true,publish:true,secret:access.secret},webadmin:{enable:false},logType:0});
 const streamPath='/live/ticket_999_0123456789abcdef',user={user_id:999,session_id:'fixture-live-session',auth_version:0};let publisher=null;const children=[];
 nms.on('prePublish',s=>access.allow(s,'publish'));nms.on('prePlay',s=>access.allow(s,'play'));nms.on('postPublish',s=>publisher=s);nms.on('donePlay',access.release);nms.run();
 try{
  const pubQuery=access.mint(streamPath,'publish',user),playQuery=access.mint(streamPath,'play',user);
  const ffmpeg=spawn('ffmpeg',['-hide_banner','-loglevel','error','-re','-f','lavfi','-i','color=c=blue:s=320x240:r=10','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-f','flv',`rtmp://127.0.0.1:${rtmp}${streamPath}?${pubQuery}`],{stdio:'ignore'});children.push(ffmpeg);
  const end=Date.now()+10000;while(!publisher&&Date.now()<end)await new Promise(r=>setTimeout(r,50));assert.ok(publisher,'valid publisher accepted');
  const controller=new AbortController();const response=await fetch(`http://127.0.0.1:${http}${streamPath}.flv?${playQuery}`,{signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader(),first=await reader.read();assert.equal(Buffer.from(first.value).subarray(0,3).toString(),'FLV');controller.abort();
  const denied=await fetch(`http://127.0.0.1:${http}${streamPath}.flv`).catch(()=>null);if(denied)assert.equal((await denied.arrayBuffer()).byteLength,0,'unsigned viewers receive no video bytes');
  // A viewer grant cannot be used for publishing; native verify sees invalid sign before broadcast.
  const invalid={id:'wrong-purpose',streamPath,streamQuery:Object.fromEntries(new URLSearchParams(playQuery))};assert.equal(access.allow(invalid,'publish'),false);assert.equal(invalid.streamQuery.sign,'invalid');
  access.revoke({user_id:999});assert.equal(access.allow({id:'revoked',streamPath,streamQuery:Object.fromEntries(new URLSearchParams(pubQuery))},'publish'),false);
  console.log('PASS NMS real + ffmpeg fixture: signed publisher/playback FLV, unsigned playback rejected, viewer cannot publish, grants revoked.');
 }finally{for(const child of children)child.kill('SIGTERM');nms.stop();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
