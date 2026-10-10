#!/usr/bin/env node
// Exhaustive discrete catalogue audit. Numeric inputs have separate boundary tests.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const M = require('../assets/money-flow-model.js');
const D = require('../data/money-flow.js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../data/money-flow-quotes.js'), 'utf8'), context);
const Q = context.window.MONEY_FLOW_QUOTES;
const config = { budgetCny: 100000, count: 2, months: 12, usedFreeTransfers: 0,
  date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), profitUsd: 0, taxRate: 20, creditCny: 0, withdrawalIndex: 1,
  trade25: true, hsbcBalanceWaiver: true, buyOrders: 1, sellOrders: 1, sharePriceUsd: 100 };
function audit({ quotes = Q, date = config.date } = {}) {
  const result = { date, combinationsChecked: 0, completeQuoteCombinations: 0, partialQuoteCombinations: 0,
    inputOrRouteIssues: 0, ledgerChecks: 0, issueCounts: {}, missingCounts: {}, routes: [] };
  const routes = new Map();
  for (const startBank of D.calculator.mainland) for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers)
    for (const returnBank of D.calculator.hkBanks) for (const exitBank of D.calculator.mainland)
      for (const route of D.calculator.currencies) for (const outcome of ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
        result.combinationsChecked++;
        const s = M.calculatorRoute({ ...config, date, startBank, bank, broker, returnBank, exitBank, route, outcome });
        const selectionIssue = M.calculatorIssue(s, D);
        if (selectionIssue) throw new Error('A catalogue account became unavailable: ' + JSON.stringify(s));
        const data = M.calculatorJourney(s, D, quotes), r = data.selected;
        if (!r) {
          if (!data.error) throw new Error('Neither quote nor named issue: ' + JSON.stringify(s));
          if (/NaN|undefined/.test(data.error)) throw new Error(data.error);
          result.inputOrRouteIssues++;
          result.issueCounts[data.error] = (result.issueCounts[data.error] || 0) + 1;
          continue;
        }
        if (!Number.isFinite(r.net) || r.rows.some(x => x.cny !== null && !Number.isFinite(x.cny))) throw new Error('Non-finite quote: ' + JSON.stringify(s));
        const expected = r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny;
        if (Math.abs(expected - r.netCny) > 1e-6) throw new Error('Ledger mismatch: ' + JSON.stringify(s));
        result.ledgerChecks++;
        if (!r.complete) {
          if (!r.missing.length) throw new Error('Incomplete quote without named evidence: ' + JSON.stringify(s));
          result.partialQuoteCombinations++;
          for (const gap of r.missing) result.missingCounts[gap] = (result.missingCounts[gap] || 0) + 1;
          continue;
        }
        if (r.missing.length || r.rows.some(x => x.cny == null)) throw new Error('False complete quote: ' + JSON.stringify(s));
        if (Math.abs(r.fxImpactCny) > 1e-6) throw new Error('Mixed percentage benchmarks: ' + JSON.stringify(s));
        result.completeQuoteCombinations++;
        const key = [startBank, bank, broker, outcome === 'broker-balance' ? '' : returnBank, outcome === 'mainland' ? exitBank : '', route, outcome].join('/');
        routes.set(key, { key, costCny: Number(r.costCny.toFixed(4)), balance: Number(r.net.toFixed(4)), currency: r.currency });
      }
  result.routes = [...routes.values()]; result.distinctCompleteRoutes = routes.size;
  return result;
}
module.exports = { audit, config, Q };
if (require.main === module) {
  const result = audit();
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(__dirname, '../docs/money-flow-combinations.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, routes: undefined }, null, 2));
}
