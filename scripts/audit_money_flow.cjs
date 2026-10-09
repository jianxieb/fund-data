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
  const result = { date, combinationsChecked: 0, pricedCombinations: 0,
    distinctPricedRoutes: 0, unpricedSelectableRoutes: 0, rejected: {}, routes: [] };
  const routes = new Map();
  for (const start of D.mainlandBanks) for (const bank of D.hkBanks) for (const broker of D.brokers)
    for (const returning of D.hkBanks) for (const exit of D.mainlandBanks)
      for (const route of ['USD', 'HKD', 'CNH']) for (const outcome of ['usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
        result.combinationsChecked++;
        const s = M.calculatorRoute({ ...config, date, startBank: start.id, bank: bank.id, broker: broker.id,
          returnBank: returning.id, exitBank: exit.id, route, outcome });
        const issue = M.calculatorIssue(s, D);
        if (issue) { result.rejected[issue] = (result.rejected[issue] || 0) + 1; continue; }
        const r = M.calculatorJourney(s, D, quotes).selected;
        if (!r?.complete || r.missing.length || r.rows.some(x => !Number.isFinite(x.cny)) || !Number.isFinite(r.net)) {
          result.unpricedSelectableRoutes++; continue;
        }
        const expected = r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny;
        if (Math.abs(expected - r.netCny) > 1e-6) throw new Error('Ledger mismatch: ' + JSON.stringify(s));
        result.pricedCombinations++;
        const key = [start.id, bank.id, broker.id, returning.id, outcome === 'mainland' ? exit.id : '', route, outcome].join('/');
        routes.set(key, { key, feesCny: Number(r.costCny.toFixed(4)), balance: Number(r.net.toFixed(4)), currency: r.currency });
      }
  result.routes = [...routes.values()]; result.distinctPricedRoutes = routes.size;
  return result;
}
module.exports = { audit, config, Q };
if (require.main === module) {
  const result = audit();
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(__dirname, '../docs/money-flow-combinations.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, routes: undefined }, null, 2));
  if (result.unpricedSelectableRoutes) process.exitCode = 1;
}
