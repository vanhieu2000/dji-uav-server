const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uav-diagnostics-test-'));process.env.UAV_LOG_DIR=dir;const d=require('../src/services/diagnostics');
test('diagnostic logs redact secrets, preserve correlation, sample OSD, export no private files',async()=>{
 const fixture={password:'secret-password-fixture',token:'secret-token-fixture',license:{appKey:'secret-app-fixture'},nested:{authorization:'Bearer secret-auth-fixture'},url:'rtmp://localhost/live/a?sign=secret-sign-fixture&grant=secret-grant-fixture',id:'UAV1234',result:0};
 d.write('request',fixture);d.mqtt('thing/product/UAV1234/osd',{timestamp:1});d.mqtt('thing/product/UAV1234/osd',{timestamp:2});d.mqtt('thing/product/RC1234/services_reply',{tid:'tid-fixture',data:{result:0}});await d.flush();
 const files=fs.readdirSync(dir);assert.ok(files.length);const contents=files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');for(const secret of ['secret-password-fixture','secret-token-fixture','secret-app-fixture','secret-auth-fixture','secret-sign-fixture','secret-grant-fixture'])assert.ok(!contents.includes(secret));assert.match(contents,/tid-fixture/);
 const rows=contents.trim().split('\n').map(JSON.parse);assert.equal(rows.filter(r=>r.kind==='mqtt'&&r.data.topic.endsWith('/osd')).length,1);
 fs.writeFileSync(path.join(dir,'do-not-export.env'),'private-env-fixture');const zip=new(require('adm-zip'))(await d.bundle());assert.ok(zip.getEntry('manifest.json'));assert.ok(!zip.getEntries().some(e=>e.entryName.endsWith('.env')));assert.ok(zip.getEntries().every(e=>e.entryName==='manifest.json'||e.entryName.startsWith('logs/')));
 fs.rmSync(dir,{recursive:true,force:true});
});
