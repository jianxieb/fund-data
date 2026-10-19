// One company list for the product. Source files retain the evidence's provenance.
const legacyBusinesses = {
  AMPX: ['materials', '设计和销售高能量密度硅负极电芯，面向无人机、电动航空等客户。'],
  '688389': ['health', '销售临床诊断仪器、配套试剂及治疗康复设备。'],
  ACMR: ['semis', '向晶圆厂销售清洗、电镀及其他半导体工艺设备。'],
  INOD: ['software', '为AI模型开发商提供训练数据、评测和数据工程服务。'],
  OUST: ['semis', '销售激光雷达及感知软件，用于工业、交通和机器人。'],
  '688050': ['health', '销售人工晶状体、角膜塑形镜和隐形眼镜等眼科产品。'],
  AEHR: ['semis', '向芯片厂销售老化测试设备、接触器及配套服务。'],
  '300832': ['health', '销售化学发光免疫分析仪器及持续消耗的检测试剂。'],
  '688603': ['materials', '为PCB及先进封装制造提供电子化学品。'],
  PDFS: ['software', '为半导体制造提供良率、测试和生产数据分析软件。'],
  '300054': ['materials', '供应半导体抛光材料、显示材料及打印耗材。'],
  RDW: ['space', '为航天和国防客户提供太空基础设施、任务组件及无人系统。'],
  '603061': ['semis', '制造用于半导体封装测试的分选机。'],
  COHU: ['semis', '供应半导体测试、检测和处理设备及接触器。'],
  '688677': ['health', '供应医用内窥镜光学器件、组件和成像产品。'],
  GCT: ['consumer', '经营大件商品交易与仓储物流平台。'],
  '688150': ['materials', '供应OLED发光材料及相关中间体。'],
  VICR: ['semis', '销售高密度电源转换模块，并许可相关电源技术。'],
  '688361': ['semis', '为晶圆制造提供量测与缺陷检测设备。'],
  XPER: ['software', '向电视及汽车客户提供娱乐软件、内容发现和广告服务。'],
  CEVA: ['semis', '许可无线连接、感知和边缘AI芯片IP，并收取量产版税。'],
  AIP: ['semis', '向芯片设计商许可片上互联及验证相关IP。'],
  '688167': ['semis', '提供半导体激光、光学组件及光通信相关产品。'],
  AOSL: ['semis', '设计和制造计算、消费及工业应用的功率半导体。'],
  HIMX: ['semis', '设计显示驱动芯片、图像及光学相关芯片。'],
  AMBA: ['semis', '设计用于汽车、安防和机器人视觉的边缘AI芯片。'],
  '688582': ['semis', '设计和销售MEMS惯性传感器及相关芯片。']
};
const groups = [
  ['infra', '数据中心与电力'], ['semis', '半导体与电子'],
  ['software', '软件与数据服务'], ['space', '航天与国防'],
  ['materials', '先进材料与制造'], ['finance', '金融与支付'],
  ['consumer', '消费与渠道'], ['health', '医疗与生物技术']
];
function groupFor(name) {
  if (/卫星|航天|国防|核能|核燃料|无人机|自动驾驶|机器人配送/.test(name)) return 'space';
  if (/医药|药物|医疗|生物|诊断|健康/.test(name)) return 'health';
  if (/金融|支付|信贷|保险|跨境汇款/.test(name)) return 'finance';
  if (/芯片|半导体|封装|电子|光通信|光互联|测试/.test(name)) return 'semis';
  if (/基础设施|存储|电力|配电|机房/.test(name)) return 'infra';
  if (/电池|材料|声呐|碳|制造/.test(name)) return 'materials';
  if (/电商|大件|渠道/.test(name)) return 'consumer';
  return 'software';
}
const remap = (value, ids) => typeof value === 'string' ? (ids.get(value) || value)
  : Array.isArray(value) ? value.map(v => remap(v, ids))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v,ids)])) : value;
