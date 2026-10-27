/* =====================================================================
   Các màn hình nghiệp vụ mở trực tiếp từ sidebar; mỗi màn hình giữ vùng nội dung riêng.
     GIS.AssetsPage.open(tab) gọi bởi bộ điều hướng.
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;

  const TABS = ['tree','flights','history','vision','tasks','insights','media','coverage','datasets'].map(k=>[k,k]);

  function show(root, tab) {
    root.querySelectorAll('.gis-tab-pane').forEach(p => { p.hidden = p.dataset.pane !== tab; });
    const pane = root.querySelector(`.gis-tab-pane[data-pane="${tab}"]`);
    if (tab === 'tree') GIS.Assets.open(pane);
    if (tab === 'flights') GIS.FlightPlans.render(pane);
    if (tab === 'insights') GIS.Insights.render(pane);
    if (tab === 'tasks') GIS.Tasks.render(pane);
    if (tab === 'vision') GIS.Vision.render(pane);
    if (tab === 'history') GIS.FlightHistory.render(pane);
    if (tab === 'media') GIS.MediaImport.render(pane);
    if (tab === 'coverage') GIS.Coverage.render(pane);
    if (tab === 'datasets') GIS.Datasets.render(pane);
  }

  GIS.AssetsPage = {
    open(tab = 'tree') {
      const root = document.getElementById('gis-assets-root');
      if (!root) return;
      if (!root.dataset.ready) {
        root.dataset.ready = '1';
        root.innerHTML = `
          ${TABS.map(([k]) => `<div class="gis-tab-pane" data-pane="${k}" hidden></div>`).join('')}`;
      }
      show(root, TABS.some(([key])=>key===tab)?tab:'tree');
    }
  };
})();
