const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
test('Dashboard and Pilot inline scripts compile; Gateway has no ticket selector',()=>{for(const f of ['dashboard/index.html','pilot-login/index.html']){const s=fs.readFileSync(path.join(__dirname,'../public',f),'utf8');let i=0;for(const m of s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(!m[1].includes('src='))new vm.Script(m[2],{filename:f+':'+(++i)});}if(f.includes('pilot'))assert.doesNotMatch(s,/id="ticketSelect"/);}});
test('Geofence: endpoints are insufficient; concave segments, holes and exclusions are blocked',()=>{
 const {check}=require('../src/services/safetyGeofence'),p=ring=>({type:'Polygon',coordinates:[ring]}),box=p([[0,0],[4,0],[4,4],[0,4],[0,0]]),line=(a,b)=>[{lng:a[0],lat:a[1]},{lng:b[0],lat:b[1]}];
 assert.equal(check(line([.2,.2],[3.8,3.8]),box),true);
 assert.throws(()=>check(line([.2,.2],[5,3]),box));
 const exclusion=p([[1,1],[2,1],[2,2],[1,2],[1,1]]);assert.throws(()=>check(line([.5,1.5],[3,1.5]),box,[exclusion]));
 assert.throws(()=>check(line([.5,1],[3,1]),box,[exclusion]));
 const concave=p([[0,0],[4,0],[4,4],[3,4],[3,1],[1,1],[1,4],[0,4],[0,0]]);assert.throws(()=>check(line([.5,3],[3.5,3]),concave));
 const holed={...box,coordinates:[...box.coordinates,exclusion.coordinates[0]]};assert.throws(()=>check(line([.5,1.5],[3,1.5]),holed));
});
test('KMZ: preserve per-waypoint speed, pitch, hover and lenses, both generation paths',()=>{
 const b=require('../src/services/wpmlBuilder');const raw=[{lat:11,lng:107,alt:30,speed:1,gimbalPitch:-90,hoverTime:1,lenses:'wide'},{lat:11.001,lng:107.001,alt:40,speed:2,gimbalPitch:-45,hoverTime:4,lenses:'ir'}];
 const r=b.buildManualKmz({name:'Fixture',waypoints:raw,altitude:30,speed:3});assert.deepEqual([...r.waylines.matchAll(/<wpml:waypointSpeed>([^<]+)/g)].map(x=>Number(x[1])),[1,2]);assert.match(r.waylines,/<wpml:hoverTime>4<\/wpml:hoverTime>/);assert.match(r.waylines,/<wpml:payloadLensIndex>ir<\/wpml:payloadLensIndex>/);
 const points=raw.map(p=>({lat:p.lat,lng:p.lng,altitude_m:p.alt,speed_mps:p.speed,gimbal_pitch:p.gimbalPitch,hover_seconds:p.hoverTime,lenses:p.lenses}));const q=b.buildPointsKmz({name:'Fixture',points,profile:{lenses:'wide,ir',photos_per_point:1},speed:3});assert.match(q.waylines,/<wpml:waypointSpeed>2<\/wpml:waypointSpeed>/);assert.match(q.waylines,/<wpml:hoverTime>4<\/wpml:hoverTime>/);
});
test('RTK waypoint error: 1.5m threshold, missing RTK is unknown; mismatch cannot autoassign',async()=>{
 const {assess}=require('../src/services/waypointReconciliation'),point={lat:0,lng:0},offset=m=>({latitude:m/6371008.8*180/Math.PI,longitude:0,rtk_flag:50});
 assert.equal(assess(offset(1.49),point).waypoint_check,'PASS');assert.equal(assess(offset(1.51),point).waypoint_check,'OFFSET');assert.equal(assess({...offset(0),rtk_flag:16},point).waypoint_check,'UNKNOWN');
 const {resolveAssignment}=require('../src/services/mediaAssignment');for(const state of ['MISMATCH','UNKNOWN']){let calls=0;const r=await resolveAssignment(async(sql)=>{calls++;if(sql.includes('ticket_executions'))return [];return [{session_id:1,aircraft_sn:'UAV1234',ticket_id:7,route_verification:state}];},{uploadNamespace:'fixture'},{captured_at:new Date()});assert.equal(r.ticketId,null);assert.ok(calls<=2);}
});
test('Gateway stream has stable authenticated path and nullable ticket',async()=>{const {channelFor,createMonitoring}=require('../src/services/liveMonitoring');let args;const m=createMonitoring({query:async(sql,p)=>{args=p;return [];}});const s=await m.ensureStream(null,'UAV1234');assert.match(s.streamPath,/^\/live\/gateway_[a-f0-9]{16}$/);assert.equal(args[0],null);assert.equal(s.ticket_id,null);});
