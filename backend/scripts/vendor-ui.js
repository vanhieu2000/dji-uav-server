/** Reproducible UI assets; checked into git so runtime works without CDN or dev dependencies. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../public/dashboard/vendor'),modules=path.resolve(__dirname,'../node_modules');
const packages=[
 {name:'leaflet',dir:'leaflet',files:['dist/leaflet.js','dist/leaflet.css'],license:'LICENSE'},
 {name:'@geoman-io/leaflet-geoman-free',dir:'geoman',files:['dist/leaflet-geoman.min.js','dist/leaflet-geoman.css'],license:'LICENSE'},
 {name:'flv.js',dir:'flv',files:['dist/flv.min.js'],license:'LICENSE'},
 {name:'@e965/xlsx',dir:'xlsx',files:['dist/xlsx.full.min.js'],license:'LICENSE'}
];
const manifest=[];
for(const item of packages){
 const pkgRoot=path.join(modules,item.name),pkg=JSON.parse(fs.readFileSync(path.join(pkgRoot,'package.json'),'utf8')),dest=path.join(root,item.dir);fs.mkdirSync(dest,{recursive:true});
 for(const file of [...item.files,item.license]){
  const input=path.join(pkgRoot,file),out=path.join(dest,path.basename(file));fs.copyFileSync(input,out);const bytes=fs.readFileSync(out);manifest.push({package:item.name,version:pkg.version,path:path.relative(root,out).replaceAll(path.sep,'/'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 if(item.name==='leaflet')fs.cpSync(path.join(pkgRoot,'dist/images'),path.join(dest,'images'),{recursive:true});
}
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log('UI assets và license đã chép từ các dependency đã khóa trong package-lock.json.');
