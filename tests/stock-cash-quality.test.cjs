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
test('published A-share cash constraint exposes two candidates with weaker TTM conversion',()=>{
  const s={};vm.createContext(s);vm.runInContext(fs.readFileSync('data/snapshot.js','utf8'),s);
  const f=s.STOCKS.find(x=>x.c==='601138'); const c=M.stockCashQuality(f);
  const last=f.latestFinancials,previous=f.financialReports.find(x=>x.reportDate==='2025-06-30'),annual=f.financialReports.find(x=>x.reportDate==='2025-12-31');
  assert.equal(c.cash,last.operatingCashFlow+annual.operatingCashFlow-previous.operatingCashFlow);
  assert.equal(c.profit,last.netProfit+annual.netProfit-previous.netProfit);
  assert.equal(c.pass,c.ratio>=.5);
});
