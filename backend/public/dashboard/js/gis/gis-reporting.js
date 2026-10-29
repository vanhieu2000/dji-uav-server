/* Read-only overview/report charts and a paginated incident register. No sample data. */
(()=>{
 'use strict';
 const GIS=window.GIS,esc=GIS.esc;
 const STATUS={UNREAD:'Chưa xem',ACKNOWLEDGED:'Đã tiếp nhận',RESOLVED:'Đã xử lý',DISMISSED:'Đã loại'};
 const TICKET={PENDING:'Chờ phân công',ASSIGNED:'Đã phân công',EXECUTING:'Đang kiểm tra',COMPLETED:'Hoàn tất',CANCELLED:'Đã hủy'};
 const LEVEL={INFO:'Thông tin',WARNING:'Cảnh báo',CRITICAL:'Nghiêm trọng'};
 const SEGMENT={PENDING:'#94a3b8',ASSIGNED:'#6b91ad',EXECUTING:'#e59a0c',COMPLETED:'#2f9e74',CANCELLED:'#7d8e93',CRITICAL:'#cf2f5e',WARNING:'#e59a0c',INFO:'#0d6e6e'};
 const DEFECT={HOTSPOT_PANEL:'Điểm nóng tấm pin',CRACKED_CELL:'Nứt tế bào pin',DIRT_DUST:'Bụi bẩn',DISCONNECTOR_OVERHEAT:'Dao cách ly quá nhiệt',CONTACT_DEFECT:'Lỗi mối nối',DCL_CONTACT_OVERHEAT:'Mối nối DCL quá nhiệt',OTHER:'Khác'};
 const COLORS=['#0d6e6e','#e59a0c','#6b91ad','#2f9e74','#cf2f5e'];
 const num=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
 const total=(rows,key='total')=>(rows||[]).reduce((n,r)=>n+num(r[key]),0);
 const empty=message=>`<div class="gis-empty">${message||'Chưa có dữ liệu trong kỳ đã chọn.'}</div>`;
 const date=v=>v?new Date(v).toLocaleString('vi-VN'):'—';
 const badge=(value,labels)=>`<span class="tag ${['CRITICAL','UNREAD'].includes(value)?'bad':['WARNING','ACKNOWLEDGED'].includes(value)?'warn':value==='RESOLVED'?'ok':'info'}">${esc(labels[value]||value||'—')}</span>`;
 const fail=(el,error)=>{if(el)el.innerHTML=`<p class="gis-empty gis-error" role="status">${esc(error.message)}. Vui lòng thử làm mới.</p>`;};
 function columns(rows){
  if(!rows?.length)return empty();
  const data=rows.slice(-14),max=Math.ceil(Math.max(1,...data.map(r=>num(r.total)))/2)*2,step=552/data.length,w=Math.min(34,step*.62);
  return `<svg class="chart-svg" viewBox="0 0 620 225" role="img" aria-label="Biểu đồ số phiếu tạo theo ngày và số đã hoàn tất">${[0,.5,1].map(f=>`<line x1="40" x2="605" y1="${175-f*140}" y2="${175-f*140}" stroke="var(--line)"/><text x="32" y="${179-f*140}" text-anchor="end" font-size="11" fill="currentColor">${Math.ceil(max*f)}</text>`).join('')}${data.map((r,i)=>{const x=48+i*step+(step-w)/2,h=num(r.total)/max*140,c=Math.min(num(r.total),num(r.completed))/max*140;return `<g><title>${esc(r.day)}: ${num(r.total)} phiếu, ${num(r.completed)} đã hoàn tất</title><rect x="${x}" y="${175-h}" width="${w}" height="${h}" rx="3" fill="#b8d9d2"/><rect x="${x}" y="${175-c}" width="${w}" height="${c}" rx="3" fill="#0d6e6e"/><text x="${x+w/2}" y="${168-h}" text-anchor="middle" font-size="11" fill="currentColor">${num(r.total)}</text><text transform="translate(${x+w/2},194) rotate(-35)" text-anchor="end" font-size="10" fill="currentColor">${esc(String(r.day).slice(5))}</text></g>`;}).join('')}</svg><div class="chart-legend"><span><i style="background:#0d6e6e"></i>Đã hoàn tất</span><span><i style="background:#b8d9d2"></i>Chưa hoàn tất / đã hủy</span></div><p class="chart-note">Theo ngày tạo phiếu · tối đa 14 ngày có phát sinh gần nhất.</p>`;
 }
 function donut(rows,key,labels){
  const data=(rows||[]).filter(r=>num(r.total)>0),sum=total(data);if(!sum)return empty();let offset=0;
  return `<div class="status-chart"><svg viewBox="0 0 140 140" role="img" aria-label="Phân bố theo trạng thái"><circle cx="70" cy="70" r="48" fill="none" stroke="var(--line)" stroke-width="17"/>${data.map((r,i)=>{const length=num(r.total)/sum*301.593,o=offset;offset+=length;return `<circle cx="70" cy="70" r="48" fill="none" stroke="${SEGMENT[r[key]]||COLORS[i%COLORS.length]}" stroke-width="17" stroke-dasharray="${length} ${301.593-length}" stroke-dashoffset="${-o}" transform="rotate(-90 70 70)"><title>${esc(labels[r[key]]||r[key])}: ${num(r.total)}</title></circle>`;}).join('')}<text x="70" y="72" text-anchor="middle" font-size="25" font-weight="700" fill="currentColor">${sum}</text><text x="70" y="91" text-anchor="middle" font-size="11" fill="currentColor">Tổng số</text></svg><div class="chart-legend">${data.map((r,i)=>`<span><i style="background:${SEGMENT[r[key]]||COLORS[i%COLORS.length]}"></i>${esc(labels[r[key]]||r[key])}: <b>${num(r.total)}</b></span>`).join('')}</div></div>`;
 }
 function horizontal(rows,label){
  if(!rows?.length)return empty();const data=rows.slice(0,7),max=Math.max(1,...data.map(r=>num(r.total))),height=data.length*43+12;
  return `<svg class="chart-svg" viewBox="0 0 620 ${height}" role="img" aria-label="Biểu đồ phân bố lỗi">${data.map((r,i)=>{const l=String(r[label]||'Chưa phân loại'),y=i*43;return `<g><title>${esc(l)}: ${num(r.total)}</title><text x="0" y="${y+14}" font-size="12" fill="currentColor">${esc(l.length>52?l.slice(0,49)+'…':l)}</text><rect x="0" y="${y+22}" width="565" height="10" rx="5" fill="var(--line)"/><rect x="0" y="${y+22}" width="${num(r.total)/max*565}" height="10" rx="5" fill="${COLORS[i%COLORS.length]}"/><text x="605" y="${y+31}" text-anchor="end" font-size="12" fill="currentColor">${num(r.total)}</text></g>`;}).join('')}</svg>${rows.length>7?'<p class="chart-note">7 nhóm nhiều lỗi nhất.</p>':''}`;
 }
 function temperature(rows){
  const data=(rows||[]).filter(r=>r.max_temp_c!=null&&Number.isFinite(Number(r.max_temp_c))).slice(-30);if(!data.length)return empty('Chưa có số đo nhiệt đã xác nhận trong kỳ.');
  const lo=Math.min(...data.map(r=>Number(r.max_temp_c))),hi=Math.max(...data.map(r=>Number(r.max_temp_c))),range=Math.max(1,hi-lo),n=Math.max(1,data.length-1);
  const points=data.map((r,i)=>({x:50+i*530/n,y:165-(Number(r.max_temp_c)-lo)/range*125,r}));
  return `<svg class="chart-svg" viewBox="0 0 620 210" role="img" aria-label="Nhiệt độ cao nhất đã xác nhận theo ngày"><line x1="50" x2="590" y1="175" y2="175" stroke="var(--line)"/><polyline points="${points.map(p=>p.x+','+p.y).join(' ')}" fill="none" stroke="#cf2f5e" stroke-width="3"/>${points.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#cf2f5e"><title>${esc(p.r.day)}: ${Number(p.r.max_temp_c).toFixed(1)} °C</title></circle>`).join('')}<text x="5" y="30" font-size="12" fill="currentColor">${hi.toFixed(1)}°C</text><text x="5" y="175" font-size="12" fill="currentColor">${lo.toFixed(1)}°C</text><text x="50" y="198" font-size="11" fill="currentColor">${esc(data[0].day)}</text><text x="590" y="198" text-anchor="end" font-size="11" fill="currentColor">${esc(data[data.length-1].day)}</text></svg><p class="chart-note">Tối đa 30 ngày có số đo gần nhất.</p>`;
 }
 let overviewRequest=0;
 async function overview(){
  const id=++overviewRequest,period=document.getElementById('dashboard-period')?.value||'30';
  const chart=document.getElementById('dashboard-bar-chart'),alerts=document.getElementById('dashboard-alerts-list');
  await Promise.all([
   GIS.api('GET','/api/insights/charts?days='+period).then(r=>{if(id!==overviewRequest)return;const d=r.data;chart.innerHTML=columns(d.tickets);document.getElementById('dashboard-status-chart').innerHTML=donut(d.statuses,'status',TICKET);document.getElementById('dashboard-area-chart').innerHTML=horizontal(d.areas,'area_name');}).catch(e=>{if(id===overviewRequest){fail(chart,e);document.getElementById('dashboard-status-chart').innerHTML='';fail(document.getElementById('dashboard-area-chart'),e);}}),
   GIS.api('GET','/api/insights/alert-report?days=all&page_size=5').then(r=>{if(id!==overviewRequest)return;alerts.innerHTML=r.data.items.slice(0,5).map(a=>`<article class="overview-issue" data-level="${esc(a.alert_level)}"><span class="severity-mark" aria-hidden="true"></span><div><b>${esc(a.title)}</b><small>${esc(date(a.created_at))}${a.ticket_code?' · '+esc(a.ticket_code):''}</small></div>${badge(a.status,STATUS)}</article>`).join('')||empty('Chưa ghi nhận sự cố.');}).catch(e=>{if(id===overviewRequest)fail(alerts,e);})
  ]);
 }
 let days='30',page=1,q='',status='',level='',reportRequest=0,tableRequest=0,focusTable=false;
 async function table(box,request){
  const id=++tableRequest,el=box.querySelector('#report-issue-table');el.innerHTML=empty('Đang tải bảng sự cố…');
  const params=new URLSearchParams({days,page:String(page),page_size:String(innerHeight<550?1:5),q,status,level});
  try{
   const r=await GIS.api('GET','/api/insights/alert-report?'+params);if(id!==tableRequest||request!==reportRequest)return;const d=r.data;
   const image=url=>{try{const u=new URL(url,location.origin);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?`<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">Xem ảnh</a>`:'';}catch{return '';}};
   el.innerHTML=`<div class="tbl-wrap"><table class="report-table"><thead><tr><th>Thời gian</th><th>Phiếu</th><th>Sự cố / cảnh báo</th><th>Mức độ</th><th>Trạng thái</th><th>Ảnh</th></tr></thead><tbody>${d.items.map(a=>`<tr data-report-alert="${a.alert_id}"><td>${esc(date(a.created_at))}</td><td>${esc(a.ticket_code||'Chưa gắn phiếu')}</td><td><div class="issue-title">${esc(a.title)}</div><details><summary>Nội dung chi tiết</summary><p>${esc(a.message)}</p>${a.defect_code?`<small>Loại lỗi: ${esc(a.defect_code)}</small>`:''}${a.max_temperature!=null?`<p>Nhiệt độ: ${esc(a.max_temperature)} °C</p>`:''}</details></td><td>${badge(a.alert_level,LEVEL)}</td><td>${badge(a.status,STATUS)}</td><td>${a.file_url?image(a.file_url):'—'}</td></tr>`).join('')||'<tr><td colspan="6">Không có sự cố phù hợp với bộ lọc.</td></tr>'}</tbody></table></div><div class="report-pagination"><span>${d.total?`${(d.page-1)*d.page_size+1}–${Math.min(d.page*d.page_size,d.total)}`:'0'} / ${d.total} sự cố · Trang ${d.page}/${Math.max(1,Math.ceil(d.total/d.page_size))}</span><div class="actions"><button class="btn sm" id="report-prev" ${d.page<=1?'disabled':''}>← Trước</button><button class="btn sm" id="report-next" ${d.page*d.page_size>=d.total?'disabled':''}>Sau →</button></div></div>`;
   el.querySelector('#report-prev').onclick=()=>{page--;table(box,request);};el.querySelector('#report-next').onclick=()=>{page++;table(box,request);};
  }catch(e){if(id===tableRequest&&request===reportRequest)fail(el,e);}
 }
 async function reports(){
  const box=document.getElementById('insights-reports-root');if(!box)return;const request=++reportRequest,jumpToTable=focusTable;focusTable=false;
  box.innerHTML=`<div class="page-head"><div><h1>Báo cáo & thống kê</h1><p class="muted">Biểu đồ kiểm tra và bảng sự cố theo kỳ đã chọn.</p></div><div class="actions"><select class="input" id="insight-period" aria-label="Kỳ báo cáo"><option value="7">7 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option><option value="365">1 năm</option><option value="all">Tất cả thời gian</option></select><button class="btn" id="report-refresh">Làm mới</button></div></div><div id="report-visuals">${empty('Đang tải biểu đồ…')}</div><section class="card" id="report-register"><div class="card-head"><h2>Bảng sự cố & cảnh báo</h2><div class="r"><button class="btn sm" onclick="switchView('alerts')">Xử lý cảnh báo →</button></div></div><form class="report-filters" id="report-filter-form"><label class="field">Tìm theo tên sự cố, nội dung hoặc mã phiếu<input class="input" name="q" maxlength="150" placeholder="Nhập từ khóa…"></label><label class="field">Mức độ<select class="input" name="level"><option value="">Tất cả</option>${Object.entries(LEVEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label class="field">Trạng thái<select class="input" name="status"><option value="">Tất cả</option>${Object.entries(STATUS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><button class="btn primary" type="submit">Lọc bảng</button><button class="btn" type="button" id="report-clear">Xóa lọc</button></form><div id="report-issue-table"></div></section>`;
  const period=box.querySelector('#insight-period');period.value=days;period.onchange=()=>{days=period.value;page=1;reports();};box.querySelector('#report-refresh').onclick=reports;
  const f=box.querySelector('#report-filter-form');f.elements.q.value=q;f.elements.status.value=status;f.elements.level.value=level;
  f.onsubmit=e=>{e.preventDefault();q=f.elements.q.value.trim();status=f.elements.status.value;level=f.elements.level.value;page=1;table(box,request);};
  box.querySelector('#report-clear').onclick=()=>{q=status=level='';page=1;reports();};
  await Promise.all([
   GIS.api('GET','/api/insights/charts?days='+days).then(r=>{if(request!==reportRequest)return;const d=r.data;box.querySelector('#report-visuals').innerHTML=`<div class="report-kpis">${[['Phiếu trong kỳ',total(d.tickets)],['Phiếu đã hoàn tất',total((d.statuses||[]).filter(r=>r.status==='COMPLETED'))],['Lỗi Vision phát hiện',total(d.defects)],['Sự cố & cảnh báo',total(d.levels)]].map(([label,value])=>`<div class="card"><span class="muted">${label}</span><b class="num">${value}</b></div>`).join('')}</div><div class="report-charts"><section class="card"><h2>Phiếu kiểm tra theo ngày</h2>${columns(d.tickets)}</section><section class="card"><h2>Trạng thái phiếu</h2>${donut(d.statuses,'status',TICKET)}</section><section class="card"><h2>Phân loại lỗi Vision</h2>${horizontal((d.defects||[]).map(r=>({...r,label:DEFECT[r.code]||r.code})),'label')}</section><section class="card"><h2>Mức độ sự cố</h2>${donut(d.levels,'level',LEVEL)}</section><section class="card"><h2>Khu vực có tấm pin lỗi</h2>${horizontal(d.areas,'area_name')}</section><section class="card"><h2>Nhiệt độ cao nhất đã xác nhận</h2>${temperature(d.temperatures)}</section></div>`;}).catch(e=>{if(request===reportRequest)fail(box.querySelector('#report-visuals'),e);}),
   table(box,request)
  ]);
  if(jumpToTable&&request===reportRequest)box.querySelector('#report-register').scrollIntoView({block:'start'});
 }
 GIS.Reporting={reports,overview};GIS.Insights.overview=overview;
 GIS.Insights.openReports=all=>{days=all?'all':document.getElementById('dashboard-period').value;page=1;q=status=level='';focusTable=!!all;window.switchView('reports');};
 document.addEventListener('DOMContentLoaded',overview);
})();
