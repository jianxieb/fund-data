(function () {
  'use strict';
  let catalogPromise, indexCatalogPromise;
  const histories = new Map();
  function indexCatalog() {
    if (!indexCatalogPromise) indexCatalogPromise = (async () => {
      const response = await fetch(document.querySelector('#return-index-source').dataset.src);
      if (!response.ok) throw new Error('指数日线目录加载失败');
      return (await response.json()).assets;
    })().catch(error => { indexCatalogPromise = null; throw error; });
    return indexCatalogPromise;
  }
  async function catalog() {
    if (!catalogPromise) catalogPromise = (async () => {
      const portfolio = window.PORTFOLIO_CATALOG || await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = document.querySelector('#portfolio-source').dataset.src;
        script.onload = () => window.PORTFOLIO_CATALOG ? resolve(window.PORTFOLIO_CATALOG) : reject(new Error('标的库为空'));
        script.onerror = () => reject(new Error('标的库加载失败'));
        document.head.append(script);
      });
      return { assets: [...await indexCatalog(), ...portfolio.assets].map(window.ChanghengReturnComparisonModel.describeAsset), fx: portfolio.fx };
    })().catch(error => { catalogPromise = null; throw error; });
    return catalogPromise;
  }
  async function history(row) {
    if (row?.status !== 'available') throw new Error((row?.name || '标的') + '：' + (row?.missing || '缺日线'));
    if (!histories.has(row.id)) histories.set(row.id, (async () => {
      if (!/^data\/(?:portfolio\/[a-z]+|return-comparison)\/[\w-]+\.json$/.test(row.historyUrl || '')) throw new Error('历史文件路径无效');
      const response = await fetch(row.historyUrl);
      if (!response.ok) throw new Error(row.name + '：日线加载失败');
      const text = await response.text();
      if (globalThis.crypto?.subtle) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
        if (hash !== row.sha256) throw new Error(row.name + '：文件版本不一致，请刷新页面');
      }
      return window.ChanghengReturnComparisonModel.validate(row, JSON.parse(text));
    })().catch(error => { histories.delete(row.id); throw error; }));
    return histories.get(row.id);
  }
  window.ChanghengResearchHistory = { catalog, indexCatalog, history };
})();
