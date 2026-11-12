(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengMidtermStudyModel = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const horizons = Object.freeze(['1w','1m','3m','6m','12m']);
  const parties = Object.freeze(['any','dem','rep','unknown']);
  const dayMs = 86400000, maxGap = 10, launch = '1957-03-04';
  const iso = date => date.toISOString().slice(0,10);
  const dayNumber = date => Date.parse(date + 'T00:00:00Z') / dayMs;
  function electionDate(year) {
    const weekday = new Date(Date.UTC(year, 10, 1)).getUTCDay();
    return iso(new Date(Date.UTC(year, 10, 2 + (8 - weekday) % 7)));
  }
  function targetDate(election, h) {
    const date = new Date(election + 'T00:00:00Z');
    if (h === '1w') date.setUTCDate(date.getUTCDate() + 7);
    else date.setUTCMonth(date.getUTCMonth() + parseInt(h,10));
    return iso(date);
  }
  function summarize(outcomes) {
    const values = outcomes.filter(o => o.status === 'complete').map(o => o.pct).sort((a,b) => a-b);
    const n = values.length, up = values.filter(v => v > 0).length, flat = values.filter(v => v === 0).length;
    return {n,up,flat,down:n-up-flat,upPct:n ? up/n*100 : null,
      mean:n ? values.reduce((a,b) => a+b,0)/n : null,
      median:n ? (values[(n-1)>>1] + values[n>>1])/2 : null,min:n ? values[0] : null,max:n ? values[n-1] : null,
      pending:outcomes.filter(o => o.status === 'pending').length, missing:outcomes.filter(o => o.status === 'missing').length};
  }
  function congressIndex(rows) {
    if (!Array.isArray(rows)) throw new Error('选后两院控制党资料格式有误');
    const index = new Map();
    for (const row of rows) {
      if (!row || !Number.isInteger(row.year) || row.year < 1950 || (row.year-1950)%4 !== 0 || index.has(row.year) ||
          ![null,'dem','rep'].includes(row.house) || ![null,'dem','rep'].includes(row.senate) ||
          !Number.isInteger(row.congress) || row.congress < 1 || !['confirmed','projected','unknown'].includes(row.status) ||
          typeof row.note !== 'string' || !Array.isArray(row.sourceUrls) || row.sourceUrls.some(url=>typeof url!=='string' || !/^https:\/\//.test(url)))
        throw new Error('选后两院控制党资料含重复届次或无效字段');
      index.set(row.year,row);
    }
    return index;
  }
  function congressFor(year, index) {
    const row=index.get(year);
    if (row) {
      const missing=[row.house==null?'众议院':'',row.senate==null?'参议院':''].filter(Boolean).join('、');
      return {...row,sourceUrls:row.sourceUrls.slice(),note:row.note || (missing?year+' 届选后'+missing+'控制党资料缺失':'')};
    }
    return {year,house:null,senate:null,congress:null,status:'unknown',note:year+' 届选后众议院、参议院控制党资料缺失',sourceUrls:[]};
  }
  const partyMatches = (value, filter) => filter==='any' || (filter==='unknown' ? value==null : value===filter);
  function study(series, {entry='election',era='all',asOf,house='any',senate='any'} = {}, congressRows=[]) {
    if (!['election','next'].includes(entry) || !['all','live'].includes(era) || !parties.includes(house) || !parties.includes(senate))
      throw new Error('未知的中期选举统计条件');
    const congress=congressIndex(congressRows);
    const days = [], segments = [];
    for (let i = 0; i < series.length; i++) {
      const [d,p] = series[i], t = dayNumber(d);
      if (!Number.isFinite(t) || iso(new Date(t*dayMs)) !== d || (i && t <= days[i-1]) || !Number.isFinite(p) || p <= 0)
        throw new Error('标普 500 收盘序列的日期、顺序或点位有误');
      days.push(t);
      segments.push(i ? segments[i-1] + (t-days[i-1] > maxGap ? 1 : 0) : 0);
    }
    const upper = (day,end=series.length) => {
      let lo=0, hi=end;
      while (lo<hi) {
        const m=(lo+hi)>>1;
        if (days[m] <= day) lo=m+1; else hi=m;
      }
      return lo;
    };
    if (asOf != null && (!Number.isFinite(dayNumber(asOf)) || iso(new Date(dayNumber(asOf)*dayMs)) !== asOf))
      throw new Error('中期选举统计截止日有误');
    // Never borrow an observation beyond the supplied information cutoff, including when checking gaps.
    const end = asOf == null ? series.length : upper(dayNumber(asOf));
    const last = end ? series[end-1][0] : null;
    const first = end ? series[0][0] : null;
    // Without a newer market observation, a stale snapshot cannot establish a newly matured result.
    const cutoff = last;
    const atOrBefore = day => {
      const i=upper(day,end)-1;
      if (i<0 || day-days[i] > maxGap) return -1;
      // Do not treat a weekday inside a known long data outage as a holiday.
      if (days[i] < day && i+1 < end && segments[i] !== segments[i+1]) return -1;
      return i;
    };
    const events = [];
    for (let year=era === 'live' ? 1958 : 1950; cutoff && year<=Number(cutoff.slice(0,4)); year+=4) {
      const date = electionDate(year);
      if (date>cutoff) break;
      const election = dayNumber(date);
      const before = atOrBefore(election);
      let anchor = before, anchorStatus = 'complete', anchorReason = '';
      if (before < 0) {
        anchorStatus = 'missing'; anchorReason = date<first ? '选举日早于行情覆盖期' : '选举日附近缺连续收盘行情';
      } else if (entry === 'next') {
        anchor = before + 1;
        if (anchor >= end) { anchorStatus='pending'; anchorReason='等待选后首个交易日收盘'; }
        else if (segments[before] !== segments[anchor] || days[anchor]-election > maxGap) {
          anchorStatus='missing'; anchorReason='选后首个交易日附近行情断档';
        }
      }
      const [anchorDate,anchorClose] = anchorStatus === 'complete' ? series[anchor] : [null,null];
      const outcomes = {};
      for (const h of horizons) {
        const target=targetDate(date,h);
        let status='complete',reason='',finish=-1;
        if (anchorStatus !== 'complete') { status=anchorStatus; reason=anchorReason; }
        else if (target>cutoff) { status='pending'; reason='尚未到目标日期'; }
        else {
          finish=atOrBefore(dayNumber(target));
          if (finish < 0) { status='missing'; reason='目标日期附近缺连续收盘行情'; }
          else if (segments[finish] !== segments[anchor]) { status='missing'; reason='收益区间行情断档超过 10 个自然日'; }
          else if (finish <= anchor) { status='missing'; reason='目标日期前缺起算日之后的收盘'; }
        }
        const [actual,close] = status==='complete' ? series[finish] : [null,null];
        let maxDrawdownPct=null;
        if (actual) {
          let peak=anchorClose, worst=0;
          for (let i=anchor+1; i<=finish; i++) {
            peak=Math.max(peak,series[i][1]);
            worst=Math.min(worst,(series[i][1]/peak-1)*100);
          }
          maxDrawdownPct=worst;
        }
        outcomes[h] = {targetDate:target,date:actual,close,pct:actual ? (close/anchorClose-1)*100 : null,maxDrawdownPct,status,reason};
      }
      events.push({year,date,preLaunch:date<launch,anchorDate,anchorClose,anchorStatus,anchorReason,outcomes,congress:congressFor(year,congress)});
    }
    const filters={house,senate};
    const facetCounts=Object.fromEntries(['house','senate'].map(chamber=>{
      const other=chamber==='house'?'senate':'house';
      const candidates=events.filter(e=>partyMatches(e.congress[other],filters[other]));
      return [chamber,Object.fromEntries(parties.map(party=>[party,candidates.filter(e=>partyMatches(e.congress[chamber],party)).length]))];
    }));
    const matching=events.filter(e=>partyMatches(e.congress.house,house) && partyMatches(e.congress.senate,senate));
    const summary = Object.fromEntries(horizons.map(h=>[h,summarize(matching.map(e=>e.outcomes[h]))]));
    return {first,asOf:cutoff,entry,era,house,senate,cohortN:events.length,
      partyMissingN:events.filter(e=>e.congress.house==null || e.congress.senate==null).length,
      facetCounts,events:matching.reverse(),summary};
  }
  return {study,electionDate,horizons,parties};
});
