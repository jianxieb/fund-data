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
  result.channelProfiles = auditChannels({ quotes, date });
  return result;
}
function auditChannels({ quotes = Q, date = config.date } = {}) {
  // Enumerate the channels actually offered by the UI, including each FX
  // location and endpoint. Do not inflate coverage with unused return accounts.
  const profiles = [
    { id: 'standard', count: 1, trade25: false, hsbcBalanceWaiver: false, scCnhAccount: false,
      cnHsbcFeeWaived: false, cnHangFeeWaived: false, cnScFeeWaived: false },
    { id: 'confirmed-qualifications', count: 2, trade25: true, hsbcBalanceWaiver: true, scCnhAccount: true,
      cnHsbcFeeWaived: true, cnHangFeeWaived: true, cnScFeeWaived: true },
    { id: 'all-relevant-qualifications', count: 1, trade25: false, hsbcBalanceWaiver: false, scCnhAccount: false,
      cnHsbcFeeWaived: false, cnHangFeeWaived: false, cnScFeeWaived: false,
      chiefMonthly: false, usmartPromo: false, zaLv2: false }
  ];
  return profiles.map(profile => {
    const report = { profile, checked: 0, priced: 0, referencePriced: 0, partial: 0, routeIssues: 0,
      ledgerChecks: 0, retainedPartialResults: 0, issueCounts: {}, missingCounts: {}, sources: {} };
    const coverage = Object.fromEntries(['mainlandMethods', 'fxModes', 'depositMethods', 'returnMethods'].map(key => [key, new Set()]));
    const qualificationCoverage = new Set();
    const record = s => {
      if (M.calculatorIssue(s, D)) throw new Error('Offered account rejected by catalogue: ' + JSON.stringify(s));
      report.checked++;
      const sourceKey = [s.startBank, s.bank, s.route, s.mainlandMethod].join('/');
      const source = report.sources[sourceKey] ||= { checked: 0, priced: 0, partial: 0, routeIssues: 0 };
      source.checked++;
      for (const [key, value] of [['mainlandMethods', s.mainlandMethod], ['fxModes', s.fxMode], ['depositMethods', s.depositMethod], ['returnMethods', s.outcome === 'mainland' ? s.returnMethod : '']]) if (value) coverage[key].add(value);
      const data = M.calculatorJourney(s, D, quotes), r = data.selected || data.partial;
      for (const row of r?.rows || []) {
        if (row.cny !== null && !Number.isFinite(row.cny)) throw new Error('Non-finite branch fee: ' + JSON.stringify(s));
        if (/NaN|undefined/.test(row.label)) throw new Error('Invalid fee label: ' + JSON.stringify(s));
        if (row.items?.length && row.items.every(item => Number.isFinite(item.cny)) && Number.isFinite(row.cny) && Math.abs(row.items.reduce((sum, item) => sum + item.cny, 0) - row.cny) > 1e-6) throw new Error('Fee item sum mismatch: ' + JSON.stringify(s));
      }
      for (const value of Object.values(r?.steps || {})) if (typeof value === 'number' && (!Number.isFinite(value) || value < -1e-6)) throw new Error('Invalid intermediate balance: ' + JSON.stringify(s));
      if (!data.selected) {
        if (!data.error || /NaN|undefined/.test(data.error)) throw new Error('No usable branch result: ' + JSON.stringify(s));
        report.routeIssues++; source.routeIssues++;
        if (r?.rows?.some(row => Number.isFinite(row.cny))) report.retainedPartialResults++;
        report.issueCounts[data.error] = (report.issueCounts[data.error] || 0) + 1;
        return;
      }
      const expected = r.budgetCny + r.profitUsd * r.refs.USD - r.costCny - r.taxCny + r.fxImpactCny;
      if (!Number.isFinite(r.net) || Math.abs(expected - r.netCny) > 1e-6 || Math.abs(r.rows.reduce((sum, row) => sum + (row.cny ?? 0), 0) - r.costCny) > 1e-6) throw new Error('Branch ledger mismatch: ' + JSON.stringify(s));
      report.ledgerChecks++;
      if (r.complete && r.quotedCore) {
        if (r.missing.length || r.rows.some(row => row.cny === null)) throw new Error('False full branch price: ' + JSON.stringify(s));
        report.priced++; source.priced++;
        if (r.rows.some(row => row.estimate)) report.referencePriced++;
      } else {
        report.partial++; source.partial++;
        if (!r.missing.length && r.quotedCore) throw new Error('Unnamed branch gap: ' + JSON.stringify(s));
        for (const gap of r.missing) report.missingCounts[gap] = (report.missingCounts[gap] || 0) + 1;
      }
    };
    for (const startBank of D.calculator.mainland) for (const bank of D.calculator.hkBanks) for (const broker of D.calculator.brokers) for (const route of D.calculator.currencies) {
      const entry = { ...config, ...profile, date, startBank, bank, broker, route };
      const choices = M.calculatorChannels(entry, D);
      for (const mainlandMethod of choices.mainlandMethods) for (const fxMode of choices.fxModes) {
        const funding = { ...entry, mainlandMethod, fxMode };
        for (const depositMethod of M.calculatorChannels(funding, D).depositMethods) for (const outcome of ['broker-balance', 'usd-balance', 'usd-card', 'cnh-card', 'mainland']) {
          const returns = outcome === 'broker-balance' ? [bank] : D.calculator.hkBanks;
          const exits = outcome === 'mainland' ? D.calculator.mainland : [startBank];
          for (const returnBank of returns) for (const exitBank of exits) {
            const endpoint = { ...funding, depositMethod, outcome, returnBank, exitBank };
            for (const returnMethod of outcome === 'mainland' ? M.calculatorChannels(endpoint, D).returnMethods : ['']) {
              const s = { ...endpoint, returnMethod };
              if (profile.id !== 'all-relevant-qualifications') { record(s); continue; }
              // Toggle all and only the qualifications that affect this route.
              // Unvisited account flags do not create new operations or fees.
              const fields = new Set();
              const stockOffer = { hsbc: 'trade25', chief: 'chiefMonthly', usmart: 'usmartPromo', za: 'zaLv2' }[broker];
              if (stockOffer) fields.add(stockOffer);
              const hkAccounts = [bank, ...(outcome === 'broker-balance' ? [] : [returnBank]), D.brokers.find(b => b.id === broker)?.integratedBank];
              if (hkAccounts.includes('hsbc')) fields.add('hsbcBalanceWaiver');
              if (outcome === 'cnh-card' && returnBank === 'sc') fields.add('scCnhAccount');
              for (const id of [startBank, ...(outcome === 'mainland' ? [exitBank] : [])]) {
                const field = D.mainlandBanks.find(b => b.id === id)?.accountService?.waiverField;
                if (field) fields.add(field);
              }
              const relevant = [...fields];
              for (const field of relevant) qualificationCoverage.add(field);
              for (let mask = 0; mask < 2 ** relevant.length; mask++) record({ ...s,
                ...Object.fromEntries(relevant.map((field, i) => [field, !!(mask & (1 << i))])) });
            }
          }
        }
      }
    }
    report.coverage = Object.fromEntries(Object.entries(coverage).map(([key, values]) => [key, [...values].sort()]));
    if (qualificationCoverage.size) report.qualificationCoverage = [...qualificationCoverage].sort();
    return report;
  });
}
module.exports = { audit, auditChannels, config, Q };
if (require.main === module) {
  const result = audit();
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(__dirname, '../docs/money-flow-combinations.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, routes: undefined, channelProfiles: result.channelProfiles.map(({ sources, ...profile }) => profile) }, null, 2));
}
