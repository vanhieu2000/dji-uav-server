/** Validate whole segments, including concave boundaries and polygon holes. WGS84 planning checks, not aircraft fence upload. */
const {ValidationError}=require('../utils/validate');
const eps=1e-10;
function polygon(raw){let g=typeof raw==='string'?JSON.parse(raw):raw;if(g?.type==='Feature')g=g.geometry;if(g?.type!=='Polygon'||!Array.isArray(g.coordinates)||!g.coordinates.length)throw new ValidationError('Cần ranh giới Polygon hợp lệ');
 for(const r of g.coordinates){if(!Array.isArray(r)||r.length<4||r.length>5000||r.some(p=>!Array.isArray(p)||p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90)||r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1])throw new ValidationError('Ranh giới cần khép kín, tọa độ WGS84 hữu hạn');}return g;
}
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0],sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
function on(p,a,b){return Math.abs(cross(sub(p,a),sub(b,a)))<eps&&p[0]>=Math.min(a[0],b[0])-eps&&p[0]<=Math.max(a[0],b[0])+eps&&p[1]>=Math.min(a[1],b[1])-eps&&p[1]<=Math.max(a[1],b[1])+eps;}
function ring(p,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){if(on(p,r[j],r[i]))return 2;if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])inside=!inside;}return inside?1:0;}
function inside(p,g){return ring(p,g.coordinates[0])>0&&!g.coordinates.slice(1).some(r=>ring(p,r)>0);}
function cuts(a,b,g){const out=[0,1],d=sub(b,a);for(const r of g.coordinates)for(let i=1;i<r.length;i++){const e=sub(r[i],r[i-1]),den=cross(d,e);if(Math.abs(den)<eps)continue;const q=sub(r[i-1],a),t=cross(q,e)/den,u=cross(q,d)/den;if(t>=0&&t<=1&&u>=0&&u<=1)out.push(t);}return [...new Set(out)].sort((a,b)=>a-b);}
function check(points,allowed,blocked=[]){const g=polygon(allowed),bs=blocked.map(polygon),ps=points.map(p=>[Number(p.lng),Number(p.lat)]);if(ps.length<2||ps.length>500)throw new ValidationError('Tuyến cần từ 2 đến 500 waypoint');
 for(let i=0;i<ps.length;i++)if(!inside(ps[i],g)||bs.some(b=>ring(ps[i],b.coordinates[0])>0&&!b.coordinates.slice(1).some(r=>ring(ps[i],r)>0)))throw new ValidationError(`Điểm ${i+1} nằm ngoài vùng an toàn hoặc trong vùng cấm`);
 for(let i=1;i<ps.length;i++){const a=ps[i-1],b=ps[i],ts=[...cuts(a,b,g),...bs.flatMap(z=>cuts(a,b,z))].sort((a,b)=>a-b);for(let j=1;j<ts.length;j++){const t=(ts[j-1]+ts[j])/2,p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];if(!inside(p,g)||bs.some(z=>inside(p,z)))throw new ValidationError(`Đoạn ${i} → ${i+1} vượt vùng an toàn hoặc đi qua vùng cấm`);}for(const z of bs){if(cuts(a,b,z).some(t=>t>eps&&t<1-eps))throw new ValidationError('Tuyến chạm biên vùng cấm');}for(const z of bs)for(const r of z.coordinates)for(let j=1;j<r.length;j++)if(on(a,r[j-1],r[j])||on(b,r[j-1],r[j])||on(r[j],a,b))throw new ValidationError('Tuyến chạm biên vùng cấm');}
 return true;
}
async function validate(query,plantId,points){if(!plantId)throw new ValidationError('Chọn nhà máy và khai báo ranh giới an toàn trước khi tạo tuyến');const [p]=await query('SELECT boundary_geojson FROM plants WHERE plant_id=?',[plantId]);if(!p?.boundary_geojson)throw new ValidationError('Nhà máy chưa có ranh giới an toàn đã xác nhận');const rows=await query('SELECT polygon_geojson FROM safety_exclusions WHERE plant_id=?',[plantId]);check(points,p.boundary_geojson,rows.map(r=>r.polygon_geojson));}
module.exports={polygon,check,validate};
