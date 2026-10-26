/* =====================================================================
   Trang "Cài đặt tài sản": 3 tab (Cây tài sản & bản đồ | Nhập Excel | Bản đồ nền).
     GIS.AssetsPage.open()   gọi khi chuyển sang view "assets"
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;

  const TABS = [
    ['tree', 'Cây tài sản & bản đồ'],
    ['profiles', 'Hồ sơ chụp'],
    ['flights', 'Lập đường bay'],
    ['history', 'Lịch sử chuyến bay'],
    ['vision', 'Xử lý Vision'],
    ['tasks', 'Nhiệm vụ kiểm tra'],
    ['insights', 'Cảnh báo & lịch sử nhiệt'],
    ['media', 'Nhập ảnh thẻ nhớ'],
    ['coverage', 'Kiểm tra đủ ảnh'],
    ['datasets', 'Xuất ảnh cho Vision'],
    ['import', 'Nhập Excel'],
    ['basemaps', 'Bản đồ nền']
  ];
  let current = 'tree';

  function show(root, tab) {
    current = tab;
    root.querySelectorAll('.gis-page-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    root.querySelectorAll('.gis-tab-pane').forEach(p => { p.hidden = p.dataset.pane !== tab; });
    const pane = root.querySelector(`.gis-tab-pane[data-pane="${tab}"]`);
    if (tab === 'tree') GIS.Assets.open(pane);
    if (tab === 'profiles') GIS.Profiles.render(pane);
    if (tab === 'flights') GIS.FlightPlans.render(pane);
    if (tab === 'insights') GIS.Insights.render(pane);
    if (tab === 'tasks') GIS.Tasks.render(pane);
    if (tab === 'vision') GIS.Vision.render(pane);
    if (tab === 'history') GIS.FlightHistory.render(pane);
    if (tab === 'media') GIS.MediaImport.render(pane);
    if (tab === 'coverage') GIS.Coverage.render(pane);
    if (tab === 'datasets') GIS.Datasets.render(pane);
    if (tab === 'import') GIS.Import.render(pane);
    if (tab === 'basemaps') GIS.BaseMaps.render(pane);
  }

  GIS.AssetsPage = {
    open() {
      const root = document.getElementById('gis-assets-root');
      if (!root) return;
      if (!root.dataset.ready) {
        root.dataset.ready = '1';
        root.innerHTML = `
          <div class="tabs gis-page-tabs" role="tablist">
            ${TABS.map(([k, label]) => `<button type="button" role="tab" data-tab="${k}">${label}</button>`).join('')}
          </div>
          ${TABS.map(([k]) => `<div class="gis-tab-pane" data-pane="${k}" hidden></div>`).join('')}`;
        root.querySelector('.gis-page-tabs').addEventListener('click', e => {
          const b = e.target.closest('[data-tab]');
          if (b) show(root, b.dataset.tab);
        });
      }
      show(root, current);
    }
  };
})();
