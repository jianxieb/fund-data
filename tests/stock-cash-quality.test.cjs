const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../assets/model.js');
test('TTM cash uses annual plus cumulative less comparable, never doubles half-years',()=>{
  const s={latestFinancials:{reportDate:'2026-06-30',netProfit:20,operatingCashFlow:2},financialReports:[{reportDate:'2025-12-31',netProfit:30,operatingCashFlow:40},{reportDate:'2025-06-30',netProfit:15,operatingCashFlow:30}]};
  const r=M.stockCashQuality(s);assert.equal(r.profit,35);assert.equal(r.cash,12);assert.equal(r.pass,false);
  s.financialReports.pop();assert.equal(M.stockCashQuality(s).ratio,null);assert.equal(M.stockCashQuality(s).pass,false);
});
test('zero cash, losses and industrial versus financial models remain distinct',()=>{
  assert.equal(M.stockCashQuality({latestFinancials:{reportDate:'2025-12-31',netProfit:10,operatingCashFlow:0}}).pass,false);
  assert.equal(M.stockCashQuality({symbol:'TEST',analysis:{cashConversion:1},financials:{ttmProfit:-10}}).pass,false);
  assert.equal(M.stockCashQuality({symbol:'BANK',accountingModel:'bank'}).applicable,false);
  assert.equal(M.stockCashQuality({symbol:'TEST',analysis:{cashConversion:.5},financials:{ttmProfit:10}}).pass,true);
});
test('published A-share cash conversion uses the latest filing and its matching prior period',()=>{
  const s={};vm.createContext(s);vm.runInContext(fs.readFileSync('data/snapshot.js','utf8'),s);
  const f=s.STOCKS.find(x=>x.c==='601138'); const c=M.stockCashQuality(f);
  const last=f.latestFinancials,priorYear=Number(last.reportDate.slice(0,4))-1;
  const previous=f.financialReports.find(x=>x.reportDate===priorYear+last.reportDate.slice(4));
  const annual=f.financialReports.find(x=>x.reportDate===priorYear+'-12-31');
  for(const [result,key] of [['cash','operatingCashFlow'],['profit','netProfit']]) {
    const inputs=last.reportDate.endsWith('12-31')?[last[key]]:[last[key],annual?.[key],previous?.[key]];
    const expected=inputs.every(Number.isFinite)?(inputs.length===1?inputs[0]:inputs[0]+inputs[1]-inputs[2]):null;
    assert.equal(c[result],expected);
  }
  assert.equal(c.pass,c.ratio>=.5);
});
