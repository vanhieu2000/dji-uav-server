/* G: cảnh báo và lịch sử nhiệt từ SQL; không dựng số liệu mẫu. */
(function(){
  'use strict';
  const GIS=window.GIS,esc=GIS.esc;let root=null,days=30,reportRequest=0;
  const STATUS={UNREAD:'Chưa xem',ACKNOWLEDGED:'Đã tiếp nhận',RESOLVED:'Đã xử lý',DISMISSED:'Đã loại'};
  function bars(rows,label,value,unit=''){
    if(!rows.length)return '<div class="gis-empty">Chưa có số liệu trong kỳ.</div>';
    const valid=rows.filter(r=>Number.isFinite(Number(r[value])));const max=Math.max(1,...valid.map(r=>Number(r[value])));
    return valid.map(r=>`<div style="margin:8px 0"><div>${esc(r[label])} <b>${esc(r[value])}${unit}</b></div><div style="height:9px;background:var(--line);border-radius:5px"><div style="height:9px;width:${Math.max(0,Number(r[value])/max*100)}%;background:var(--brand);border-radius:5px"></div></div></div>`).join('');
  }
  function line(rows,label,value){
    const data=rows.filter(r=>r[value]!=null&&Number.isFinite(Number(r[value])));
    if(!data.length)return '<div class="gis-empty">Chưa có số đo nhiệt đã xác nhận.</div>';
    const min=Math.min(...data.map(r=>Number(r[value]))),max=Math.max(...data.map(r=>Number(r[value])));
    const range=Math.max(1,max-min),n=Math.max(1,data.length-1);
    const pts=data.map((p,i)=>[35+i*560/n,170-(Number(p[value])-min)*140/range,p]);
    return `<svg viewBox="0 0 630 210" role="img" aria-label="Lịch sử nhiệt độ"><line x1="35" y1="180" x2="610" y2="180" stroke="currentColor"/><polyline points="${pts.map(p=>p[0]+','+p[1]).join(' ')}" fill="none" stroke="#cf2f5e" stroke-width="2"/>${pts.map(([x,y,p])=>`<circle cx="${x}" cy="${y}" r="4" fill="#cf2f5e"><title>${esc(p[label])}: ${esc(p[value])} °C</title></circle>`).join('')}<text x="5" y="25" font-size="12" fill="currentColor">${max.toFixed(1)} °C</text><text x="5" y="175" font-size="12" fill="currentColor">${min.toFixed(1)} °C</text><text x="35" y="200" font-size="10" fill="currentColor">${esc(data[0][label])}</text><text x="600" y="200" text-anchor="end" font-size="10" fill="currentColor">${esc(data[data.length-1][label])}</text></svg>`;
  }
  let alertRows=[],alertQuery='',alertStatus='',alertPage=1;
  function drawAlerts(){
    const rows=alertRows.filter(a=>(!alertStatus||a.status===alertStatus)&&(!alertQuery||(a.title+' '+a.message).toLocaleLowerCase('vi').includes(alertQuery))),pages=Math.max(1,Math.ceil(rows.length/(innerHeight<600?2:innerHeight<850?4:5)));alertPage=Math.min(alertPage,pages);
    const box=root.querySelector('#insight-alerts');box.innerHTML=`<form id="insight-list-filter" class="ui-filterbar"><label>Tìm cảnh báo<input class="input" name="q" placeholder="Tên hoặc nội dung sự cố"></label><label>Trạng thái<select class="input" name="status"><option value="">Tất cả</option>${Object.entries(STATUS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><button class="btn primary" type="submit">Lọc danh sách</button><button class="btn" type="button" data-alert-clear>Xóa lọc</button></form><div class="tbl-wrap"><table><thead><tr><th>Thời gian</th><th>Sự cố</th><th>Mức độ</th><th>Trạng thái</th><th>Xử lý</th></tr></thead><tbody>${rows.slice((alertPage-1)*(innerHeight<600?2:innerHeight<850?4:5),alertPage*(innerHeight<600?2:innerHeight<850?4:5)).map(a=>`<tr><td>${esc(new Date(a.created_at).toLocaleString('vi-VN'))}</td><td><div class="ui-row-title">${esc(a.title)}</div><details><summary>Nội dung chi tiết</summary><p>${esc(a.message)}</p><div id="alert-history-${a.alert_id}"></div></details></td><td>${esc(({CRITICAL:'Nghiêm trọng',WARNING:'Cảnh báo',INFO:'Thông tin'})[a.alert_level]||a.alert_level||'—')}</td><td>${esc(STATUS[a.status]||a.status)}</td><td><div class="actions"><button class="btn sm" data-alert="${a.alert_id}" data-status="ACKNOWLEDGED">Tiếp nhận</button><button class="btn sm" data-alert="${a.alert_id}" data-status="RESOLVED">Đã xử lý</button><button class="btn sm" data-alert="${a.alert_id}" data-status="DISMISSED">Loại</button><button class="btn sm" data-history="${a.alert_id}">Lịch sử</button></div></td></tr>`).join('')||'<tr><td colspan="5">Không có cảnh báo phù hợp.</td></tr>'}</tbody></table></div><div class="ui-pagination"><span>${rows.length} cảnh báo · Trang ${alertPage}/${pages} · Tối đa 500 cảnh báo gần nhất; báo cáo hỗ trợ toàn bộ dữ liệu.</span><div><button class="btn sm" type="button" data-alert-page="-1" ${alertPage===1?'disabled':''}>Trước</button> <button class="btn sm" type="button" data-alert-page="1" ${alertPage===pages?'disabled':''}>Sau</button></div></div>`;
    const f=box.querySelector('form');f.elements.q.value=alertQuery;f.elements.status.value=alertStatus;f.querySelector('[data-alert-clear]').onclick=()=>{alertQuery=alertStatus='';alertPage=1;GIS.Compact?.closeAll();drawAlerts();};f.onsubmit=e=>{e.preventDefault();alertQuery=f.elements.q.value.trim().toLocaleLowerCase('vi');alertStatus=f.elements.status.value;alertPage=1;drawAlerts();};
  }
  async function refreshAlerts(){
    try{
      const r=await GIS.api('GET','/api/insights/alerts');
      if(root&&root.isConnected&&root.querySelector('#insight-alerts')){
        alertRows=r.data;drawAlerts();
      }
    }catch(e){/* không thay lỗi mạng bằng dữ liệu mẫu */}
  }
  async function reports(){
    if(GIS.Reporting)return GIS.Reporting.reports();
    const box=document.getElementById('insights-reports-root');if(!box)return;
    const token=++reportRequest;
    const r=await GIS.run(()=>GIS.api('GET','/api/insights/charts?days='+days));if(!r||token!==reportRequest)return;
    const d=r.data;
    box.innerHTML=`<div class="page-head"><h1>Báo cáo & thống kê</h1><select id="insight-period"><option value="7">7 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option><option value="365">365 ngày</option></select></div><div class="grid g-2"><section class="card"><h2>Phiếu theo ngày</h2>${bars(d.tickets||[],'day','total')}</section><section class="card"><h2>Phân loại lỗi Vision</h2>${bars(d.defects||[],'code','total')}</section><section class="card"><h2>Tấm pin lỗi theo khu</h2>${bars(d.areas||[],'area_name','total')}</section><section class="card"><h2>Nhiệt độ cao nhất đã xác nhận</h2>${line(d.temperatures||[],'day','max_temp_c')}</section></div>`;
    box.querySelector('#insight-period').value=String(days);box.querySelector('#insight-period').onchange=e=>{days=Number(e.target.value);reports();};
    const dash=document.getElementById('dashboard-bar-chart');if(dash)dash.innerHTML=bars(d.tickets||[],'day','total');
  }
  GIS.Insights={reports,render(el){
    root=el;root.innerHTML=`<div class="card" style="padding:16px"><h2>Cảnh báo & lịch sử nhiệt</h2><div class="actions"><input id="insight-search" placeholder="Mã tấm pin / DCL / mối nối"><button class="btn" id="insight-find">Tìm tài sản</button><select id="insight-target"><option value="">Chưa chọn</option></select><button class="btn" id="insight-show">Xem lịch sử</button></div><div id="insight-trend"></div><details><summary>Ngưỡng riêng của tài sản</summary><form id="insight-rule"><label>Nhiệt độ °C <input name="max_temp_c" type="number" step="any"></label><label>ΔT °C <input name="delta_t_c" type="number" step="any"></label><label>Tin cậy <input name="min_confidence" type="number" step=".01" min="0" max="1" value="0.8" required></label><label>Cảnh báo sớm trong số ngày <input name="trend_horizon_days" type="number" min="0.1" step="any" placeholder="Không bật dự báo"></label><label><input type="checkbox" name="enabled"> Bật</label><button class="btn">Lưu ngưỡng</button></form></details><h3>DCL đã kiểm tra theo phiếu</h3><div class="actions"><select id="insight-ticket"><option value="">Tất cả phiếu</option></select><button class="btn" id="insight-dcls">Tải danh sách</button></div><div id="insight-dcl-table"></div><h3>Cảnh báo</h3><button class="btn sm" id="insight-refresh">Làm mới</button><div id="insight-alerts"></div></div>`;
    const target=()=>{const s=root.querySelector('#insight-target').value.split(':');if(!s[1])throw new Error('Chọn tài sản trước');return {type:s[0],id:s[1]};};
    root.querySelector('#insight-find').onclick=()=>GIS.run(async()=>{const r=await GIS.api('GET','/api/assets/search?q='+encodeURIComponent(root.querySelector('#insight-search').value));root.querySelector('#insight-target').innerHTML=r.data.filter(a=>['panel','disconnector','contact'].includes(a.type)).map(a=>`<option value="${a.type.toUpperCase()}:${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');});
    root.querySelector('#insight-show').onclick=()=>GIS.run(async()=>{
      const t=target(),r=await GIS.api('GET',`/api/insights/temperature?asset_type=${t.type}&asset_id=${t.id}`),d=r.data;
      const samples=d.samples.map(p=>({...p,date:new Date(p.captured_at).toLocaleString('vi-VN')})).reverse();
      root.querySelector('#insight-trend').innerHTML=`${line(samples,'date','max_temp_c')}<p>${d.trend.cycles} chu kỳ · thay đổi gần nhất ${d.trend.delta_per_cycle_c==null?'chưa đủ dữ liệu':d.trend.delta_per_cycle_c.toFixed(1)+' °C/chu kỳ'} · tốc độ ước lượng ${d.trend.slope_c_per_day==null?'chưa đủ dữ liệu':d.trend.slope_c_per_day.toFixed(2)+' °C/ngày'}</p><p>${d.trend.estimated_days_to_threshold==null?'Không có dự báo chạm ngưỡng.':'Ước lượng chạm ngưỡng sau '+d.trend.estimated_days_to_threshold.toFixed(1)+' ngày.'} Đây là xu hướng tuyến tính, không phải dự báo chắc chắn.</p>`;
      const f=root.querySelector('#insight-rule'),rule=d.rule||{};for(const k of ['max_temp_c','delta_t_c','min_confidence','trend_horizon_days'])f.elements[k].value=rule[k]??'';f.elements.enabled.checked=!!rule.enabled;
    });
    root.querySelector('#insight-rule').onsubmit=e=>{e.preventDefault();GIS.run(async()=>{const t=target(),f=e.target,n=k=>f.elements[k].value===''?null:Number(f.elements[k].value);await GIS.api('PUT',`/api/insights/rules/${t.type}/${t.id}`,{max_temp_c:n('max_temp_c'),delta_t_c:n('delta_t_c'),min_confidence:n('min_confidence'),trend_horizon_days:n('trend_horizon_days'),enabled:f.elements.enabled.checked});GIS.toast('Đã lưu ngưỡng riêng');});};
    root.querySelector('#insight-refresh').onclick=refreshAlerts;
    root.querySelector('#insight-alerts').onclick=e=>{if(e.target.closest('[data-alert-clear]')){alertQuery=alertStatus='';alertPage=1;drawAlerts();return;}const pager=e.target.closest('[data-alert-page]');if(pager){alertPage+=Number(pager.dataset.alertPage);drawAlerts();return;}const b=e.target.closest('[data-alert]'),h=e.target.closest('[data-history]');if(b)GIS.run(async()=>{await GIS.api('PATCH',`/api/insights/alerts/${b.dataset.alert}`,{status:b.dataset.status});refreshAlerts();});else if(h)GIS.run(async()=>{const r=await GIS.api('GET',`/api/insights/alerts/${h.dataset.history}/history`);const history=root.querySelector('#alert-history-'+h.dataset.history);history.closest('details').open=true;history.innerHTML=r.data.map(x=>`<div>${esc(STATUS[x.from_status])} → ${esc(STATUS[x.to_status])} · ${esc(new Date(x.changed_at).toLocaleString('vi-VN'))}</div>`).join('')||'Chưa đổi trạng thái.';});};
    root.querySelector('#insight-dcls').onclick=()=>GIS.run(async()=>{const tid=root.querySelector('#insight-ticket').value,r=await GIS.api('GET','/api/insights/disconnectors'+(tid?'?ticket_id='+tid:''));root.querySelector('#insight-dcl-table').innerHTML='<div class="tbl-wrap"><table><thead><tr><th>Dao cách ly</th><th>Pha</th><th>Nhiệt độ cao nhất</th><th>Ngưỡng cảnh báo</th><th>Số lần đo</th></tr></thead><tbody>'+r.data.map(d=>`<tr><td>${esc(d.dcl_code)}</td><td>${esc(d.phase)}</td><td>${d.max_temp_c==null?'Chưa đo':esc(d.max_temp_c)+' °C'}</td><td>${esc(d.max_allowed_temp)} °C</td><td>${esc(d.measurements??'—')}</td></tr>`).join('')+'</tbody></table></div>';});
    GIS.run(async()=>{const r=await GIS.api('GET','/api/tickets');root.querySelector('#insight-ticket').innerHTML='<option value="">Tất cả phiếu</option>'+r.data.map(t=>`<option value="${t.ticket_id}">${esc(t.ticket_code)}</option>`).join('');});
    refreshAlerts();
  }};
  GIS.on('runtime',msg=>{if(['vision_result','alert_status'].includes(msg.type)){refreshAlerts();if(GIS.Reporting)GIS.Reporting.overview();if(document.getElementById('view-reports').classList.contains('active'))reports();}});
  document.addEventListener('DOMContentLoaded',()=>{refreshAlerts();reports();});
})();
