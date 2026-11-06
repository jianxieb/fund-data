import json,csv,hashlib,sys,statistics
from pathlib import Path
ROOT=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).parent.parent
OUT=Path(__file__).parent
load=lambda n:json.loads((ROOT/n).read_text())
VIX="fear_reversal_r1.1_c10_peak0.3_off0"
NAMES={"vix":"VIX恐慌恢复调仓","rotation":"三批相对强弱轮动","hybrid":"双重风险门调仓"}
groups=[]
for method,path in [("vix","volatility/evaluation.json"),("rotation","rotation/ensemble/evaluation.json")]:
 for g in load(path)["results"]:
  if method=="vix" and g["c"]["id"]!=VIX:continue
  groups.append(dict(method=method,name=NAMES[method],source=path,**{k:g[k] for k in ["weights","tax","fee","delay","label","summary","rows","baseline"]}))
for g in load("hybrid/evaluation.json")["results"]:
 for label,key in [("all10_81","all10"),("all15_21","all15"),("later35","all10")]:
  z=g[key];rows=z["hybrid"];base=z["baseline"]
  if label=="later35":
   rows=[r for r in rows if "2014-01-01"<=r["start"]<="2016-11-30"]
   base=[r for r in base if "2014-01-01"<=r["start"]<="2016-11-30"]
  summ=g["later35"]["hybridVsLump"] if label=="later35" else z["summary"]["hybridVsLump"]
  groups.append(dict(method="hybrid",name=NAMES["hybrid"],source="hybrid/evaluation.json",**{k:g[k] for k in ["weights","tax","fee","delay"]},label=label,summary=summ,rows=rows,baseline=base))
for g in groups:
 assert len(g["rows"])==len(g["baseline"])==g["summary"]["n"]
 # Independently recompute paired annual return, entry-year equally weighted.
 yrs={}
 for a,b in zip(g["rows"],g["baseline"]):
  assert (a["start"],a["end"])==(b["start"],b["end"])
  yrs.setdefault(a["start"][:4],[]).append(a["annualReturn"]-b["annualReturn"])
 avg=sum(sum(v)/len(v) for v in yrs.values())/len(yrs)
 assert abs(avg-g["summary"]["yearEqualCAGRpp"])<1e-10
 g["summary"]["medianAnnualReturn"]=statistics.median(r["annualReturn"] for r in g["rows"])
 g["summary"]["baselineMedianAnnualReturn"]=statistics.median(r["annualReturn"] for r in g["baseline"])
 g["summary"]["medianTerminalValue"]=statistics.median(r["value"] for r in g["rows"])
 g["summary"]["baselineMedianTerminalValue"]=statistics.median(r["value"] for r in g["baseline"])
 g["summary"]["maxActualStockFraction"]=max(r["maxStockFraction"] for r in g["rows"])
 g["summary"]["maxDailyLeverageExposure"]=max(r["maxDailyLeverageExposure"] for r in g["rows"])
