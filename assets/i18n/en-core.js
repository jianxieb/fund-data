/* English text for the page frame and wording shared by every page. Keys are the Chinese text; see docs/i18n.md. */
(function (root, factory) {
  const entries = factory();
  if (typeof module === 'object' && module.exports) module.exports = entries;
  else root.ChanghengI18n.add('en', entries);
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  return {
    // Brand and page frame
    '长衡': 'Changheng',
    '长衡首页': 'Changheng home',
    '长衡 · 全球投资研究工作台': 'Changheng · Global Investment Research Workbench',
    '长衡 · {*}': 'Changheng · {*0}',
    '长衡：面向中国个人投资者的全球投资研究工作台。理解市场、研究资产、检验投资方案，结合历史回测、组合模拟、税费与跨境资金路径。':
      'Changheng: a global investment research workbench for individual investors in China. Understand markets, research assets and test investment plans with historical backtests, portfolio simulation, taxes and fees, and cross-border money routes.',
    '跳转到主要内容': 'Skip to main content',
    '主导航': 'Main navigation',
    '理解市场，检验方案。': 'Understand markets. Test plans.',
    '资产 · 风险 · 成本': 'Assets · Risk · Cost',

    // Navigation groups and pages (also the page titles)
    '研究对象': 'Markets & assets',
    '全球金融': 'Global finance',
    '研究方法': 'Research methods',
    '组合研究': 'Portfolio research',
    '研究总览': 'Research overview',
    '指数观察': 'Index watch',
    '历史分位': 'Historical percentiles',
    '基金研究': 'Fund research',
    '个股深入': 'Stock deep dives',
    '金融传导': 'Financial transmission',
    '历史事件': 'Historical events',
    '事件后表现': 'Post-event performance',
    '持有期研究': 'Holding-period study',
    '投入策略': 'Investing strategies',
    '投资渠道': 'Investment channels',
    '跨境资金': 'Cross-border money flow',
    '收益对比': 'Return comparison',
    '组合模拟': 'Portfolio simulator',
    '数据与方法': 'Data & methods',
    '行情条件后表现': 'Performance after market conditions',
    '中期选举后表现': 'Performance after US midterm elections',
    '均线穿越后表现': 'Performance after moving-average crossovers',
    '深入报告': 'In-depth reports',
    '全球投资研究工作台': 'Global Investment Research Workbench'
  };
});
