"""Lossless flat account export; no aggregation, filtering, or rounding of frozen results."""
from pathlib import Path
import csv,json,hashlib,sys
source=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent/'results.json'
P=source.parent;data=json.loads(source.read_text())
context=['universe','asset_1','asset_2','currency','years','start','end','weight_1_pct','weight_2_pct','cash_target_pct','fee_per_side_pct','capital_gains_tax_pct','dividend_tax_pct','extra_delay_common_days','order_delay_common_days','initial_capital']
comparison=['cagr_vs_lump_pp','wealth_vs_lump_pct','mdd_vs_lump_pp','cagr_vs_old_current_close_pp','wealth_vs_old_current_close_pct','mdd_vs_old_current_close_pp']
fields={'value':'value','gross_value':'grossValue','cagr_pct':'annualReturn','mdd_pct':'mdd','final_cash':'finalCash','fees':'fees','paid_dividend_tax':'paidDividendTax','paid_capital_gains_tax':'paidCapitalGainsTax','capital_gains_tax_reserve':'capitalGainsTaxReserve','actual_purchase_notional':'actualPurchaseNotional','additional_purchase_notional':'additionalPurchaseNotional','cash_consumed':'cashConsumed','mean_stock_fraction':'meanStockFraction','max_stock_fraction':'maxStockFraction','max_stock_fraction_after_additional_buy':'maxStockFractionAfterAdditionalBuy','additional_buy_dates':'additionalBuyDates'}
execution=['max_target_overshoot_after_buy_pp','overshooting_buy_dates','placed_plans','unfilled_pending_signal_date','unfilled_pending_due_date','unfilled_pending_amount','material_cash_cap_count']
columns=context+comparison+[prefix+'_'+key for prefix in ['executable','lump','old_current_close'] for key in fields]+execution
rows=[]
for g in data['groups']:
 external=g['years']==20
 for r,b,old in zip(g['rows'],g['baseline'],g['oldCurrentCloseRows']):
  assert (r['start'],r['end'])==(b['start'],b['end'])==(old['start'],old['end'])
  row=dict(zip(context,[g['universe'],'SMPIX' if external else 'USD','UOPIX' if external else 'TQQQ','USD' if external else 'CNY',g['years'],r['start'],r['end'],100*g['weights'][0],100*g['weights'][1],100*(1-sum(g['weights'])),100*g['fee'],100*g['tax'],100*g['tax'],g['extraDelay'],1+g['extraDelay'],100]))
  row.update(dict(zip(comparison,[r['annualReturn']-b['annualReturn'],100*(r['value']/b['value']-1),r['mdd']-b['mdd'],r['annualReturn']-old['annualReturn'],100*(r['value']/old['value']-1),r['mdd']-old['mdd']])))
  for prefix,account in [('executable',r),('lump',b),('old_current_close',old)]:
   for label,key in fields.items():row[prefix+'_'+label]=account.get(key)
  pending=r['unfilledPendingAtEnd']
  row.update(dict(zip(execution,[r['maxTargetOvershootAfterBuyPP'],r['overshootingBuyDates'],r['placedPlans'],pending['signalDate'] if pending else '',pending['dueDate'] if pending else '',sum(pending['notionals']) if pending else 0,r['materialCashCapCount']])))
  rows.append(row)
assert len(rows)==5204 and len(columns)==77
with (P/'results.csv').open('w',encoding='utf-8',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=columns,lineterminator='\n');writer.writeheader();writer.writerows(rows)
with (P/'results.csv').open(encoding='utf-8',newline='') as f:
 back=list(csv.DictReader(f));assert len(back)==len(rows)
 for got,want in zip(back,rows):
  for col in columns:
   v=want[col]
   if isinstance(v,(float,int)):assert float(got[col])==float(v),(col,v,got[col])
   else:assert got[col]==('' if v is None else str(v))
meta={'file':'results.csv','rowsExcludingHeader':len(rows),'columns':columns,'columnCount':len(columns),'sourceResultsSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'bytes':(P/'results.csv').stat().st_size,'sha256':hashlib.sha256((P/'results.csv').read_bytes()).hexdigest(),'roundtripAllCellsMatched':True,'units':{'money':'simulation currency per100 initial capital','pct':'percentage values, e.g20 means20%','fraction':'0..1, e.g.6 means60%','pp':'percentage points','old_current_close':'Archived old idealized fill-date sizing; its delay1 is t-2 eligibility/current-price sizing, not serialized pending execution','blank':'not applicable, including no additional buy or no pending order'},'counts':{'ETF':sum(r['years']<20 for r in rows),'externalActualFunds':sum(r['years']==20 for r in rows)}}
(P/'results-columns.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in meta.items() if k!='columns'},indent=2))
