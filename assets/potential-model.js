(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChanghengPotentialModel = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  function project(company, scenario, years = 5) {
    const { revenue, margin, shares, pe, dividends } = scenario;
    if (![company.price.value, company.shares.value, revenue, margin, shares, dividends, years].every(finite) ||
        company.price.value <= 0 || company.shares.value <= 0 || revenue < 0 || shares <= 0 || dividends < 0 || years <= 0 || margin < -1 || margin > 1)
      throw new RangeError('缺少有效的价格、收入、利润率、股本、分红或期限');
    const profit = revenue * margin;
    let equity;
    if (profit > 0 && finite(pe) && pe > 0) equity = profit * pe;
    else if (profit <= 0 && finite(scenario.equityValue) && scenario.equityValue >= 0) equity = scenario.equityValue;
    else throw new RangeError('盈利情景需正PE；亏损情景需明确剩余股权价值');
    const price = equity / shares, priceMultiple = price / company.price.value;
    const totalMultiple = (price + dividends) / company.price.value;
    const originalCap = company.price.value * company.shares.value;
    return {
      profit, equity, price, priceMultiple, totalMultiple,
      capitalMultiple: equity / originalCap,
      dilution: shares / company.shares.value - 1,
      revenueCagr: finite(company.financials.anchorRevenue) && company.financials.anchorRevenue > 0
        ? (revenue / company.financials.anchorRevenue) ** (1 / years) - 1 : null,
      priceCagr: priceMultiple ** (1 / years) - 1,
      totalCagr: totalMultiple ** (1 / years) - 1
    };
  }
  function hurdle(company, scenario, multiple = 10, years = 5) {
    if (![company.price.value, company.shares.value, company.financials.anchorRevenue, scenario.shares, scenario.margin, scenario.pe, multiple, years].every(finite) ||
        company.price.value <= 0 || company.shares.value <= 0 || company.financials.anchorRevenue <= 0 ||
        scenario.shares <= 0 || scenario.margin <= 0 || scenario.margin > 1 || scenario.pe <= 0 || multiple <= 0 || years <= 0) return null;
    const price = company.price.value * multiple, equity = price * scenario.shares;
    const profit = equity / scenario.pe, revenue = profit / scenario.margin;
    return { price, equity, profit, revenue,
      revenueCagr: (revenue / company.financials.anchorRevenue) ** (1 / years) - 1,
      capitalMultiple: multiple * scenario.shares / company.shares.value };
  }
  const scenario = (company, id) => company.scenarios.find(x => x.id === id);
  function sortValue(c, key) {
    if (key === 'revenue' || key === 'netIncome' || key === 'operatingCash') return c.financials[key];
    if (key === 'price') return c.price.value;
    if (key === 'dilution') return project(c, scenario(c, 'bull')).dilution;
    if (key === 'hurdle') return hurdle(c, scenario(c, 'bull')).revenueCagr;
    if (['bear', 'base', 'bull'].includes(key)) return project(c, scenario(c, key)).priceMultiple;
    return null;
  }
  function select(companies, state) {
    const q = (state.query || '').trim().toLowerCase();
    const rows = companies.filter(c => (!state.market || c.market === state.market) &&
      (!state.status || state.status === 'all' || c.status === state.status) &&
      (!state.sector || state.sector === 'all' || c.sector === state.sector) &&
      (!q || [c.id, c.name, c.sector, c.tagline].join(' ').toLowerCase().includes(q)));
    return rows.sort((a, b) => {
      if (!state.sort || state.sort === 'default') return a.rank - b.rank;
      const x = sortValue(a, state.sort), y = sortValue(b, state.sort);
      if (!finite(x)) return !finite(y) ? a.rank - b.rank : 1;
      if (!finite(y)) return -1;
      return (state.descending ? y - x : x - y) || a.rank - b.rank;
    });
  }
  function cycleSort(sort, descending, next) {
    if (sort !== next) return { sort: next, descending: true };
    return descending ? { sort, descending: false } : { sort: 'default', descending: true };
  }
  function returnPercent(multiple, annual, years = 5) {
    if (!finite(multiple) || multiple < 0 || !finite(years) || years <= 0) return null;
    return (annual ? multiple ** (1 / years) - 1 : multiple - 1) * 100;
  }
  function adjustedGrossMargin(revenue, reportedCost, costBenefit) {
    if (![revenue, reportedCost, costBenefit].every(finite) || revenue <= 0 || reportedCost < 0 || costBenefit < 0)
      throw new RangeError('毛利调整需有效收入、报表成本和成本抵减金额');
    return (revenue - reportedCost - costBenefit) / revenue;
  }
  // All amounts and shares are in millions. This isolates working-capital risk;
  // it does not model future operating earnings or capital expenditure.
  function fundingStress(company, terminal, workingCapitalRatio, netIssuePrice) {
    const f = company.financingCheck;
    if (!f) return null;
    const inputs = [f.receivables, f.inventory, f.payables, f.cash, f.annualizedRevenue,
      f.reservedFutureAwards, company.shares.value, company.shares.knownPotential,
      terminal.shares, terminal.revenue, workingCapitalRatio, netIssuePrice];
    if (!inputs.every(finite) || inputs.some(v => v < 0) ||
        f.annualizedRevenue <= 0 || terminal.shares <= 0 || netIssuePrice <= 0)
      throw new RangeError('融资压力需明确的营运资金、潜在股份、未来激励与净发行价');
    const workingCapital = f.receivables + f.inventory - f.payables;
    const fundingShares = terminal.shares - company.shares.value - company.shares.knownPotential - f.reservedFutureAwards;
    if (fundingShares < 0) throw new RangeError('终点股数未覆盖现有股份、潜在股份及预留激励');
    const additionalWorkingCapital = terminal.revenue * workingCapitalRatio - workingCapital;
    const proceeds = fundingShares * netIssuePrice;
    return { workingCapital, currentRatio: workingCapital / f.annualizedRevenue,
      fundingShares, proceeds, additionalWorkingCapital,
      balanceBeforeOtherFlows: f.cash + proceeds - additionalWorkingCapital };
  }
  return { project, hurdle, scenario, select, cycleSort, sortValue, returnPercent, adjustedGrossMargin, fundingStress };
});