summary={"version":"2026-11-06","baseline":"identical initial weights lump sum, no additional capital","rules":NAMES,"mainStageCandidates":187,"diagnostics":{"vixNeighborhood":27,"vixNeighborhoodOverlappingOriginal":3,"singlePhaseCalendar":9,"ensembleOffsets":3},"units":{"yearEqualCAGRpp":"percentage points, paired CAGR difference averaged within entry year then equally across entry years","value":"net terminal wealth per initial100 after capital-gain reserve","mdd":"percent, negative drawdown of daily after-reserve wealth"},"overlap":"later35 is a subset of all10_81; all10 and all15 windows overlap strongly; these are not independent samples or prospective validation","groups":[{k:v for k,v in g.items() if k not in ["rows","baseline"]} for g in groups]}
(OUT/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
fields=["method","name","sample","weight_USD","weight_TQQQ","initial_cash_weight","fee","capital_tax","dividend_tax","extra_delay","start","end","years","paired_CAGR_pp","terminal_relative_pct"]
metrics=["value","grossValue","annualReturn","mdd","fees","capitalTax","paidDividendTax","paidTax","reserve","finalCash","initialCash","tradeCount","planCount","inventoryCapCount","maxStockFraction","meanStockFraction","maxDailyLeverageExposure","cvar95"]
fields+= [prefix+k for prefix in ["method_","baseline_"] for k in metrics]+["method_pending_json","baseline_pending_json","source"]
rows=[]
for g in groups:
 for a,b in zip(g["rows"],g["baseline"]):
  r=dict(method=g["method"],name=g["name"],sample=g["label"],weight_USD=g["weights"][0],weight_TQQQ=g["weights"][1],initial_cash_weight=1-sum(g["weights"]),fee=g["fee"],capital_tax=g["tax"],dividend_tax=g["tax"],extra_delay=g["delay"],start=a["start"],end=a["end"],years=a["years"],paired_CAGR_pp=a["annualReturn"]-b["annualReturn"],terminal_relative_pct=(a["value"]/b["value"]-1)*100,source=g["source"])
  for prefix,z in [("method_",a),("baseline_",b)]:
   for k in metrics:r[prefix+k]=z[k]
   r[prefix+"pending_json"]=json.dumps(z["pending"],separators=(",",":"))
  rows.append(r)
with (OUT/"results.csv").open("w",newline="")as f:
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
with (OUT/"results.csv").open()as f:
 back=list(csv.DictReader(f));assert len(back)==len(rows)
 for a,b in zip(rows,back):
  for k in fields:
   if isinstance(a[k],(int,float)):assert float(b[k])==a[k]
   else:assert b[k]==a[k]
# All main-stage development candidates remain visible, without treating diagnostics as new selected candidates.
dev=[]
for x in load("volatility/development.json")["results"]:dev.append(dict(stage="volatility72",candidate=x["c"],tax=.2,summary=x["summary"]))
for x in load("rotation/development.json")["results"]:dev.append(dict(stage="rotation96",candidate=x["c"],tax=.2,score=x["score"],summary=x["taxed"]["summary"],pretax=x["pretax"]["summary"]))
for x in load("harvest/development.json")["results"]:dev.append(dict(stage="harvest16",candidate=x["candidate"],tax=.2,summary=x["summary"]))
x=load("volatility/ensemble-development.json");dev.append(dict(stage="vix_mean_followup1",candidate=x["candidate"],tax=.2,summary=x["summary"]))
x=load("rotation/ensemble/development.json");dev.append(dict(stage="rotation_three_phase_followup1",candidate=load("rotation/ensemble/selection.json")["candidate"],tax=.2,summary=x["taxed"]["summary"],pretax=x["pretax"]["summary"]))
x=load("hybrid/selection.json");dev.append(dict(stage="hybrid_followup1",candidate=x["candidate"],tax=.2,summary=x["development"]["hybridVsLump"]))
assert len(dev)==187
(OUT/"development-summary.json").write_text(json.dumps({"count":len(dev),"candidates":dev},ensure_ascii=False,indent=2)+"\n")
(OUT/"results-columns.json").write_text(json.dumps({"rows":len(rows),"columns":fields,"definitions":summary["units"],"subsetWarning":summary["overlap"],"cashWeightNote":"nominal configured cash weight; actual initial fee allocation is identical to baseline","sourcePaths":"relative to reproduction archive research root","taxCases":"hybrid tested only20%; vix/rotation tested0%and20%","readback":"every exported field re-read and compared exactly to normalized in-memory values"},ensure_ascii=False,indent=2)+"\n")
print(json.dumps({"groups":len(groups),"rows":len(rows),"columns":len(fields),"development":len(dev),"csvSHA256":hashlib.sha256((OUT/"results.csv").read_bytes()).hexdigest()}))