function canonicalMarket(value) {
  const market=String(value).toLowerCase();
  if (!['us','cn'].includes(market)) throw new Error('Unsupported research market: '+value);
  return market;
}
export function buildCatalog(history, legacy) {
  const companies = [], sources = [], seen = new Set();
  const attachSources = (items, prefix) => {
    const ids = new Map(items.map(s => [s.id, prefix + s.id]));
    sources.push(...items.map(s=>({...s,id:ids.get(s.id),publishedAt:s.publishedAt || s.retrievedAt || legacy.reviewedAt,locator:s.locator || s.period || '既有研究来源'})));
    return ids;
  };
  for (const [index,d] of history.entries()) {
    const ids=attachSources(d.sources, 'screen'+index+':');
    for (const original of d.companies) {
      const market=canonicalMarket(original.market);
      const key=market+':'+original.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const c=remap(structuredClone(original),ids);
      const sector=d.sectors.find(s=>s.id===original.sector);
      const industry=sector?.name || original.sector;
      Object.assign(c, {
        market, sector: original.catalogSector || groupFor(industry), industryDetail:industry,
        reviewedAt:original.reviewedAt || d.reviewedAt,
        quoteSource:ids.get('screen-quotes'), priceBasis:d.priceBasis,
        priorityRank:original.priorityRank ?? (c.selected ? 10 : c.priority==='次级观察' ? 30 : c.research?.modelStatus==='withdrawn' ? 100 : 60),
        quote:{...c.quote, priceValue:c.quote.priceValue ?? c.quote.priceUsd, currency:c.quote.currency || (c.market==='cn'?'CNY':'USD')}
      });
      companies.push(c);
    }
  }
  const legacyIds=attachSources(legacy.sources,'legacy:');
  for (const [kind,items] of [['company',legacy.companies],['comparison',legacy.comparisons]]) for (const c of items) {
    const market=canonicalMarket(c.market);
    const key=market+':'+c.id;
    if (seen.has(key)) {
      companies.find(existing=>existing.market===market && existing.id===c.id).legacyReference={kind,id:c.id,reportPath:'docs/research/potential-stocks-2026-10-18.md'};
      continue;
    }
    seen.add(key);
    const [sector,business]=legacyBusinesses[c.id] || [];
    if (!business) throw new Error('Missing legacy business summary: '+c.id);
    const isCompany=kind==='company';
    const evidence=isCompany ? c.facts : [{label:'既有财务证据',text:c.facts,sources:c.sources}];
    const sourceIds=[...new Set(evidence.flatMap(f=>f.sources))].map(id=>legacyIds.get(id));
    if (sourceIds.some(id=>!id)) throw new Error('Missing legacy source: '+c.id);
    const judgment=isCompany ? c.decision : c.judgment;
    const gaps=isCompany ? c.gaps.join('；') : c.gaps;
    companies.push({
      id:c.id,name:c.name,market,sector,industryDetail:c.sector || groups.find(g=>g[0]===sector)[1],
      selected:false,priority:'保留观察',priorityRank:70,stage:'既有研究；未列当前优先',
      reviewedAt:legacy.reviewedAt,tenfold:'尚不支持',business,businessBrief:business,
      opportunity:isCompany ? c.thesis[0] : c.facts,
      profitMechanism:isCompany ? c.economics : '此前已记录的经营证据：'+c.facts,
      profitBrief:isCompany ? c.tagline : c.facts,
      judgment,startingValue:'既有判断使用'+c.price.asOf+'股价；没有因合并目录刷新报价或重新授予入选资格。',
      capitalBasis:'此前假设和股本口径保留在公司原始材料中。',priceBasis:'历史收盘价，原币种，未复权；请结合标注日期。',
      quote:{priceValue:c.price.value,currency:c.currency,date:c.price.asOf,label:c.price.asOf+' · 收盘',sessionLabel:'收盘',sourceUrl:c.price.url},
      facts:remap(evidence.map(f=>({label:f.label || '既有证据',...f})),legacyIds),
      check:{question:'此前证据支持什么判断？',answer:judgment,sources:sourceIds},
      risks:[gaps],upgrade:isCompany ? c.milestones[0].test : c.next,
      downgrade:isCompany ? c.withdraw.join('；') : '既有增长、回款或资本假设被实际披露否定时下调。',
      nextQuestion:isCompany ? c.milestones[0].test : c.next,sources:sourceIds,
      legacyReference:{kind,id:c.id,reportPath:'docs/research/potential-stocks-2026-10-18.md'}
    });
  }
  companies.sort((a,b)=>a.priorityRank-b.priorityRank || b.reviewedAt.localeCompare(a.reviewedAt) || a.id.localeCompare(b.id));
  const latest=history[0];
  return {
    revision:latest.revision,reviewedAt:latest.reviewedAt,title:'潜力研究总表',
    summary:latest.catalogSummary || '所有已研究公司合并比较；优先级以经营证据和当前价格为依据。尚无证据足够强的高概率十倍结论。',
    scope:'累计公司按市场与代码去重，较新研究覆盖同一公司的旧结论；每家公司保留研究和报价日期。',
    horizon:latest.horizon,judgmentBasis:latest.judgmentBasis,profitPrinciple:latest.profitPrinciple,historyLesson:latest.historyLesson,
    priceBasis:'逐家公司标注报价日期、交易时段和币种；历史记录不冒充实时价格。',
    reportPath:'docs/research/potential-research-catalog.md',dataPath:'data/potential-research-catalog.json',
    sectors:groups.map(([id,name])=>({id,name})),companies,sources
  };
}
