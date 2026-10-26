(function () {
  'use strict';
  const D = window.MONEY_FLOW, M = window.ChanghengMoneyFlowModel, STORE = 'changheng.money-flow.v4';
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const availableChannels = config => M.calculatorChannels({ ...config, date: today() }, D);
  const defaults = { budgetCny: '100000', currency: 'CNY', plan: 'boc-za', activeStep: '01', startBank: 'boc', route: 'USD', bank: 'bochk', returnBank: 'bochk', exitBank: 'boc', outcome: 'broker-balance',
    paymentConnectFeeWaived: true, mainlandMethod: 'boc-mobile', depositMethod: 'chats', fxMode: 'manual', returnMethod: '', returnCurrency: 'USD', comparison: 'start', count: '1', usedFreeTransfers: '0',
    months: '12', balanceHkd: '0', returnBalanceHkd: '0', bankBalancesHkd: {}, profitUsd: '0', taxableCny: '', taxRate: '20', creditCny: '0', withdrawalIndex: '1', chequeIndex: '1', chequePreFilled: false, hsbcChequeNonCounter: false, tradeFeeUsd: '',
    broker: 'za', ibkrPricing: 'fixed', ibkrFundingVersion: 1, brokerWireChannel: 'online', sellDate: '', buyOrders: '1', sellOrders: '1', sharePriceUsd: '100', trade25: false, chiefMonthly: false, usmartPromo: false, zaLv2: false,
    bankFeeDefaultsVersion: 1, hsbcBalanceWaiver: true, hkHsbcFreeMonths: '0', zaPerksLevel: 'standard', zaSwiftUsed: '0', scCnhAccount: false, otherTurnoverHkd: '0', usedPromoOrders: '0', usmartDays: '0', useVoucher: false, voucherScope: 'platform', voucherUsd: '0', voucherOrders: '1', voucherExpiry: '',
    cnHsbcFeeWaived: true, cnHangFeeWaived: true, cnScFeeWaived: true, cnHsbcFreeMonths: '0', cnHangFreeMonths: '0', cnScFreeMonths: '0',
    icbcEAccount: false, icbcCnhAccount: false, consumptionVersion: 2, cardMode: '', ccbLinkedCard: false, cardCnyPerHkd: '',
    senderFeeCny: '', entryMiddleCny: '', entryInwardHkd: '', depositHkd: '', depositOtherCny: '', inwardHkd: '', intermediaryCny: '',
    withdrawCurrency: 'USD', withdrawDestination: 'hong-kong', cnhWithdrawalMethod: 'local', brokerExitPrice: '', directReceiptConfirmed: false, directInwardCny: '',
    atmMode: '', atmAmountCny: '5000', atmTransactions: '2', atmCnyPerUnit: '', atmExtraCny: '', atmDailyLimitCny: '', atmPerTransactionCny: '',
    returnWireHkd: '', returnExtraCny: '', monthlyHkd: '', returnMonthlyHkd: '', startSell: '', entryPrice: '', exitPrice: '', returnHkdPrice: '',
    usdCny: '', usdHkd: '', usdCnh: '', openingCny: '0', extraCapitalCny: '0', annualGapPct: '0' };
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) {}
  if (Object.keys(stored).length && !stored.outcome) stored.outcome = 'mainland';
  let state = { ...defaults, ...stored, currency: 'CNY' }, H, timer, modalKey;
  const repairIbkrLite = state.broker === 'ibkr' && state.ibkrPricing === 'lite';
  if (repairIbkrLite) state = M.calculatorRoute(state);
  // The previous Lite picker offered only SWIFT for original HKD/CNH.
  // Repair that forced choice once; later explicit wire choices are retained.
  const repairLiteFunding = stored.ibkrFundingVersion !== defaults.ibkrFundingVersion;
  if (repairLiteFunding) {
    if (state.broker === 'ibkr-lite' && ['CNH', 'HKD'].includes(state.route) && state.fxMode !== 'bank' && state.depositMethod === 'swift') {
      state.depositMethod = 'fps'; state.depositHkd = ''; state.depositOtherCny = '';
    }
    state.ibkrFundingVersion = defaults.ibkrFundingVersion;
  }
  // The former generic RMB spending endpoint did not meet mainland-use needs.
  // Migrate it to a real mainland account, without changing the user's banks.
  const repairConsumption = stored.outcome === 'cnh-card' && stored.consumptionVersion !== 2;
  if (repairConsumption) {
    state.outcome = 'mainland'; state.returnCurrency = 'USD'; state.consumptionVersion = 2;
    state.exitPrice = ''; state.returnHkdPrice = ''; state.cardCnyPerHkd = '';
  }
  // Fee comparisons use the current tariff date; account months are not a
  // prediction of when the user will sell. Retire the old future-date setting.
  if (state.sellDate !== today()) {
    state.sellDate = today();
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {}
  }
  // The user requested a qualified-account default. Migrate the old automatic
  // unqualified assumptions once, then preserve any explicitly unchecked fees.
  const repairBankFeeDefaults = stored.bankFeeDefaultsVersion !== defaults.bankFeeDefaultsVersion;
  if (repairBankFeeDefaults) {
    for (const key of ['hsbcBalanceWaiver', 'cnHsbcFeeWaived', 'cnHangFeeWaived', 'cnScFeeWaived']) state[key] = true;
    state.bankFeeDefaultsVersion = defaults.bankFeeDefaultsVersion;
  }
  if (!Object.hasOwn(stored, 'zaPerksLevel') && stored.zaLv2) state.zaPerksLevel = 'lv2';
  state.zaLv2 = state.zaPerksLevel === 'lv2';
  // Earlier versions incorrectly offered the foreign-currency-only Global
  // Link channel for RMB. Keep all accounts and repair that saved method.
  if (state.startBank === 'sc' && state.route === 'CNH' && state.mainlandMethod === 'linked') state.mainlandMethod = 'swift';
  // A published service tariff is not evidence that this receiving account
  // can use it. Repair old hypothetical Go selections without changing accounts,
  // capital, transfer count, FX quotes or unrelated broker/return fees.
  // Retain a saved Payment Connect route only for supported participants/currencies.
  const repairStoredEntry = ['payment-connect', 'cib-go'].includes(state.mainlandMethod) &&
    !availableChannels(state).mainlandMethods.includes(state.mainlandMethod);
  if (repairStoredEntry) {
    state.mainlandMethod = 'swift'; state.senderFeeCny = ''; state.entryMiddleCny = ''; state.entryInwardHkd = '';
  }
  if (state.route !== 'USD' && !M.supportsBrokerFx(state.broker)) state.fxMode = 'bank';
  const usdFunding = D.brokers.find(broker => broker.id === state.broker)?.usdDepositMethods;
  const repairUsFunding = (usdFunding || state.depositMethod === 'wise') && !availableChannels(state).depositMethods.includes(state.depositMethod);
  if (repairUsFunding) { state.depositMethod = availableChannels(state).depositMethods[0] || ''; state.depositHkd = ''; state.depositOtherCny = ''; }
  // A saved local USD wire must not retain the old overseas tariff. Keep all
  // accounts and use the bank's published local USD clearing channel.
  if (state.depositMethod === 'swift' && D.hkBanks.find(bank => bank.id === state.bank)?.localSwiftExcluded?.length &&
      D.brokers.find(broker => broker.id === state.broker)?.swiftDestination === 'hong-kong' &&
      !availableChannels(state).depositMethods.includes('swift')) {
    state.depositMethod = 'chats'; state.depositHkd = ''; state.depositOtherCny = '';
  }
  if (!['01', '02', '03', '04'].includes(state.activeStep)) state.activeStep = '01';
  const catalog = (key, all) => D.calculator[key].map(id => all.find(x => x.id === id)).filter(Boolean);
  const mainland = catalog(D.calculator.departureBanks ? 'departureBanks' : 'mainland', D.mainlandBanks),
    mainlandReceivers = catalog(D.calculator.receivingBanks ? 'receivingBanks' : 'mainland', D.mainlandBanks), banks = catalog('hkBanks', D.hkBanks),
    returnBanks = catalog(D.calculator.returnBanks ? 'returnBanks' : 'hkBanks', D.hkBanks), brokers = catalog('brokers', D.brokers);
  if (!mainland.some(bank => bank.id === state.startBank)) {
    state.startBank = 'boc'; state.plan = 'custom';
    for (const key of ['startSell', 'senderFeeCny', 'entryMiddleCny', 'mainlandMethod']) state[key] = '';
    state = M.calculatorRoute(state);
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {}
  }
  if (!mainlandReceivers.some(bank => bank.id === state.exitBank)) {
    state.exitBank = 'boc'; state.plan = 'custom';
    for (const key of ['exitPrice', 'returnExtraCny', 'returnWireHkd', 'returnMethod']) state[key] = '';
    state = M.calculatorRoute(state);
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {}
  }
  const comparisonData = { ...D, mainlandBanks: mainland };
  const quoteKeys = ['brokerExitPrice', 'directInwardCny', 'atmCnyPerUnit', 'atmExtraCny', 'atmDailyLimitCny', 'atmPerTransactionCny', 'senderFeeCny', 'entryMiddleCny', 'entryInwardHkd', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'monthlyHkd', 'returnMonthlyHkd', 'startSell', 'entryPrice', 'exitPrice', 'returnHkdPrice', 'cardCnyPerHkd', 'usdCny', 'usdHkd', 'usdCnh'];
  const outcomes = [['broker-balance', '留在买股账户'], ['usd-balance', '取回香港银行 · 保留出金币种'], ['mainland', '内地银行卡 · 到账后结汇'], ['mainland-usd', '内地美元账户 · 暂不结汇'], ['cnh-card', '内地商户消费 · 香港卡'], ['atm', '内地ATM · 提取人民币现金'], ['usd-card', '境外美元原币消费']];
  const currencyNames = { CNH: '人民币原币', USD: '美元', HKD: '港币' };
  const stageNames = ['内地出发', '香港收款', '入金与买股', '卖出后的资金'];
  const stageKeys = [['entryFx', 'sender', 'entryMiddle'], ['entryInward', 'account'],
    ['depositBank', 'depositOther', 'depositBroker', 'brokerSpread', 'brokerFx', 'trade', 'brokerAccount'],
    ['brokerExitCommission', 'brokerExitFx', 'withdraw', 'returnInward', 'withdrawMiddle', 'cashFx', 'atmFee', 'atmOther', 'returnFx', 'returnWire', 'returnOther', 'exitFx', 'card', 'cardFx', 'extra']];
  const options = new Map();
  const esc = value => H.esc(value), num = (value, digits = 2) => Number.isFinite(Number(value)) && value != null ? H.money(Number(value), digits) : '—';
  const action = (label, act, extra = '', cls = 'btn') => H.action(label, 'money-flow-' + act, cls, extra);
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {} };
  if (repairIbkrLite || repairLiteFunding || repairStoredEntry || repairBankFeeDefaults || repairConsumption || repairUsFunding) save();
  const pct = value => {
    const percent = value * 100, magnitude = Math.abs(percent);
    const digits = magnitude > 0 && magnitude < .0005 ? Math.ceil(-Math.log10(magnitude)) + 2 : 3;
    return (digits > 12 ? percent.toExponential(2) : num(percent, digits)) + '%';
  };
  const quoteNum = value => num(value, 8).replace(/0+$/, '').replace(/\.$/, '');
  const shortName = value => value?.name?.replace(' · Pro Fixed', '').replace(' · 网上直属客户', '').replace(' · 个人标准账户', '').replace(' · 普通个人账户', '').replace(' · 美股交易', '').replace(' · Trade25 / 普通证券', '证券').replace(' · Schwab One International', '') || '请选择';
  const cost = value => value == null ? '—' : Math.abs(value) > 0 && Math.abs(value) < .005 ? (value < 0 ? '−' : '') + '＜0.01 CNY' : num(value) + ' CNY';
  const amount = (value, currency) => '<b class="num">' + num(value) + ' <small>' + esc(currency) + '</small></b>';
  const source = key => D.sources[key] ? '<a class="source-link" target="_blank" rel="noopener noreferrer" href="' + esc(D.sources[key].url) + '">' + esc(D.sources[key].name) + ' ↗</a>' : '';
  const evidenceSources = {
    mainlandTariff: { boc: ['boc'], cib: ['cib'], cmb: ['cmbTariff'], icbc: ['icbcOnline', 'icbcInternational'], ccb: ['ccbRemit'], comm: ['comm'], hsbc: ['hsbcCnTariff'], hang: ['hangCnTariff'], sc: ['scCnTariff', 'scCnOffers'] },
    mainlandReceipt: { boc: ['bocBankAnswer2026'], cib: ['cibInward'], cmb: ['cmbTariff'], icbc: ['icbcInward'], ccb: ['ccbRemit'], comm: ['comm'], hsbc: ['hsbcCnTariff'], hang: ['hangCnTariff'], sc: ['scCnTariff'] },
    mainlandFx: { boc: ['bocFx'], cib: ['cibFx', 'cibCard'], cmb: ['cmbFx'], icbc: ['icbcFx'], ccb: ['ccbFx'], comm: ['commFx'], hsbc: ['hsbcFx'], hang: ['hangCnFx'], sc: ['scFx'] },
    linked: { hsbc: ['hsbcGlobal'], hang: ['hang'], sc: ['sc', 'scGlobalFaq'] },
    hkTariff: { bochk: ['bochk'], hsbc: ['hsbcHk'], za: ['za', 'zaLocalUsd', 'zaTariff', 'zaPerksNov'], hang: ['hangHk'], sc: ['scHk'], 'icbc-asia': ['icbcAsiaInward', 'icbcAsiaInwardOffer', 'icbcAsiaOutwardOffer'] },
    hkFx: { bochk: ['bochkUsdFx'], hsbc: ['hsbcHkFx'], hang: ['hangHkFx'], za: ['zaFx', 'zaExchangeLimits'], sc: ['scHkFx', 'scHkFxTerms'], 'icbc-asia': ['icbcAsiaFx'] },
    hkAccount: { bochk: ['bochkAccount'], hsbc: ['hsbcOne', 'hsbcOneBalance'], za: ['zaOpen', 'zaPerks', 'zaPerksNov'], hang: ['hangHk'], sc: ['scHk'], 'icbc-asia': ['icbcAsiaAccount', 'icbcAsiaAccountTerms'] },
    hkCard: { bochk: ['bochkCard'], hsbc: ['hsbcCard'], za: ['zaCard'], hang: ['hangCard'], sc: ['scCard'], 'icbc-asia': ['icbcAsiaCard', 'icbcAsiaAccountTerms'] },
    brokerTrade: { 'ibkr-lite': ['ibStocks', 'ibLite'], ibkr: ['ibStocks'], hsbc: ['hsbcUsTariff'], za: ['zaStocks', 'zaStockUnits', 'zaCustody'], chief: ['chiefStocks'], usmart: ['usmartFees', 'usmartStockUnits'], firstrade: ['firstradePricing', 'firstradeFractions'], schwab: ['schwabPricing', 'schwabGuide', 'schwabFractions'] },
    brokerOffers: { hsbc: ['trade25', 'trade25Age', 'trade25One'], za: ['zaStockService', 'zaPerks'], chief: ['chiefMonthly', 'chiefMonthlyTerms'], usmart: ['usmartPromo'] },
    brokerFunding: { 'ibkr-lite': ['ibFundingCNH', 'ibFundingHKD', 'ibFundingUs', 'ibFunding', 'ibLite', 'ibConversion', 'ibCnhDeposits'], ibkr: ['ibDeposits', 'ibFunding'], hsbc: ['hsbcStocks'], za: ['zaStockService'], chief: ['chiefFunding'], usmart: ['usmartFundingAccounts', 'usmartSameFunding'], firstrade: ['firstradeWire'], schwab: ['schwabWire', 'schwabGuide'] },
    brokerWithdrawal: { 'ibkr-lite': ['ibFees'], ibkr: ['ibFees'], hsbc: ['hsbcStocks'], za: ['zaStockService'], chief: ['chiefFunding'], usmart: ['usmartWithdrawal'], firstrade: ['firstradeWireFees'], schwab: ['schwabGuide'] }
  };
  const evidenceFor = (kind, account) => evidenceSources[kind]?.[account?.id] || (account?.id === 'ccb-asia' ?
    kind === 'hkFx' ? ['ccbAsiaFx'] : kind === 'hkCard' ? D.mainlandSpending['ccb-asia'].sources : ['ccbAsiaTariff', 'ccbAsiaLongCard'] : []);
  const isChequeReturn = s => state.outcome !== 'broker-balance' && (s.broker?.withdrawalMethod === 'cheque' || s.broker?.localChequeBanks?.includes(s.returning?.id));
  function actionSources(stage, s, r) {
    const broker = s.broker, keys = [], add = (kind, account) => keys.push(...evidenceFor(kind, account));
    const settlement = banks.find(bank => bank.id === broker?.integratedBank);
    const mainlandMethod = r?.mainlandMethod || state.mainlandMethod;
    if (stage === '01') {
      if (mainlandMethod === 'payment-connect') keys.push(...D.paymentConnect.sources, D.paymentConnect.southbound.reportedSource,
        ...(D.paymentConnect.southbound.bankLimits[s.start?.id]?.sources || []), ...(D.paymentConnect.inwardSources[s.bank?.id] || []));
      if (mainlandMethod === 'boc-mobile' && s.start?.id === 'boc') keys.push('bocMobile2026', 'bocMobileUsdGuide');
      else if (mainlandMethod === 'boc-online' && s.start?.id === 'boc') keys.push('bocBankAnswer2026');
      else add('mainlandTariff', s.start);
      if (state.route !== 'CNH') add('mainlandFx', s.start);
      if (s.start?.id === 'cib') keys.push('cibCard');
      if (mainlandMethod === 'cib-go' && s.start?.id === 'cib') keys.push('cibGo', 'swiftGoBanks');
      if (mainlandMethod === 'full') keys.push(...(s.start?.fullAmountSources || []));
      if (mainlandMethod === 'linked') add('linked', s.start);
      keys.push(...(r?.rows?.find(item => item.key === 'entryMiddle')?.sources || []));
      if (s.bank?.id === 'bochk' && s.start?.group === 'boc') keys.push('bochkSame');
      else add('hkTariff', s.bank);
    } else if (stage === '03') {
      add('hkTariff', s.bank); add('hkTariff', settlement); add('hkTariff', r?.fundingBank || M.calculatorFundingBank(state, D)); add('brokerFunding', broker);
      if ((r?.depositMethod || state.depositMethod) === 'wise') keys.push(...D.wiseFunding.sources);
      keys.push(...(r?.rows?.find(item => item.key === 'depositOther')?.sources || []));
      if (state.route !== 'USD' && !autoFxAtPurchase(r)) state.fxMode === 'bank' ? add('hkFx', s.bank) : keys.push('ibFx');
      if (broker?.id === 'ibkr') {
        keys.push('ibFunding' + (state.route === 'USD' || state.fxMode === 'bank' ? 'USD' : state.route));
        if ((r?.depositMethod || state.depositMethod) === 'edda') keys.push('ibEdda');
        if ((r?.depositMethod || state.depositMethod) === 'chats') keys.push('ibLocalUsd', 'ibLocalCiti');
      }
      if (broker?.id === 'chief') keys.push('chiefDeposit');
      if (broker?.id === 'usmart') {
        if ((r?.depositMethod || state.depositMethod) === 'fps') keys.push('usmartFps');
        if ((r?.depositMethod || state.depositMethod) === 'edda') keys.push('usmartEdda');
      }
      if (broker?.id === 'usmart' && s.bank?.id === 'bochk') keys.push('usmartBocFunding');
    } else if (stage === 'trade' || stage === 'offers') {
      add('brokerTrade', broker); keys.push('secFees', 'finraHoliday', 'finraSchedule');
      if (autoFxAtPurchase(r)) keys.push('ibFx', 'ibAutoFxTerms');
      const offerEnabled = ({ hsbc: state.trade25, za: M.zaPerksLevel(state) === 'lv2', chief: state.chiefMonthly, usmart: state.usmartPromo })[broker?.id];
      if (stage === 'offers' || offerEnabled) add('brokerOffers', broker);
    } else if (stage === 'withdraw') {
      if (state.withdrawCurrency === 'CNH') keys.push('ibFx', 'ibCnhWithdrawal');
      keys.push(...(r?.rows?.find(item => item.key === 'returnInward')?.sources || []));
      if (state.withdrawDestination === 'mainland') add('mainlandReceipt', s.exit);
      add('brokerWithdrawal', broker); add('hkTariff', settlement); add('hkTariff', s.returning);
      if (s.returning?.id === 'za' && broker?.withdrawalMethod === 'cheque') keys.push('zaAccountTerms');
      if (s.returning?.id === 'bochk' && ['cheque', 'local'].includes(broker?.withdrawalMethod)) keys.push('bochkCheque');
      if (isChequeReturn(s) && s.returning?.localUsdChequeTariff) keys.push(...s.returning.localUsdChequeTariff.sources);
    } else if (stage === 'return-fx') {
      add('hkFx', s.returning);
    } else if (stage === 'settle') {
      add('mainlandFx', s.exit);
    } else if (stage === '04' || stage === 'remit') {
      if (state.outcome === 'atm') keys.push(...(M.mainlandCashProfile(state, D)?.sources || []));
      if (['mainland', 'mainland-usd'].includes(state.outcome)) {
        add('hkTariff', s.returning); add('mainlandReceipt', s.exit);
        if (stage === '04') { add('mainlandFx', s.exit); if (state.returnCurrency === 'HKD') add('hkFx', s.returning); }
        keys.push(...(r?.rows?.find(item => item.key === 'returnOther')?.sources || []));
        if (s.returning?.id === 'bochk' && s.exit?.group === 'boc') keys.push('bochkSame');
        if ((r?.returnMethod || state.returnMethod) === 'linked') add('linked', s.exit);
        if (s.returning?.id === 'za') keys.push('zaNov');
      } else if (['usd-card', 'cnh-card'].includes(state.outcome)) {
        add('hkCard', s.returning); keys.push(...(D.mainlandSpending?.[s.returning.id]?.sources || [])); if (state.outcome === 'cnh-card') add('hkFx', s.returning);
        keys.push(...(r?.rows?.find(item => item.key === 'exitFx')?.sources || []));
      }
    }
    return [...new Set(keys)];
  }
  function journeySources(s, r) {
    const stages = ['01', '03', 'trade', ...(state.outcome === 'broker-balance' ? [] : ['withdraw', '04'])];
    return [...new Set([...stages.flatMap(stage => actionSources(stage, s, r)),
      ...bankAccountSet(s).flatMap(bank => evidenceFor('hkAccount', bank)),
      ...[s.start, ...(state.outcome === 'mainland' ? [s.exit] : [])].flatMap(bank => bank?.accountService?.sources || []), 'tax'])];
  }
  let cacheKey, cacheResult;
  function result() {
    const inputs = { ...state, date: today(), sellDate: today() }, key = JSON.stringify(inputs);
    if (key !== cacheKey) { cacheKey = key; cacheResult = M.calculatorJourney(inputs, D, window.MONEY_FLOW_QUOTES || {}); }
    return cacheResult;
  }
  const selected = () => ({ start: D.mainlandBanks.find(x => x.id === state.startBank), bank: D.hkBanks.find(x => x.id === state.bank),
    broker: M.selectedBroker(state, D), returning: D.hkBanks.find(x => x.id === state.returnBank), exit: D.mainlandBanks.find(x => x.id === state.exitBank) });
  const row = (r, key) => r?.rows?.find(x => x.key === key);
  function field(key, label, unit = '', placeholder = '') {
    const dateField = ['voucherExpiry', 'sellDate'].includes(key);
    const monthField = key === 'months' || key.endsWith('FreeMonths'), value = M.number(state[key]), empty = String(state[key] ?? '').trim() === '';
    const positiveInteger = ['count', 'buyOrders', 'sellOrders', 'withdrawalIndex', 'chequeIndex', 'atmTransactions'];
    const nonnegativeInteger = ['usedFreeTransfers', 'usedPromoOrders', 'usmartDays', 'zaSwiftUsed'];
    const positiveValue = ['budgetCny', 'sharePriceUsd', 'atmAmountCny'];
    const optionalPrice = ['brokerExitPrice', 'atmCnyPerUnit', 'startSell', 'entryPrice', 'exitPrice', 'returnHkdPrice', 'cardCnyPerHkd', 'usdCny', 'usdHkd', 'usdCnh'];
    let issue = '';
    if (monthField && (key === 'months' || !empty) && (value == null || value < 0 || !Number.isInteger(value))) issue = '月数须为非负整数。';
    else if (key === 'months' && value > 1200) issue = '账户使用月数须为0–1200的整数。';
    else if (key === 'hkHsbcFreeMonths' && value > 3) issue = 'One剩余免收费月数须为0–3的整数。';
    else if (positiveInteger.includes(key) && (value == null || value < 1 || !Number.isInteger(value) || (!['withdrawalIndex', 'chequeIndex'].includes(key) && value > 120)))
      issue = key === 'withdrawalIndex' ? '出金次数须为正整数。' : key === 'chequeIndex' ? '当日存票序号须为正整数。' : '笔数须为1–120的整数。';
    else if (key === 'voucherOrders' && (value == null || value < 1 || value > 240 || !Number.isInteger(value))) issue = '费用券适用订单数须为1–240的整数。';
    else if (nonnegativeInteger.includes(key) && !empty && (value == null || value < 0 || !Number.isInteger(value))) issue = '须为非负整数。';
    else if (positiveValue.includes(key) && !(value > 0)) issue = '须为有效正数。';
    else if (optionalPrice.includes(key) && !empty && !(value > 0)) issue = '汇率须为有效正数；留空使用公开报价。';
    else if (key === 'taxRate' && (value == null || value < 0 || value > 100)) issue = '税率须为0–100%。';
    else if (key === 'profitUsd' && value == null) issue = '请输入有效盈亏金额。';
    else if (!dateField && !empty && !positiveInteger.includes(key) && !positiveValue.includes(key) && key !== 'profitUsd' &&
      (value == null || value < 0)) issue = '须为非负数；未报价请留空。';
    if (!issue && result().partial?.errorField === key) issue = result().error;
    return '<label class="flow-field"><span>' + esc(label) + '</span><div class="flow-input"><input ' +
      (dateField ? 'type="date"' : 'type="text" inputmode="' + (monthField ? 'numeric' : 'decimal') + '"') +
      (issue ? ' aria-invalid="true" aria-describedby="flow-error-' + key + '"' : '') +
      ' data-money-field="' + key + '" aria-label="' + esc(label) + '" value="' + esc(state[key]) + '" placeholder="' + esc(placeholder) + '">' +
      (unit ? '<span>' + esc(unit) + '</span>' : '') + '</div>' +
      (issue ? '<small class="flow-field-error" id="flow-error-' + key + '" role="status">' + esc(issue) + '</small>' : '') + '</label>';
  }
  function checkbox(key, label, accessibleLabel = label) {
    return '<label class="flow-offer"><input type="checkbox" data-money-check="' + key + '" aria-label="' + esc(accessibleLabel) + '"' + (state[key] ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }
  function selectChevron() {
    return '<svg class="flow-select-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function select(key, label, values, value = state[key]) {
    options.set(key, { label, values, value });
    const current = values.find(([id]) => id === value);
    const channelNames = { 'boc-mobile': '手机银行 · 本行汇款', 'boc-online': '手机／网银 · 他行汇款',
      'icbc-mobile': '手机银行 · 工银亚洲', 'cib-go': '小额全额到账', full: '美元全额到账', linked: '同名专用转账' };
    const shortSettings = { outcome: { atm: '内地ATM取现', 'mainland-usd': '内地美元账户', 'usd-balance': '银行保留原币' }, atmMode: { 'hsbc-group': '汇丰ATM · Mastercard', 'hsbc-other': '他行ATM · Mastercard', 'bochk-unionpay': '银联ATM · 中银卡', 'icbc-hkd': '工行ATM · 港币卡', 'icbc-cnh': '银联ATM · 人民币卡', 'ccb-link-hkd': '建行ATM · 陆港通' } };
    const displayValue = shortSettings[key]?.[value] || (key === 'zaPerksLevel' ? current?.[1]?.replace('ZA Perks · ', '') :
      key === 'mainlandMethod' ? channelNames[value] || current?.[1]?.replace(' · 公开标准价', '') : current?.[1]);
    if (values.length === 1 && current) return '<div class="flow-field"><span>' + esc(label) + '</span><div class="flow-control-value">' + esc(displayValue) + '</div></div>';
    return '<div class="flow-field"><span>' + esc(label) + '</span>' + (values.length > 1 && values.length <= 3 && ['route', 'returnCurrency', 'voucherScope'].includes(key) ?
      '<div class="flow-segments" role="group" aria-label="' + esc(label) + '">' + values.map(([id, text]) => action(esc(text), 'choose', 'data-field="' + key + '" data-value="' + esc(id) + '" aria-pressed="' + (id === value) + '"', 'flow-segment')).join('') + '</div>' :
      action('<span>' + esc(displayValue || '请选择' + label) + '</span>' + selectChevron(), 'control-pick', 'data-value="' + key + '" aria-haspopup="dialog" aria-label="' + esc(label + '：' + (current?.[1] || '请选择')) + '"', 'flow-control-button')) + '</div>';
  }
  function zaRights(label) {
    return select('zaPerksLevel', label, [['standard', 'ZA Perks · 标准'], ['lv1', 'ZA Perks · Lv1'], ['lv2', 'ZA Perks · Lv2']]);
  }
  function accountGlyph(key, item) {
    if (!item) return '';
    const brand = key === 'broker' ? item.id : item.group || item.id;
    const logos = { boc: 'boc.png', cib: 'cib.png', cmb: 'cmb.ico', icbc: 'icbc.png', ccb: 'ccb.png', comm: 'comm.png',
      hsbc: 'hsbc.png', hang: 'hang.svg', sc: 'sc.png', za: 'za.png', ibkr: 'ibkr.png', 'ibkr-lite': 'ibkr.png', chief: 'chief.png', usmart: 'usmart.ico', firstrade: 'firstrade.png', schwab: 'schwab.png', wise: 'wise.png' };
    return logos[brand] ? '<span class="flow-account-icon" data-brand="' + esc(brand) + '"><img src="assets/institutions/' + logos[brand] + '" alt="' + esc(shortName(item) + '标识') + '" width="40" height="40"></span>' : '';
  }
  function account(key, label, item) {
    const displayName = item?.id === 'icbc-asia' ? '工银亚洲' : key === 'startBank' && item?.id === 'cib' ? '兴业寰宇人生' : shortName(item);
    return '<div class="flow-account-field"><span class="flow-account-label">' + esc(label) + '</span>' +
      action('<span class="flow-account-main">' + accountGlyph(key, item) + '<strong>' + esc(displayName) + '</strong>' + selectChevron() + '</span>',
        'pick', 'data-value="' + key + '" aria-haspopup="dialog" aria-label="' + esc(label + '：' + shortName(item) + '，更换') + '"', 'flow-account-button') + '</div>';
  }
  function sourceTariffCopy(bank) {
    if (!bank || !mainland.some(item => item.id === bank.id)) return '请选择目录中的出发银行。';
    if (state.mainlandMethod === 'payment-connect') return state.paymentConnectFeeWaived ? '跨境支付通 · 按已享手续费豁免测算' : '跨境支付通 · 南向汇出服务费待确认';
    if (state.route !== 'CNH') {
      if (bank.id === 'cib' && today() > bank.commissionWaiver.until) return '外汇优惠已到期；按标准1‰、50–200元＋100元电讯费';
      return bank.feeText;
    }
    const waiver = bank.cnhTariff?.commissionWaiver;
    if (waiver && today() >= waiver.from && today() <= waiver.until) return waiver.feeText;
    if (bank.cnhTariff?.feeText) return bank.cnhTariff.feeText;
    if (bank.cnhTariff === true) return '人民币跨境' + num(bank.rate * 1000, 0) + '‰，' + bank.minimum + '–' + bank.maximum + '元＋' + bank.telegram + '元电讯费';
    return '人民币跨境汇出手续费／电讯费：尚未取得适用价目';
  }
  function entryMethods() {
    const s = selected(), tariff = state.route === 'CNH' && typeof s.start?.cnhTariff === 'object' ? s.start.cnhTariff : s.start;
    let channel = s.start?.id === 'cib' ? '普通汇款' : tariff?.tariffChannel || '普通汇款 · 公开标准价';
    if (state.route === 'CNH') channel = typeof s.start?.cnhTariff === 'object' ? tariff.tariffChannel :
      s.start?.cnhTariff ? '人民币跨境电汇 · 公开标准价' : '人民币跨境汇款';
    const values = [['swift', channel]];
    if (s.start?.id === 'boc' && s.bank?.id === 'bochk' && state.route !== 'CNH') values.unshift(['boc-mobile', '手机银行 · 向同名境外中行汇款']);
    if (s.start?.id === 'icbc' && s.bank?.id === 'icbc-asia' && s.start.groupMobileTariff?.currencies.includes(state.route)) values.unshift(['icbc-mobile', '手机银行 · 向工银亚洲本行费免']);
    if (s.start?.id === 'boc' && s.bank?.group !== 'boc' && state.route !== 'CNH') values.unshift(['boc-online', '手机银行／网银 · 向他行9折']);
    if (s.start?.id === 'cib' && state.route !== 'CNH') values.push(['cib-go', '小额全额到账 · 另加50 CNY/笔']);
    if (state.route === 'USD' && s.start?.fullAmountUsd != null) values.push(['full', '美元全额到账 · ' + (s.start.fullAmountChannel ? s.start.fullAmountChannel + ' · ' : '') + '另加' + s.start.fullAmountUsd + ' USD/笔']);
    if (['hsbc', 'hang', 'sc'].includes(s.start?.id) && s.start.group === s.bank?.group && (!s.start.linkedCurrencies || s.start.linkedCurrencies.includes(state.route))) values.unshift(['linked', ({ hsbc: '同名环球转账', hang: '优越理财 · 同名跨域转账', sc: '优先理财 · 同名速汇' })[s.start.id] + ' · 免费']);
    values.push(['payment-connect', '跨境支付通']);
    return values.filter(([id]) => availableChannels(state).mainlandMethods.includes(id));
  }
  function depositMethods() {
    const s = selected(), currency = state.fxMode === 'bank' ? 'USD' : state.route;
    const recipient = M.calculatorDepositBank({ ...state, depositMethod: 'chats' }, D);
    const labels = {
      internal: s.broker.integratedBank ? '本行存款直接交收' : '同行转账 → 券商收款账户 · 免费',
      chats: s.broker.integratedBank ? '本地美元转账 → 本人' + shortName(banks.find(b => b.id === s.broker.integratedBank)) + '账户' : s.broker.id === 'ibkr' ? '香港收款指示 · USD本地转账' : recipient ? 'CHATS → 券商的' + routeName(recipient.id, 'bank') + '收款账户' : '本地美元转账 · CHATS',
      swift: currency !== 'USD' ? '外币电汇 · SWIFT' : s.broker.usdDepositMethods ? '美国收款账户 · USD SWIFT' : s.broker.swiftDestination === 'hong-kong' ? '香港收款账户 · USD SWIFT' : '境外收款指示 · USD电汇',
      fps: '本地转账 · FPS', edda: '券商发起扣款 · eDDA', wise: 'USD经本人Wise → IBKR'
    };
    for (const id of s.broker.internalFundingBanks || []) labels['via-' + id] = '经本人' + routeName(id, 'bank') + ' USD账户 → 同行入金';
    for (const id of s.broker.corporateReceivingBanks || s.broker.internalFundingBanks || []) labels['chats-' + id] = 'CHATS → 券商的' + routeName(id, 'bank') + '收款账户';
    return availableChannels(state).depositMethods.map(id => [id, labels[id]]);
  }
  function returnMethods() {
    const s = selected(), values = [['swift', '普通网上电汇']];
    if (s.returning?.id === 'bochk' && s.exit?.group === 'boc') values.unshift(['bochk-fast', '中银快汇 → 同名内地中行']);
    if (s.returning?.id === 'icbc-asia' && s.exit?.group === 'icbc') values.unshift(['icbc-express', '工银速汇 → 同名内地工行']);
    if (['hsbc', 'hang', 'sc'].includes(s.returning?.id) && s.returning.group === s.exit?.group) values.unshift(['linked', '两地同集团 · 同名专用转账']);
    return values.filter(([id]) => availableChannels(state).returnMethods.includes(id));
  }
  function presetState(p) {
    const next = M.calculatorRoute({ ...state, withdrawCurrency: 'USD', withdrawDestination: 'hong-kong', directReceiptConfirmed: false, fxMode: '', depositMethod: '', returnMethod: '', ...p.config,
      budgetCny: state.budgetCny, sellDate: today(), plan: p.id, activeStep: '01' });
    for (const key of quoteKeys) next[key] = '';
    next.tradeFeeUsd = '';
    return next;
  }
  let visiblePresets = [];
  const routeName = (id, kind) => (kind === 'mainland' ? { boc: '中行', cib: '兴业', cmb: '招行', icbc: '工行', ccb: '建行', comm: '交行', hsbc: '汇丰中国', hang: '恒生中国', sc: '渣打中国' } :
    kind === 'bank' ? { bochk: '中银香港', hsbc: '汇丰香港', hang: '恒生香港', sc: '渣打香港', za: 'ZA', 'icbc-asia': '工银亚洲', 'ccb-asia': '建行亚洲', citic: '中信国际' } :
      { ibkr: 'IBKR Pro', 'ibkr-lite': 'IBKR Lite', hsbc: '汇丰证券', chief: '致富', usmart: '盈立', za: 'ZA', firstrade: 'Firstrade', schwab: '嘉信国际' })[id] || id;
  function candidatePresets() {
    return M.calculatorPreferredPlans(D, window.MONEY_FLOW_QUOTES || {}, today()).map(p => {
      const r = p.calculated.selected || p.calculated.partial;
      return { ...p, rows: r?.rows || [], complete: !!p.calculated.selected && !!r?.complete, total: r?.costCny };
    });
  }
  function toolbar() {
    visiblePresets = candidatePresets();
    return '<div class="flow-toolbar"><h2>优选方案</h2><div>' + action('报价与依据', 'detail', 'data-value="quotes"', 'text-link') + action('重置', 'reset', '', 'text-link') + '</div></div>' +
      '<div class="flow-presets" aria-label="优选方案">' + visiblePresets.map(p => {
        const r = p.calculated.selected || p.calculated.partial;
        const original = D.preferredPlans.find(plan => plan.id === p.id).config;
        const actualQuotes = M.calculatorAdjustmentFields(state, D).some(key => (quoteKeys.includes(key) || key === 'tradeFeeUsd') && String(state[key] ?? '').trim() !== '');
        const applied = state.plan === p.id && !actualQuotes && !state.useVoucher && Object.entries(original).every(([key, value]) => String(state[key]) === String(value)) && state.hsbcBalanceWaiver;
        const start = p.config.startBank === 'cib' ? '兴业寰宇人生' : routeName(p.config.startBank, 'mainland');
        const stock = p.config.broker === 'hsbc' && p.config.trade25 ? '汇丰Trade25' : p.config.broker === 'ibkr' ? 'IBKR Pro' : routeName(p.config.broker, 'broker');
        // Account roles share columns. An optional intermediary adds its own
        // node; a direct transfer spans those tracks as a single arrow.
        const mainlandSpend = p.config.outcome === 'mainland', cnhReturn = p.config.withdrawCurrency === 'CNH';
        const stops = [
          { column: 1, name: start, caption: p.config.route === 'CNH' ? '人民币原币' : '美元汇出', key: 'startBank', item: mainland.find(bank => bank.id === p.config.startBank) },
          { column: 3, name: routeName(p.config.bank, 'bank'), caption: p.config.route === 'CNH' ? '人民币到账' : '美元到账', key: 'bank', item: banks.find(bank => bank.id === p.config.bank) },
          ...(p.config.depositMethod === 'wise' ? [{ column: 5, name: '本人Wise', caption: '美元转入', key: 'bridge', item: D.wiseFunding }] : []),
          { column: 7, name: stock, caption: p.config.route === 'CNH' ? '人民币换美元' : '美元买卖美股', key: 'broker', item: brokers.find(broker => broker.id === p.config.broker) },
          { column: 9, name: routeName(p.config.returnBank, 'bank'), caption: cnhReturn ? '人民币取回' : mainlandSpend ? '美元取回' : '美元换人民币', key: 'returnBank', item: returnBanks.find(bank => bank.id === p.config.returnBank) },
          ...(mainlandSpend ? [{ column: 11, name: '内地' + routeName(p.config.exitBank, 'mainland'), caption: '美元结汇', key: 'exitBank', item: mainlandReceivers.find(bank => bank.id === p.config.exitBank) }] : []),
          { column: 13, name: mainlandSpend ? '内地消费' : '内地刷卡', caption: mainlandSpend ? '内地银行卡' : 'Mastercard' }
        ];
        const route = stops.map((stop, i) => (i ? '<span class="flow-preset-arrow" style="grid-column:' + (stops[i - 1].column + 1) + '/' + stop.column + '" aria-hidden="true">→</span>' : '') +
          '<span class="flow-preset-node" style="grid-column:' + stop.column + '" data-route-role="' + (stop.key || 'consumption') + '"><span class="flow-preset-account">' + accountGlyph(stop.key, stop.item) + '<strong>' + esc(stop.name) + '</strong></span>' +
          '<small>' + esc(stop.caption) + '</small></span>').join('');
        const hasPrice = !!p.calculated.selected && Number.isFinite(p.total);
        const priceLabel = !p.complete ? '已计费用' : p.rows.some(x => x.estimate) ? '全程参考' : '全程费用';
        const missing = !p.complete ? r?.missing?.join('、') || p.calculated.error || '缺报价' : '';
        const price = '<span class="flow-preset-quote">' + (hasPrice ? '<span class="flow-preset-price"><small>' + priceLabel + '</small><b>' + pct(p.total / 100000) + '</b><small>' + cost(p.total) + '</small></span>' : '') +
          (missing ? '<small class="flow-preset-missing">缺项：' + esc(missing) + '</small>' : '') +
          (p.note ? '<small class="flow-preset-note">' + esc(p.note) + '</small>' : '') + '</span>';
        return action('<span class="flow-preset-route">' + route + '</span>' + price,
          'preset', 'data-value="' + p.id + '" aria-pressed="' + applied + '" aria-label="优选方案：' + esc(p.title) + '"', 'flow-preset');
      }).join('') + '</div>';
  }
  const transferKeys = ['entryFx', 'sender', 'entryMiddle', 'entryInward'];
  const fundingKeys = ['depositBank', 'depositOther', 'depositBroker', 'brokerSpread', 'brokerFx'];
  const tradingKeys = ['trade', 'brokerAccount'];
  const autoFxAtPurchase = r => M.supportsBrokerFx(r?.broker?.id || state.broker) && (r?.route || state.route) !== 'USD' && (r?.fxMode || state.fxMode) === 'auto';
  const fundingRowKeys = r => autoFxAtPurchase(r) ? fundingKeys.filter(key => !['brokerSpread', 'brokerFx'].includes(key)) : fundingKeys;
  const tradingRowKeys = r => autoFxAtPurchase(r) ? [...tradingKeys, 'brokerSpread', 'brokerFx'] : tradingKeys;
  const withdrawKeys = ['brokerExitCommission', 'brokerExitFx', 'withdraw', 'returnInward', 'withdrawMiddle'];
  const exitKeys = ['returnFx', 'returnWire', 'returnOther', 'exitFx', 'card', 'cardFx', 'cashFx', 'atmFee', 'atmOther'];
  const returnTransferKeys = ['returnWire', 'returnOther'];
  const costRows = (r, keys) => (r?.rows || []).filter(x => keys.includes(x.key));
  const displayCostCache = new WeakMap();
  function displayCosts(r) {
    if (!r) return null;
    if (!displayCostCache.has(r)) displayCostCache.set(r, M.roundedCosts(r, [transferKeys, fundingRowKeys(r), tradingRowKeys(r), withdrawKeys,
      ...(state.outcome === 'mainland' ? [['returnFx'], returnTransferKeys, ['exitFx']] : [exitKeys]), ['account', 'extra']]));
    return displayCostCache.get(r);
  }
  function displayCny(r, item) {
    if (item?.cny == null) return null;
    const view = displayCosts(r);
    return view?.amounts.get(item) ?? view?.byKey.get(item.key) ?? item.cny;
  }
  const displayCost = (r, item) => cost(displayCny(r, item) === 0 && item?.cny !== 0 ? item.cny : displayCny(r, item));
  const sumRows = (rows, r) => rows.reduce((sum, x) => sum + ((r ? displayCny(r, x) : x.cny) ?? 0), 0);
  const displaySum = (rows, r) => cost(sumRows(rows, r) === 0 && sumRows(rows) !== 0 ? sumRows(rows) : sumRows(rows, r));
  function countedRatio(total, partial) {
    const budget = M.number(state.budgetCny);
    return budget > 0 && Number.isFinite(total) && (!partial || total !== 0) ? pct(total / budget) : null;
  }
  function missingFeeStatus(r, item, part = item) {
    if (item.key === 'brokerSpread') return ((r?.fxMode || state.fxMode) === 'bank' ? shortName(r?.bank) : 'IBKR') + ' ' + state.route + '/USD成交价尚未取得';
    if (part.status || item.status) return part.status || item.status;
    if (['entryFx', 'returnFx', 'exitFx'].includes(item.key)) return '尚缺该银行换汇报价';
    if (['entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther'].includes(item.key)) return '此汇路代理／收款行收费未公开';
    return '该项资费依据未取得';
  }
  function detailRows(r, rows) {
    return '<div class="flow-cost-detail">' + rows.flatMap(item => (item.items?.length ? item.items : [item]).map(part =>
      '<div><span>' + esc(part.label) + (part.months != null ? '<small>' + esc(accountFeeBasis(part)) + '</small>' : '') +
      '</span><b>' + (part.cny == null ? esc(missingFeeStatus(r, item, part)) : (part.estimate ?? item.estimate ? '估算 ' : '') + displayCost(r, part)) + '</b></div>')).join('') + '</div>';
  }
  function loss(r, keys, pending = '') {
    const rows = costRows(r, keys), total = sumRows(rows, r), missing = rows.some(x => x.cny == null);
    const stale = r?.quoteFreshness && (r.quoteFreshness.reference === false || keys.includes('entryFx') && r.quoteFreshness.source === false ||
      keys.includes('brokerSpread') && r.quoteFreshness.entryMarket === false || keys.includes('exitFx') && !r.indicativeExit && !r.indicativeReturnFx && r.quoteFreshness.exit === false);
    const variableFx = rows.some(x => x.cny == null && ['entryFx', 'brokerSpread', 'brokerExitFx', 'returnFx', 'exitFx', 'cashFx'].includes(x.key));
    const partial = !!pending || variableFx || missing;
    const estimated = rows.some(x => x.estimate);
    const ratio = countedRatio(sumRows(rows), partial);
    const label = (partial ? (ratio ? estimated ? '已计费用占本金 · 含估算' : '已核费用占本金' : estimated ? '费用小计 · 含估算' : '已核费用') : stale ? '历史费用' : estimated ? '参考费用' : '费用') + (partial && stale ? ' · 历史报价' : '');
    const hasPrice = rows.some(x => x.cny != null);
    return '<div class="flow-edge-loss"><span>' + label + '</span><strong class="num">' + (hasPrice ?
      (ratio || displaySum(rows, r)) : '—') + '</strong>' +
      (hasPrice && ratio ? '<small>' + displaySum(rows, r) + '</small>' : '') + '</div>';
  }
  function nodeBalance(r, value, currency, label, keys = [], blocked = false) {
    const rows = costRows(r, keys), unknown = rows.some(x => x.cny == null);
    const fxRows = rows.filter(x => x.cny == null && ['entryFx', 'brokerSpread', 'brokerExitFx', 'returnFx', 'exitFx', 'cashFx'].includes(x.key));
    const referenceFx = fxRows.length > 0 && fxRows.every(x => x.key === 'brokerSpread' && r?.indicativeFx || x.key === 'entryFx' && r?.indicativeEntryFx);
    const stale = keys.length > 0 && r?.quoteFreshness && (r.quoteFreshness.source === false || keys.includes('brokerSpread') && r.quoteFreshness.entryMarket === false || keys.includes('exitFx') && r.quoteFreshness.exit === false);
    const available = Number.isFinite(value) && !blocked && (!fxRows.length || referenceFx);
    const reference = referenceFx || stale;
    const title = reference && !label.includes('参考') ? label.replace('到账', '参考金额').replace('最终余额', '参考最终余额') : label;
    const notes = [];
    if (available && referenceFx) notes.push('参考汇率估算 · 缺换汇成交价');
    if (available && stale) notes.push('历史报价 ' + [r.entryAsOf, keys.includes('brokerSpread') ? r.fxAsOf : null, keys.includes('exitFx') ? r.exitAsOf : null].filter(Boolean).map(x => String(x).slice(0, 10)).filter((x, i, list) => list.indexOf(x) === i).join(' / '));
    return '<div class="flow-node-balance"><small>' + esc(available && unknown && !title.startsWith('已扣') && !title.includes('费用未齐') ? title + '（费用未齐）' : title) + '</small><div>' +
      (available ? amount(value, currency) : '<b>— <small>' + esc(currency) + '</small></b>') + '</div>' +
      notes.map(note => '<small>' + esc(note) + '</small>').join('') +
      (keys.length && available ? '<small>' + (unknown ? '累计已计费用 ' : '累计费用 ') + pct(sumRows(rows) / M.number(state.budgetCny)) + '</small>' : '') + '</div>';
  }
  function node(number, key, label, item, balanceHtml, extra = '', additions = '') {
    const content = '<span class="flow-node-number">' + number + '</span><div class="flow-node-identity">' + account(key, label, item) + '</div>' + balanceHtml + '<div class="flow-node-options">' + extra + '</div>';
    return '<section class="flow-node' + (number === '04' ? ' flow-end' : '') + '" data-flow-stage="' + number + '" aria-label="' + esc(number === '04' ? '卖出后的资金' : label) + '">' +
      (number === '04' ? '<div class="flow-end-row">' + content + '</div>' + (additions ? '<div class="flow-end-additions"><div>' + additions + '</div></div>' : '') : content) + '</section>';
  }
  function edge(data, keys, title, controls, stage, note = '') {
    const r = data.selected || data.partial, failedAction = data.partial?.errorAction || data.partial?.errorStage || data.errorStage || '01';
    const pending = data.error && (failedAction === stage || failedAction === '04' && stage === 'remit' && state.outcome === 'mainland' ||
      failedAction === '04' && stage === 'withdraw' && state.outcome === 'usd-balance') ? data.error : '';
    const feeNamesIssue = pending && costRows(r, keys).some(item => item.status === pending || item.items?.some(part => part.status === pending));
    const edgeLoss = pending && stage === 'withdraw' && !costRows(r, keys).length ? '<div class="flow-edge-loss"><strong>' + (state.withdrawDestination === 'mainland' && !state.directReceiptConfirmed ? '出金条件待确认' : '本次无法出金') + '</strong></div>' : loss(r, keys, pending);
    const inlineControls = controls && !/flow-field|flow-offer|flow-return-controls|flow-consumption-scope/.test(controls);
    return '<section class="flow-edge" aria-label="' + esc(title) + '"><span class="flow-edge-arrow" aria-hidden="true"><svg viewBox="0 0 20 28" width="20" height="28" focusable="false"><path d="M10 3v22M4 19l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' + edgeLoss + '<div class="flow-edge-main"><div class="flow-edge-title"><h3>' + esc(title) + '</h3>' +
      (inlineControls ? '<div class="flow-edge-inline">' + controls + '</div>' : '') +
      action('明细', 'detail', 'data-value="edge-' + stage + '" aria-label="' + esc(title + '收费明细与依据') + '"', 'text-link') + '</div>' +
      (controls && !inlineControls ? '<div class="flow-edge-controls">' + controls + '</div>' : '') + (note ? '<p class="flow-edge-note">' + note + '</p>' : '') +
      '<div class="flow-edge-fees">' + compactFees(r, keys, stage) + '</div>' +
      (pending && !feeNamesIssue ? '<p class="flow-error" role="status">' + esc(pending) + '</p>' : '') + '</div></section>';
  }
  function edgeFees(r, keys, stage) {
    if (!r?.rows?.length) return '';
    const rows = costRows(r, keys);
    if (stage === 'trade' && r.trading && !r.trading.overridden) return (autoFxAtPurchase(r) ? edgeFees(r, ['brokerSpread', 'brokerFx'], 'purchase-fx') : '') + tradeLine(r, 'buy') + tradeLine(r, 'sell') +
      feeRow(r, 'brokerAccount', null, '', r.trading.monthlyHkd ? 'HKD' : 'USD');
    return rows.flatMap(item => {
      if (state.route === 'USD' && ['brokerFx', 'brokerSpread'].includes(item.key)) return [];
      const parts = item.items?.length ? item.items : [item];
      return parts.map((part, i) => {
        let description = part.estimate || part.evidence || item.estimate || item.evidence || '';
        const exchange = item.exchanges?.[i];
        if (exchange) description = num(exchange.input) + ' ' + exchange.from + ' → ' + num(exchange.output) + ' ' + exchange.to +
          ' · 1 ' + exchange.from + ' = ' + quoteNum(exchange.rate) + ' ' + exchange.to;
        if (item.key === 'entryFx' && state.route !== 'CNH' && r.startSell > 0) description = '1 ' + state.route + ' = ' + quoteNum(r.startSell) + ' CNY' + (r.entryDiscount ? ' · 点差五折' : '');
        if (item.key === 'sender' && Number(state.count) > 1) description = (description ? description + ' · ' : '') + state.count + '笔合计';
        const feeCurrency = item.nativeCurrency || (item.key === 'depositBank' && r.depositMethod === 'chats' && r.bank?.localUsdNative != null ? 'USD' : 'HKD');
        let native = part.cny == null ? missingFeeStatus(r, item, part) :
          ['entryInward', 'depositBank', 'returnWire'].includes(item.key) || item.nativeCurrency ? num(part.cny / r.refs[feeCurrency]) + ' ' + feeCurrency : '';
        if (part.cny != null && (part.estimate ?? item.estimate)) native = '估算 ' + (native || displayCost(r, part));
        return feeLine(part.label, part.cny, description, native, displayCny(r, part));
      });
    }).join('');
  }
  function compactFees(r, keys, stage) {
    const rows = costRows(r, keys);
    const components = stage === 'trade' && r?.trading && !r.trading.overridden ? [
      { label: '买入费用', cny: r.trading.buyFeeUsd * r.refs.USD, display: displayCosts(r)?.tradeCny?.buy, estimate: r.trading.buyFeeUsd > 0 && row(r, 'trade')?.estimate },
      { label: '卖出费用', cny: r.trading.sellFeeUsd * r.refs.USD, display: displayCosts(r)?.tradeCny?.sell, estimate: r.trading.sellFeeUsd > 0 && row(r, 'trade')?.estimate },
      ...rows.filter(item => item.key !== 'trade')
    ] : rows.flatMap(item => item.items?.length ? item.items.map(part => ({ ...part, key: item.key, component: true, display: displayCny(r, part) })) : [item]);
    const labels = { entryFx: '购汇点差', entryMiddle: '代理费', entryInward: '香港汇入', depositBank: '银行转账', depositOther: '代理／收款费', depositBroker: '入金费',
      brokerExitFx: '换汇点差', brokerExitCommission: '换汇佣金', cashFx: '现金估值差额', atmFee: '提款／联动费', atmOther: 'ATM附加费', brokerSpread: '换汇点差', brokerFx: '换汇佣金', brokerAccount: '证券托管', withdraw: '出金费', returnInward: '银行收款', withdrawMiddle: '代理费',
      returnFx: '换汇点差', returnWire: '汇回手续费', returnOther: '代理／收款费', exitFx: state.outcome === 'cnh-card' ? '换汇点差' : '结汇点差', card: '消费费用', cardFx: '扣账折算差额' };
    return components.filter(item => !(state.route === 'USD' && ['brokerFx', 'brokerSpread'].includes(item.key)) &&
      !(state.route === 'CNH' && item.key === 'entryFx') && !(['cardFx', 'cashFx'].includes(item.key) && item.cny === 0)).map(item => {
        const label = r?.depositMethod === 'wise' && ['depositBank', 'depositOther'].includes(item.key) ? item.key === 'depositBank' ? '银行 → Wise' : 'Wise → IBKR' :
          item.key === 'returnOther' && item.component ? /中转/.test(item.label) ? '中转费' : '本行收款费' :
          item.component || item.key === 'sender' ? item.label : labels[item.key] || item.label;
        return '<span class="flow-fee-chip"><span>' + esc(label) + '</span><b>' +
          (item.cny == null ? '<span class="flow-variable">' + esc(missingFeeStatus(r, item)) + '</span>' : (item.estimate ? '参考 ' : '') +
            (r?.depositMethod === 'wise' && ['depositBank', 'depositOther'].includes(item.key) ? num(item.cny / r.refs.HKD) + ' HKD · ' : '') + cost(item.display ?? displayCny(r, item))) + '</b></span>';
      }).join('');
  }
  function flow(data) {
    const r = data.selected || data.partial, s = selected(), steps = r?.steps || {}, automaticPurchase = autoFxAtPurchase(r);
    const direct = state.withdrawDestination === 'mainland' && state.outcome !== 'broker-balance', mainlandEnd = ['mainland', 'mainland-usd'].includes(state.outcome);
    const cashProfile = M.mainlandCashProfile(state, D), withdrawCurrency = state.withdrawCurrency || 'USD';
    const cardMode = M.mainlandCardMode(state, D), spending = D.mainlandSpending?.[s.returning.id];
    const cardModeNames = { 'unionpay': '银联双币卡 · 人民币', 'apple-pay': '银联双币卡 · Apple Pay', cnh: s.returning.id === 'bochk' ? 'Mastercard · 人民币' : '人民币原币扣账', hkd: '港币扣账 · 银联', 'ccb-link': '陆港通 · 港币联动' };
    const actualFundingKeys = fundingRowKeys(r), actualTradingKeys = tradingRowKeys(r);
    const throughFunding = [...transferKeys, ...actualFundingKeys], throughTrade = [...throughFunding, ...actualTradingKeys];
    const countControl = select('count', '汇出笔数', [['1', '1笔'], ['2', '2笔'], ['3', '3笔'], ['4', '4笔'], ...(!['1', '2', '3', '4'].includes(String(state.count)) ? [[String(state.count), state.count + '笔']] : []), ['custom', '自定义笔数']], String(state.count))
      .replace('class="flow-field"', 'class="flow-field flow-inline-setting"').replace('<span>汇出笔数</span>', '<span>笔数</span>');
    const channelControl = select('mainlandMethod', '汇款渠道', entryMethods())
      .replace('class="flow-field"', 'class="flow-field flow-inline-setting"').replace('<span>汇款渠道</span>', '<span>渠道</span>');
    const sourceControls = '<div class="flow-source-settings">' + select('route', '汇出币种', Object.entries(currencyNames)) +
      '<div class="flow-source-secondary">' + countControl + channelControl + '</div>' +
      (state.mainlandMethod === 'payment-connect' ? checkbox('paymentConnectFeeWaived', '已享跨境支付通手续费豁免') : '') + '</div>' +
      (r?.sourceRemainderCny > 1e-6 ? '<small>留在本账户 ' + cost(r.sourceRemainderCny) + '</small>' : '');
    const principal = nodeBalance(r, M.number(state.budgetCny), 'CNY', '人民币本金').replace('<small>人民币本金</small>', '<div class="flow-balance-label"><small>人民币本金</small>' + action('修改', 'detail', 'data-value="budget" aria-label="修改人民币本金" aria-haspopup="dialog"', 'text-link') + '</div>');
    let html = node('01', 'startBank', '内地出发银行', s.start, principal, sourceControls + mainlandAccountControl(s.start, r));
    html += edge(data, transferKeys, '汇往香港',
      '', '01',
      r?.serviceAvailability?.verified === false ? '此汇路暂无SWIFT Go开通记录，以下按服务资费测算。' : state.mainlandMethod === 'linked' ? '两地同名已关联账户' :
        state.mainlandMethod === 'payment-connect' ? paymentConnectHint(r) : s.start?.id === 'cib' && state.route === 'CNH' ? '人民币原币电汇：寰宇人生外汇双免不适用，手续费与电讯费分别计收。' : '' );
    const accounts = [...new Map([s.bank, banks.find(bank => bank.id === s.broker.integratedBank), M.calculatorFundingBank(state, D)].filter(Boolean).map(bank => [bank.id, bank])).values()];
    const managementBanks = accounts.filter(bank => bank.id === s.bank.id || bank.monthlyHkd > 0);
    let accountOptions = '<div class="flow-bank-settings">' + field('months', '账户使用月数', '月') + '<div class="flow-bank-fees">' + managementBanks.map(bank => bankManagementControl(bank, r)).join('') + '</div></div>';
    if (s.bank.id === 'za' && s.broker.id !== 'za') accountOptions += zaRights('ZA银行权益');
    if (s.bank.id === 'icbc-asia' && s.start.group === 'icbc' || state.outcome === 'mainland' && s.returning.id === 'icbc-asia' && s.exit.group === 'icbc' && state.returnMethod === 'icbc-express')
      accountOptions += checkbox('icbcEAccount', 'e账通 · 本人非联名账户已绑定同名内地工行');
    if (s.bank.cnhAccountRequiresHkid && state.route === 'CNH') accountOptions += checkbox(s.bank.cnhAccountField, '持香港身份证，已开通' + shortName(s.bank) + '人民币账户');
    if (data.error && r?.errorStage === '02') accountOptions += '<p class="flow-error" role="status">' + esc(data.error) + '</p>';
    html += node('02', 'bank', '香港收款银行', s.bank, nodeBalance(r, steps.hongKong, state.route, '汇款到账', transferKeys), accountOptions);
    const fxControl = state.route === 'USD' ? '' : select('fxMode', '换美元地点', [...(M.supportsBrokerFx(s.broker.id) ? [['manual', 'IBKR手动换汇'], ['auto', 'IBKR现金账户自动换汇']] : []), ['bank', shortName(s.bank) + '换汇']]);
    const fundingPath = row(r, 'brokerSpread')?.path;
    const fundingBank = r?.fundingBank || M.calculatorFundingBank(state, D);
    const viaWise = state.depositMethod === 'wise';
    const fundingTitle = (state.route === 'USD' ? '' : state.fxMode === 'bank' ? (fundingPath ? '人民币 → 港币 → 美元' : '换成美元') + ' → ' : '') +
      (viaWise ? '美元 → 本人Wise → IBKR' : fundingBank ? '经本人' + routeName(fundingBank.id, 'bank') + ' → 同行入金' : automaticPurchase ? state.route + '原币转入IBKR' : state.route === 'USD' || state.fxMode === 'bank' ? '转入买股账户' : '转入IBKR → 换成美元');
    const pricedFunding = !costRows(r, throughFunding).some(item => item.cny == null) && r?.quoteFreshness?.source !== false && r?.quoteFreshness?.entryMarket !== false;
    const exchangeNote = state.route !== 'USD' && !r?.indicativeFx && r?.entryPrice ? '1 USD = ' + quoteNum(r.entryPrice) + ' ' + state.route + (r.brokerFx?.priceIncludesAutoMarkup ? ' · 已含自动加价' : '') + (fundingPath ? ' · 两次兑换' : '') : '';
    const fundingNote = [automaticPurchase ? '' : exchangeNote,
      viaWise ? '须在IBKR关联本人Wise；到账按下列两段费用测算。' : '',
      viaWise && Number.isFinite(steps.wiseUsd) ? 'Wise参考到账 ' + num(steps.wiseUsd) + ' USD' : '',
      fundingBank && pricedFunding && steps.fundingBankUsd != null ? '本人' + routeName(fundingBank.id, 'bank') + '到账 ' + num(steps.fundingBankUsd) + ' USD' : ''].filter(Boolean).join(' · ');
    html += edge(data, actualFundingKeys, fundingTitle, fxControl + select('depositMethod', '入金方式', depositMethods()), '03', esc(fundingNote));
    const pricingControl =
      (s.broker.id === 'za' ? zaRights('ZA交易权益') : '') +
      (['ibkr', 'ibkr-lite'].includes(s.broker.id) ? '<div class="flow-setting-cell"><span>账户方案</span><strong>' + (s.broker.id === 'ibkr' ? 'Pro · 固定佣金' : 'Lite · 合资格美国居民') + '</strong></div>' : '') +
      (s.broker.id === 'hsbc' ? '<div class="flow-field flow-pricing-condition"><span>证券收费方案</span>' + checkbox('trade25', 'Trade25 · 仅美股月费0') + '</div>' : '');
    const tradeSettings = '<div class="flow-trading-settings">' +
      '<div class="flow-setting-cell"><span>买卖设置</span>' + action('买' + esc(state.buyOrders) + '笔 · 卖' + esc(state.sellOrders) + '笔', 'detail', 'data-value="trade-settings"', 'flow-setting-button') + (!pricingControl ? '<small>均价 ' + esc(state.sharePriceUsd) + ' USD/股' + (s.broker.id === 'schwab' ? ' · 整股' : '') + '</small>' : '') + '</div>' +
      '<div class="flow-setting-cell"><span>优惠与费用券</span>' + action(state.useVoucher ? r?.trading?.discountUsd > 0 ? '已抵扣 ' + quoteNum(M.displayedTradingFees(r.trading).discountUsd) + ' USD' : '费用券 · 未抵扣' : '设置优惠', 'detail', 'data-value="offers"', 'flow-setting-button') + '</div>' +
      (pricingControl ? '<div class="flow-setting-cell"><span>买入均价</span>' + action(esc(state.sharePriceUsd) + ' USD/股', 'detail', 'data-value="trade-settings"', 'flow-setting-button') + '</div>' + pricingControl : '') + '</div>';
    html += node('03', 'broker', '买美股的账户', s.broker, nodeBalance(r, automaticPurchase ? steps.brokerOriginal : steps.fundedUsd, automaticPurchase ? state.route : 'USD', '入金到账', throughFunding), tradeSettings);
    html += edge(data, actualTradingKeys, automaticPurchase ? '买入时自动换美元 → 买入美股 → 卖出' : '买入美股 → 卖出', action('盈亏 ' + num(M.number(state.profitUsd)) + ' USD', 'detail', 'data-value="profit-settings"', 'flow-setting-button'), 'trade', esc([automaticPurchase ? exchangeNote : '', row(r, 'trade')?.estimate || ''].filter(Boolean).join(' · ')));
    const endSelect = select('outcome', '资金用途', direct ? outcomes.filter(([id]) => ['mainland', 'mainland-usd', 'broker-balance'].includes(id)) : outcomes);
    const final = balancePresentation(data), allKeys = (r?.rows || []).map(item => item.key);
    const finalBalance = final.canBalance ? nodeBalance(r, r.net, r.currency, finalBalanceLabel(final), allKeys) :
      final.lastPoint ? nodeBalance(r, final.lastPoint.amount, final.lastPoint.currency, lastBalanceLabel(final.lastPoint)) : nodeBalance(r, null, r?.currency || 'USD', '最终余额暂不可算');
    const periodRows = costRows(r, ['extra']).filter(item => item.cny == null || item.cny !== 0)
      .map(item => item.items?.length ? { ...item, items: item.items.filter(part => part.cny == null || part.cny !== 0) } : item);
    const closingCosts = (periodRows.length ? '<div class="flow-closing-costs"><small>期间及固定费用</small>' + detailRows(r, periodRows) + '</div>' : '') +
      (r?.taxCny > 0 ? '<div class="flow-closing-tax">预留税款 <b>' + cost(r.taxCny) + '</b></div>' : '');
    const wireBroker = s.broker.withdrawalMethod === 'wire' && !s.broker.integratedBank;
    const withdrawalSettings =
      (wireBroker ? select('withdrawDestination', '出金目的地', [['hong-kong', '香港银行'], ['mainland', '直接到内地USD账户']]) : '') +
      (s.broker.id === 'ibkr' && !direct ? select('withdrawCurrency', '券商出金币种', [['USD', '美元'], ['CNH', '人民币 · IBKR先换汇']]) : '') +
      (withdrawCurrency === 'CNH' ? select('cnhWithdrawalMethod', 'CNH出金渠道', [['local', '香港本地转账'], ['wire', '电汇']]) :
        s.broker.withdrawalChannels ? select('brokerWireChannel', '出金渠道', Object.entries(s.broker.withdrawalChannels).map(([id, channel]) => [id, channel.label])) : '') +
      (s.broker.freeWithdrawals ? action('本月第' + esc(state.withdrawalIndex) + '次出金', 'detail', 'data-value="profit-settings"', 'flow-setting-button') :
        isChequeReturn(s) && s.returning?.localUsdChequeTariff ? action(s.returning.localUsdChequeTariff.nonCounterHkd != null ? state.hsbcChequeNonCounter ? '本次非柜台存票' : '本次柜台存票' : '存票当日第' + esc(state.chequeIndex) + '张', 'detail', 'data-value="profit-settings"', 'flow-setting-button') : '') +
      (direct ? checkbox('directReceiptConfirmed', '已确认券商可向本人内地USD账户出金，且银行可接收本笔资金') : '');
    if (state.outcome !== 'broker-balance') html += edge(data, withdrawKeys,
      (withdrawCurrency === 'CNH' ? 'IBKR换人民币 → CNH出金 → ' : shortName(s.broker) + '出金 → ') + shortName(direct ? s.exit : s.returning),
      withdrawalSettings, 'withdraw', withdrawCurrency === 'CNH' ? '手动换汇每单最低2 USD；实际汇率见明细。香港本地CNH出金须以券商可选渠道为准。' : direct ? 'USD到账与人民币结汇是两个动作；资金来源及收款资格分别审核。' : '');
    const endpoint = state.outcome === 'broker-balance' ? s.broker : direct ? s.exit : s.returning;
    const endpointKey = state.outcome === 'broker-balance' ? 'broker' : direct ? 'exitBank' : 'returnBank';
    const endpointLabel = state.outcome === 'broker-balance' ? '资金所在账户' : direct ? '内地美元收款银行' : '取回银行';
    const returnedBalance = state.outcome === 'broker-balance' ? finalBalance : nodeBalance(r,
      withdrawCurrency === 'CNH' ? steps.returnCnh : steps.returnUsd, withdrawCurrency, '出金到账', [...throughTrade, ...withdrawKeys]);
    const returnAccountFee = row(r, 'account')?.items?.find(item => item.region !== 'mainland' && item.bankId === s.returning.id);
    const endOptions = '<div class="flow-end-choice">' + endSelect +
      (state.outcome === 'mainland' && !direct ? select('returnCurrency', '回款币种', [['USD', '美元原币'], ['HKD', '港币 · 香港换汇']]) :
        state.outcome === 'cnh-card' && spending ? select('cardMode', '内地支付方式', spending.modes.map(mode => [mode, cardModeNames[mode]]), cardMode) :
        state.outcome === 'atm' && cashProfile ? select('atmMode', '银行卡与ATM', D.mainlandCash[s.returning.id].map(profile => [profile.id, profile.title]), cashProfile.id) : '') + '</div>';
    const endAdditions =
      (!direct && state.outcome !== 'broker-balance' && (s.returning.monthlyHkd > 0 || returnAccountFee && returnAccountFee.cny !== 0) && !accounts.some(bank => bank.id === s.returning.id) ? bankManagementControl(s.returning, r, s.returning.id) : '') +
      (!direct && state.outcome !== 'broker-balance' && s.returning.id === 'za' && s.bank.id !== 'za' && s.broker.id !== 'za' ? zaRights('ZA银行权益') : '') +
      (state.outcome === 'broker-balance' ? closingCosts : '');
    html += node('04', endpointKey, endpointLabel, endpoint, returnedBalance, endOptions, endAdditions);
    if (mainlandEnd) {
      const returnCurrency = state.outcome === 'mainland-usd' || direct ? 'USD' : state.returnCurrency || 'USD';
      if (!direct) {
        if (returnCurrency === 'HKD') html += edge(data, ['returnFx'], '美元换港币',
          !data.error && !r?.indicativeReturnFx && r?.quoteFreshness?.returnMarket !== false && r?.returnHkdPrice > 0 ?
            '<span class="flow-exchange-quote">1 USD = ' + quoteNum(r.returnHkdPrice) + ' HKD</span>' : '', 'return-fx');
        html += edge(data, returnTransferKeys, '汇回内地' + (state.outcome === 'mainland-usd' ? ' · 美元原币' : ''), select('returnMethod', '汇回渠道', returnMethods(), r?.returnMethod || state.returnMethod), 'remit');
        html += node('05', 'exitBank', '内地收款银行', s.exit,
          nodeBalance(r, steps.mainlandReceived, returnCurrency, '汇入账户余额', [...throughTrade, ...withdrawKeys, 'returnFx', ...returnTransferKeys], !!r?.indicativeReturnFx),
          '<div class="flow-consumption-scope"><strong>' + (state.outcome === 'mainland-usd' ? '美元现汇保留在内地账户' : '结汇后用于内地日常支付') + '</strong><span>' +
          esc(state.outcome === 'mainland-usd' ? '人民币消费需另行结汇；到账、结汇分别受银行审核。' : D.mainlandSpending.bank.coverage) + '</span></div>' +
          (s.exit?.id === s.start?.id ? '' : mainlandAccountControl(s.exit, r)));
      }
      if (state.outcome === 'mainland') html += edge(data, ['exitFx'], '内地结汇',
        !data.error && !r?.indicativeExit && !r?.indicativeReturnFx && r?.quoteFreshness?.exit !== false && r?.exitPrice > 0 ?
          '<span class="flow-exchange-quote">1 ' + returnCurrency + ' = ' + quoteNum(r.exitPrice) + ' CNY</span>' : '', 'settle');
    }
    if (state.outcome === 'atm') {
      const settings = '<div class="flow-end-choice">' + field('atmAmountCny', '本次计划取现', 'CNY') + field('atmTransactions', '提款笔数', '笔') + '</div>' +
        (s.returning.id === 'ccb-asia' ? checkbox('ccbLinkedCard', '已持陆港通龙卡并开通两地联动 · 年费50 HKD') : '') +
        (cashProfile?.currency === 'CNH' && s.returning.cnhCardRequiresHkid ? checkbox(s.returning.cnhAccountField, '持香港身份证，已开通人民币账户') : '');
      html += edge(data, exitKeys, '银行余额 → 内地ATM人民币现金', settings, '04', esc(cashProfile?.limitNote || '尚缺该银行卡的内地ATM收费及限额依据。'));
      if (cashProfile) html += '<section class="flow-linked-account" aria-label="ATM取现条件"><strong>' + esc(cashProfile.currency + '账户扣账') + '</strong><span>' + esc(cashProfile.currency === 'HKD' ? '按实际ATM扣账汇率折算；免提款费不等于免汇差。' : '人民币账户余额须充足，确认ATM从人民币账户原币扣账。') + '</span></section>';
    }
    if (state.outcome === 'cnh-card') {
      const title = cardMode === 'ccb-link' ? '美元换港币 → 陆港通联动消费' : cardMode === 'hkd' ? '美元换港币 → 银联商户消费' : (withdrawCurrency === 'CNH' ? '人民币余额 → ' : '美元换人民币 → ') + (cardMode === 'apple-pay' ? '银联卡Apple Pay消费' : '商户刷卡');
      const conditions = cardMode === 'ccb-link' ? checkbox('ccbLinkedCard', '已持陆港通龙卡并开通两地联动 · 年费50 HKD') :
        M.cnhCardMode(cardMode) && s.returning.cnhCardRequiresHkid ? checkbox(s.returning.cnhAccountField || 'scCnhAccount', '持香港身份证，已开通' + shortName(s.returning) + '人民币账户') : '';
      const scope = spending ? '<div class="flow-consumption-scope"><strong>' + esc(spending.coverage) + '</strong><span>' + esc(spending.limitation) + '</span></div>' : '';
      html += edge(data, exitKeys, title, conditions + scope, '04',
        data.error || r?.indicativeExit || r?.indicativeReturnFx || withdrawCurrency === 'CNH' ? '' : esc(M.cnhCardMode(cardMode) ? (r.estimatedExitFx ? '参考 ' : '') + '1 USD = ' + quoteNum(r.exitPrice) + ' CNH' + (r.estimatedExitFx ? ' · 本行牌价折算' : '') :
          '1 USD = ' + quoteNum(r.returnHkdPrice) + ' HKD · 消费扣账1 HKD = ' + quoteNum(r.exitPrice) + ' CNY'));
      if (cardMode === 'ccb-link') html += '<section class="flow-linked-account" aria-label="陆港通两地账户"><strong>关联内地账户：中国建设银行 · 陆港通龙卡</strong><span>先扣内地人民币；不足时整笔联动香港账户。消费每日累计限等值50,000 HKD；以下为可分日使用的总额，资金未预先汇入内地账户。</span></section>';
    }
    if (state.outcome === 'usd-card') html += edge(data, exitKeys, '美元余额 → 境外原币消费', '', '04', '限接受相应卡组织的美元交易商户，不作为内地人民币支付路径');
    if (state.outcome === 'usd-balance') html += closingCosts;
    else if (state.outcome !== 'broker-balance') {
      const terminalAccount = final.canBalance ? mainlandEnd ? shortName(s.exit) : shortName(s.returning) : final.lastPoint?.account || '最终账户余额暂不可算';
      const terminalBalance = !final.canBalance && final.lastPoint ? nodeBalance(r, final.lastPoint.amount, final.lastPoint.currency, '最后可计余额') : finalBalance;
      html += '<section class="flow-terminal" aria-label="资金终点"><div><small>' + (final.canBalance ? state.outcome === 'atm' ? '计划取现后的银行余额' : state.outcome === 'mainland-usd' ? '内地账户 · 美元现汇' : state.outcome === 'mainland' ? '内地银行卡 · 人民币可用余额' : state.outcome === 'cnh-card' ? '香港卡 · 限受理商户' : '资金终点' : '最后可计账户') + '</small><strong>' +
        esc(terminalAccount) + '</strong></div>' + terminalBalance + (state.outcome === 'atm' && final.canBalance && r?.cashPlan ? '<div class="flow-cash-result"><span>另有本次计划现金</span>' + amount(r.cashPlan.cash, 'CNY') + '</div>' : '') + closingCosts + '</section>';
    }
    const moneyWidth = Math.max(170, Math.ceil(Math.max(...[M.number(state.budgetCny), steps.hongKong, steps.fundedUsd, steps.brokerOriginal, steps.returnUsd, r?.net]
      .filter(Number.isFinite).map(value => num(value).length)) * 13.5 + 30));
    return '<div class="flow-ledger" style="--flow-money-width:' + moneyWidth + 'px" aria-label="完整资金流">' + html + '</div>';
  }
  function currentRows(r, stage = state.activeStep) { return (r?.rows || []).filter(x => stageKeys[Number(stage) - 1].includes(x.key)); }
  function feeLine(label, cny, description = '', native = '', convertedCny = cny) {
    const converted = cost(convertedCny === 0 && cny !== 0 ? cny : convertedCny);
    return '<div class="flow-fee-line"><div><strong>' + esc(label) + '</strong>' + (description ? '<small>' + esc(description) + '</small>' : '') +
      '</div><div>' + (cny == null ? '<span class="flow-variable">' + esc(native || '随实际汇路收费') + '</span>' : '<b class="num">' + esc(native || converted) + '</b>' + (native && !native.endsWith(' CNY') && cny !== 0 ? '<small>≈ ' + converted + '</small>' : '')) + '</div></div>';
  }
  function feeRow(r, key, label, description = '', currency = 'CNY') {
    const item = row(r, key); if (!item) return '';
    return feeLine(label || item.label, item.cny, description, item.cny == null ? item.rangeCny ? item.rangeCny.map(n => num(n)).join('–') + ' CNY' : item.status || '' :
      currency === 'CNY' ? '' : num(item.cny / r.refs[currency]) + ' ' + currency, displayCny(r, item));
  }
  function transferHint() {
    if (state.mainlandMethod === 'cib-go') return '附加服务：每笔≤等值10,000 USD，仅限App提供此服务的收款账户；包含境外行费用。';
    if (state.mainlandMethod === 'full') return selected().start?.fullAmountIncludesInward ?
      '美元全额到账附加服务按笔收费，已包含境外中转与收款入账扣费；本行汇出手续费、电讯费另计。' :
      '美元全额到账附加服务按笔收费，汇出手续费、电讯费及收款行本行汇入费分别列示。';
    if (state.mainlandMethod === 'boc-mobile') return '手机银行“境外中行”入口双免；中银香港使用BKCHHKHH，香港分行BKCHHKHK不享此优惠。代理费单独按汇路证据计算。';
    if (state.mainlandMethod === 'icbc-mobile') return '工行手机银行向境外工行本行费免；工银亚洲汇入费按e账通资格计算，代理费单列。';
    if (state.mainlandMethod === 'boc-online') return '向境外他行手机／网银基础费9折；收款行及代理行费用另列。';
    if (state.mainlandMethod === 'linked') return state.startBank === 'sc' ? '适用于渣打优先理财、两地同名账户及指定渠道。' : state.startBank === 'hang' ? '适用于恒生中国优越理财，经跨域转账页面汇往同名恒生香港账户；优进理财的累计3次本行费用优惠不适用此项。' : '适用于已连通的两地同名账户及指定转账页面。';
    return '';
  }
  function paymentConnectHint(r) {
    const each = Math.max(0, (r?.budgetCny ?? M.number(state.budgetCny)) - (row(r, 'sender')?.cny ?? 0)) / (M.number(state.count) || 1);
    return '南向年度共用50,000 USD；本次约' + num(each) + ' CNY/笔。' +
      (each > D.paymentConnect.southbound.reportedTransactionCny ? '超过公开操作参考的单笔1万元，未确认可汇。' : '银行单笔／累计剩余额度未取得。');
  }
  function paymentConnectDetails() {
    const p = D.paymentConnect;
    return '<h3>支付通限额 · ' + esc(p.checkedAt) + '复核</h3><dl class="flow-consumption-detail">' +
      '<dt>南向 · 内地→香港</dt><dd>共用每年等值50,000 USD购汇便利化额度，人民币汇出也占额度；服务时间通常07:00–23:00。</dd>' +
      '<dt>单笔与累计限额</dt><dd>公开操作报道为单笔10,000 CNY，属于历史参考，不是四家银行现行统一承诺。各行支付通上限、非柜面／认证限额及本人剩余额度共同约束；不能将10万元费用情景视为单笔可汇，也不自动拆笔。</dd>' +
      '<dt>当前出发银行</dt><dd>' + esc(p.southbound.bankLimits[state.startBank]?.status || '未取得该行支付通限额公告') + '；还缺本人年度剩余购汇额度及当日、当月可用金额／笔数。</dd>' +
      '<dt>北向 · 香港→内地</dt><dd>香港身份证持有人，每人每家参与机构每日等值10,000 HKD、每年200,000 HKD；与每日80,000 CNY同名汇款限额独立。此上限不能套到南向。</dd>' +
      '<dt>用途</dt><dd>人民银行规定为经常项目汇款，证券投资不因此获准。当前优选保留费用情景，不作渠道资格确认。</dd></dl>';
  }
  function bankAccountSet(s) {
    return [...new Map([s.bank, banks.find(b => b.id === s.broker.integratedBank), M.calculatorFundingBank(state, D), ...(state.outcome === 'broker-balance' || state.withdrawDestination === 'mainland' ? [] : [s.returning])].filter(Boolean).map(b => [b.id, b])).values()];
  }
  function accountFeeBasis(item) {
    if (item.status) return item.status;
    if (item.evidence && item.monthlyHkd == null && item.monthlyCny == null) return item.evidence;
    if (item.region !== 'mainland') return num(item.monthlyHkd) + ' HKD/月 × ' + num(item.monthlyHkd === 0 ? item.months : item.chargedMonths ?? item.months, 0) + '个月' +
      (item.monthlyHkd > 0 && item.waivedMonths > 0 ? '；另' + num(item.waivedMonths, 0) + '个月免收' : '');
    if (item.waived) return '本持有期' + num(item.months, 0) + '个月均已满足免月费条件';
    return num(item.monthlyCny, 0) + ' CNY/月 × ' + num(item.chargedMonths, 0) + '个月' + (item.waivedMonths > 0 ? '；另' + num(item.waivedMonths, 0) + '个月免收' : '');
  }
  function bankManagementControl(bank, r, accountId = state.bank) {
    const item = row(r, 'account')?.items?.find(item => item.region !== 'mainland' && item.bankId === bank.id);
    const fee = item ? displayCost(r, item) : num(bank.monthlyHkd) + ' HKD/月';
    const name = shortName(bank);
    const ownBank = bank.id === accountId;
    return '<div class="flow-bank-fee"><div class="flow-bank-fee-top"><strong' + (ownBank ? ' class="flow-bank-fee-label"' : '') + '>' + esc(ownBank ? '银行管理费' : name + ' · 管理费') + '</strong><b class="num">' + fee + '</b></div>' +
      (bank.id === 'hsbc' ? '<div class="flow-bank-waiver-row">' + checkbox('hsbcBalanceWaiver', '满足豁免', 'HSBC One本持有期均免管理费') +
        action('3个月均值≥1万HKD／开户豁免', 'detail', 'data-value="bank-settings" aria-haspopup="dialog" aria-label="HSBC One豁免条件：三个月平均理财总值至少10,000 HKD或适用开户豁免"', 'text-link') + '</div>' :
        item?.cny > 0 ? '<div class="flow-bank-condition">已计本人实际期间费用</div>' :
          item?.cny == null && bank.monthlyHkd > 0 ? '<div class="flow-bank-condition">期间费用尚缺折算报价</div>' : '') + '</div>';
  }
  function mainlandAccountControl(bank, r) {
    const service = bank?.accountService; if (!service) return '';
    const item = row(r, 'account')?.items?.find(item => item.region === 'mainland' && item.bankId === bank.id);
    return '<div class="flow-bank-service flow-bank-fee"><span>' + esc(service.name) + '期间管理费</span><div class="flow-bank-fee-condition">' +
      checkbox(service.waiverField, '免管理费条件已满足', service.name + '本持有期均免月费') + '<b class="num">' + (item ? displayCost(r, item) : service.monthlyCny + ' CNY/月') + '</b></div>' +
      action('收费条件', 'detail', 'data-value="cn-bank-' + bank.id + '" aria-label="' + esc(service.name + '账户费用与豁免') + '" aria-haspopup="dialog"', 'text-link') + '</div>';
  }
  function offers(s, r) {
    const id = s.broker.id;
    let html = id === 'hsbc' ? checkbox('trade25', '已开通Trade25 · 仅美股月费0') : id === 'za' ? zaRights('ZA交易权益') :
      id === 'chief' ? checkbox('chiefMonthly', 'App月供买入 · 首500 USD免佣／平台费') : id === 'usmart' ? checkbox('usmartPromo', '符合开户180天及指定标的优惠') : '';
    html += checkbox('useVoucher', '使用已获得的费用券');
    if (state.useVoucher) html += '<div class="flow-voucher-fields">' + select('voucherScope', '抵扣范围', [['commission', '佣金'], ['platform', '平台费'], ['both', '两者均可']]) +
      field('voucherUsd', '费用券额度', 'USD') + field('voucherOrders', '适用订单数', '笔') + field('voucherExpiry', '到期日') +
      '<p>' + esc(M.voucherState({ ...state, date: today() }).message || '本次抵扣 ' + quoteNum(M.displayedTradingFees(r?.trading).discountUsd) + ' USD') + '</p>' +
      '<div class="flow-voucher-order-status">' + (r?.trading?.orders || []).map((order, index) => '<span>' + (order.kind === 'buy' ? '买入' : '卖出') + ' ' + order.date + '</span><b>' +
        (order.discount > 0 ? '抵扣 ' + quoteNum(M.displayedTradingFees(r.trading).orders[index]?.discount || 0) + ' USD' : r.trading.voucher.pending ? '券信息待补齐' : order.date > state.voucherExpiry ? '券已过期' : '本单没有可抵费用／可用额度') + '</b>').join('') + '</div></div>';
    if (id === 'hsbc' && state.trade25) html += field('otherTurnoverHkd', '每个交易月已用成交额', 'HKD');
    if (id === 'za' && M.zaPerksLevel(state) === 'lv2') html += field('usedPromoOrders', '每月已用优惠笔数', '笔');
    if (id === 'usmart' && state.usmartPromo) html += field('usmartDays', '开户距今天数', '天');
    return '<div class="flow-inline-offers">' + html + '</div>';
  }
  function tradeLine(r, kind) {
    if (!r?.trading || r.trading.overridden) return '';
    const orders = r.trading.orders.filter(o => o.kind === kind), sum = key => orders.reduce((n, o) => n + (o[key] || 0), 0);
    const displayed = M.displayedTradingFees(r.trading).orders.filter(order => order.kind === kind);
    const shown = key => displayed.reduce((total, order) => total + (order[key] || 0), 0);
    const rebate = sum('rebateUsd');
    const pricing = [...new Set(orders.map(o => o.pricing).filter(Boolean))].join('；');
    const unitDigits = r.trading.wholeSharesOnly ? 0 : Math.round(-Math.log10(r.trading.shareStep || .0001)), cashDigits = Math.max(2, unitDigits);
    const quantity = r.trading.shareStep ? num(sum('shares'), unitDigits) + '股 · ' +
      (kind === 'buy' && r.trading.cashRemainderUsd >= Math.pow(10, -cashDigits) / 2 ? '未买入余款 ' + num(r.trading.cashRemainderUsd, cashDigits) + ' USD · ' : '') : '';
    return feeLine((kind === 'buy' ? '买入' : '卖出') + '美股 · ' + orders.length + '笔', sum('feeUsd') * r.refs.USD,
      quantity + (orders.some(order => order.contributionUsd != null) ? '扣费前供款 ' + num(sum('contributionUsd'), 0) + ' USD · ' : '') +
      '佣金 ' + num(shown('netCommission')) + '＋平台 ' + num(shown('netPlatform')) + '＋清算／监管 ' + num(shown('thirdParty')) +
      ' USD' + (shown('discount') ? ' · 券已抵扣 ' + quoteNum(shown('discount')) + ' USD' : '') +
      (state.useVoucher && !r.trading.voucher.pending && orders.some(order => order.date > state.voucherExpiry) ? ' · ' + orders[0].date + '券已过期' : '') + (pricing ? ' · ' + pricing : '') +
      (rebate > 0 ? ' · 先扣 ' + num(sum('debitFeeUsd')) + ' USD，5个工作日内返还 ' + num(rebate) + ' USD' : ''),
      (row(r, 'trade')?.estimate ? '估算 ' : '') + (rebate > 0 ? '返还后 ' : '') + num(shown('feeUsd')) + ' USD', displayCosts(r)?.tradeCny?.[kind]);
  }
  function balancePresentation(data) {
    const r = data.selected || data.partial, rows = r?.rows || [], total = sumRows(rows), gaps = rows.filter(x => x.cny == null);
    const incomplete = !data.selected || !!r?.indicativeBrokerExit || !!r?.indicativeFx || !!r?.indicativeExit || !!r?.indicativeReturnFx || !!r?.exitIssue;
    const stale = !r?.missingQuote && r?.quoteFreshness && (r.quoteFreshness.source === false || r.quoteFreshness.reference === false ||
      !r.indicativeFx && r.quoteFreshness.entryMarket === false || !r.indicativeExit && !r.indicativeReturnFx && r.quoteFreshness.exit === false);
    const partial = incomplete || !!gaps.length;
    const estimated = rows.some(x => x.estimate);
    const ratio = countedRatio(total, partial);
    const label = (partial ? (ratio ? estimated ? '已计费用占本金 · 含估算' : '已核费用占本金' : estimated ? '费用小计 · 含估算' : '全程已核费用') : stale ? '全程费用 · 历史报价' : estimated ? '参考总费用' : '全程费用') + (partial && stale ? ' · 历史报价' : '') +
      (r?.trading?.rebateUsd > 0 ? ' · 返还后' : '');
    const canBalance = !!data.selected && !r?.indicativeBrokerExit && !r?.indicativeExit && !r?.indicativeReturnFx && !r?.exitIssue && gaps.every(x => ['entryMiddle', 'depositOther', 'withdrawMiddle', 'returnOther', 'atmOther'].includes(x.key) || x.key === 'brokerSpread' && r.indicativeFx || x.key === 'entryFx' && r.indicativeEntryFx);
    const actualReturnHkd = !r?.indicativeReturnFx && row(r, 'returnFx')?.cny != null && r?.quoteFreshness?.returnMarket !== false ? r?.steps?.remitHkd ?? r?.steps?.returnHkd : undefined;
    const actualCnh = !r?.indicativeBrokerExit ? r?.steps?.returnCnh : undefined;
    const actualAtmBank = !r?.indicativeBrokerExit && !r?.indicativeReturnFx && row(r, 'exitFx')?.cny !== null ? r?.steps?.atmBank : undefined;
    const lastBalance = actualAtmBank ?? actualReturnHkd ?? actualCnh ?? r?.steps?.remitUsd ?? r?.steps?.returnUsd ?? r?.steps?.afterTaxUsd ?? r?.steps?.proceedsUsd ?? r?.steps?.fundedUsd;
    const canShowLast = Number.isFinite(lastBalance) && !r?.indicativeFx && r?.quoteFreshness?.source !== false && r?.quoteFreshness?.entryMarket !== false;
    const lastPoint = canShowLast ? { amount: lastBalance, currency: actualAtmBank != null ? r.cashProfile.currency : actualReturnHkd != null ? 'HKD' : actualCnh != null ? 'CNH' : 'USD', rebate: r?.trading?.rebateUsd > 0 && Number.isFinite(r.steps.proceedsUsd), account: shortName(
      Number.isFinite(r.steps.mainlandReceived) || Number.isFinite(r.steps.remitUsd) || actualReturnHkd != null && Number.isFinite(r.steps.remitHkd) ? r.exit : actualAtmBank != null || actualCnh != null || Number.isFinite(r.steps.returnUsd) ? r.returning : r.broker) } :
      r?.indicativeFx && state.fxMode !== 'bank' && Number.isFinite(r?.steps?.brokerOriginal) && r?.quoteFreshness?.source !== false ?
        { amount: r.steps.brokerOriginal, currency: state.route, account: shortName(r.broker) } :
      Number.isFinite(r?.steps?.hongKong) && r?.quoteFreshness?.source !== false ? { amount: r.steps.hongKong, currency: state.route, account: shortName(r.bank) } : null;
    return { r, rows, total, gaps, partial, estimated, label, canBalance, lastPoint };
  }
  const lastBalanceLabel = point => '最后可计余额' + (point.rebate ? '（优惠返还后）' : '') + ' · ' + point.account;
  function finalBalanceLabel({ gaps, estimated, canBalance, r }) {
    if (canBalance && (r?.indicativeFx || r?.indicativeEntryFx || r?.quoteFreshness?.source === false || r?.quoteFreshness?.entryMarket === false || r?.quoteFreshness?.exit === false || r?.quoteFreshness?.reference === false)) return '参考最终余额' + (gaps.length ? '（费用未齐）' : '（历史报价）');
    const label = canBalance ? state.outcome === 'atm' ? '计划取现后的银行余额' : (gaps.length ? '已扣已核费用后的余额' : estimated ? r?.depositMethod === 'wise' ? '按参考情景计算的余额' : '按公布参考价费计算的余额' : state.outcome === 'mainland' ? '内地人民币可用余额' : state.outcome === 'cnh-card' ? '受理商户可消费金额' : state.outcome === 'usd-card' ? '境外可消费金额' : '最终余额') : '最终余额暂不可算';
    return canBalance && r?.trading?.rebateUsd > 0 ? '优惠返还后 · ' + label : label;
  }
  function summary(data) {
    const { r, rows, total, gaps, partial, estimated, label, canBalance, lastPoint } = balancePresentation(data);
    const missingLabels = r?.missing?.length ? r.missing : gaps.flatMap(item =>
      (item.items || [item]).filter(part => part.cny == null).map(part => part.label));
    const balanceLabel = canBalance ? finalBalanceLabel({ gaps, estimated, canBalance, r }) : lastPoint ? lastBalanceLabel(lastPoint) : '最终余额暂不可算';
    const finalHtml = (canBalance ? amount(r.net, r.currency) : lastPoint ? amount(lastPoint.amount, lastPoint.currency) : '<b>—</b>') +
      (canBalance && r?.cashPlan ? '<small>另有计划现金 ' + cost(r.cashPlan.cash) + (r.cashPlan.operatorCny == null ? ' · 未扣ATM附加费' : '') + '</small>' : '') +
      (r?.sourceRemainderCny > 1e-6 ? '<small>另留内地账户 ' + cost(r.sourceRemainderCny) + '</small>' : '');
    const ratio = countedRatio(total, partial), hasPrice = rows.some(x => x.cny != null);
    return '<div class="flow-result"><div><span>' + label + '</span><strong class="num">' + (hasPrice ? ratio || cost(total) : '—') + '</strong>' +
      (hasPrice && ratio ? '<small>' + cost(total) + '</small>' : '') +
      (partial ? '<small>' + (rows.length ? data.error ? r?.errorAction === 'account' ? esc(data.error) : '第' + esc(r?.errorStage || data.errorStage || '01') + '步尚未完成' : '总费用尚缺：' + esc(missingLabels.join('、') || r?.exitIssue || '有效成交报价') : esc(data.error || '选择有效本金和汇出报价')) + '</small>' : '') + '</div><div class="flow-result-equation"><span>其中账户期间费</span><b>' +
      (row(r, 'account') ? displayCost(r, row(r, 'account')) : '—') + '</b>' + (r?.taxCny ? '<small>另预留税款 ' + cost(r.taxCny) + '</small>' : '<small>已计入合计</small>') + '</div><div><span>' + balanceLabel + '</span>' + finalHtml +
      '</div><div class="flow-result-detail">' +
      action('全程明细', 'detail', 'data-value="cost"', 'text-link') + '</div></div>';
  }
  function view(helpers) {
    H = helpers; const data = result();
    return H.head('CROSS-BORDER MONEY', '跨境资金', '') + '<div class="page-money-flow"><div id="flow-live-toolbar">' + toolbar() +
      '</div><div id="flow-live-ledger">' + flow(data) + '</div><div id="flow-live-summary" class="flow-summary-card" aria-live="polite">' + summary(data) +
      '</div><div class="flow-bottom-tools">' + action('实际成交报价与费用', 'detail', 'data-value="adjustments"', 'text-link') +
      '<span>便利化购汇不得用于境外证券投资；本页为费用测算。</span>' + action('适用条件', 'detail', 'data-value="mainland"', 'text-link') + '</div></div>';
  }
  function patch(element, html) {
    const template = document.createElement('template'); template.innerHTML = html;
    const identity = node => node.nodeType === 1 ? ['moneyField', 'moneySelect', 'moneyCheck'].map(key => node.dataset[key] || '').join(':') : '';
    function sync(old, fresh) {
      if (old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName || identity(old) !== identity(fresh)) { old.replaceWith(fresh.cloneNode(true)); return; }
      if (old.nodeType === 3) { if (old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue; return; }
      if (old.nodeType !== 1) return;
      for (const attr of [...old.attributes]) if (!fresh.hasAttribute(attr.name) && !(old.tagName === 'DETAILS' && attr.name === 'open')) old.removeAttribute(attr.name);
      for (const attr of fresh.attributes) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
      if (old.tagName === 'INPUT') {
        if (old !== document.activeElement && old.value !== fresh.value) old.value = fresh.value;
        old.checked = fresh.checked; return;
      }
      const target = [...fresh.childNodes];
      target.forEach((child, i) => old.childNodes[i] ? sync(old.childNodes[i], child) : old.appendChild(child.cloneNode(true)));
      while (old.childNodes.length > target.length) old.lastChild.remove();
      if (old.tagName === 'SELECT' && old.value !== fresh.value) old.value = fresh.value;
    }
    const wrapper = document.createElement(element.tagName); wrapper.append(template.content);
    // Keep the region itself and every unchanged control in the DOM. This
    // preserves focus, caret, native selection and open disclosure state.
    const children = [...wrapper.childNodes];
    children.forEach((node, i) => element.childNodes[i] ? sync(element.childNodes[i], node) : element.appendChild(node.cloneNode(true)));
    while (element.childNodes.length > children.length) element.lastChild.remove();
  }
  function refresh() {
    const data = result();
    for (const [id, render] of [['flow-live-toolbar', toolbar], ['flow-live-ledger', flow], ['flow-live-summary', summary]]) {
      const element = document.getElementById(id); if (element) patch(element, render(data));
    }
    if (modalKey && document.getElementById('dialog')?.open && document.getElementById('flow-detail-live')) detail(modalKey, true);
  }
  function choiceState(key, value) {
    const next = { ...state, [key]: value, plan: 'custom' };
    if (key === 'zaPerksLevel') next.zaLv2 = value === 'lv2';
    const reset = {
      startBank: ['startSell', 'senderFeeCny', 'entryMiddleCny', 'mainlandMethod'],
      bank: ['entryInwardHkd', 'depositHkd', 'depositOtherCny', 'monthlyHkd', 'entryPrice', 'mainlandMethod', 'depositMethod'],
      broker: ['brokerExitPrice', 'directInwardCny', 'tradeFeeUsd', 'entryPrice', 'depositHkd', 'depositOtherCny', 'inwardHkd', 'intermediaryCny', 'depositMethod'],
      returnBank: ['atmMode', 'atmCnyPerUnit', 'atmExtraCny', 'atmDailyLimitCny', 'atmPerTransactionCny', 'exitPrice', 'returnHkdPrice', 'cardCnyPerHkd', 'cardMode', 'inwardHkd', 'intermediaryCny', 'returnWireHkd', 'returnExtraCny', 'returnMonthlyHkd', 'returnMethod'],
      route: ['startSell', 'entryPrice', 'entryInwardHkd', 'depositHkd', 'depositOtherCny', 'depositMethod', 'mainlandMethod'],
      fxMode: ['entryPrice', 'depositHkd', 'depositOtherCny', 'depositMethod'], depositMethod: ['depositHkd', 'depositOtherCny'],
      mainlandMethod: ['startSell', 'senderFeeCny', 'entryMiddleCny', 'entryInwardHkd'], outcome: ['exitPrice', 'returnHkdPrice', 'cardCnyPerHkd'],
      cardMode: ['exitPrice', 'returnHkdPrice', 'cardCnyPerHkd'],
      atmMode: ['atmCnyPerUnit', 'atmExtraCny', 'atmDailyLimitCny', 'atmPerTransactionCny', 'exitPrice', 'returnHkdPrice'],
      withdrawCurrency: ['brokerExitPrice', 'inwardHkd', 'intermediaryCny', 'exitPrice', 'returnHkdPrice'],
      cnhWithdrawalMethod: ['inwardHkd', 'intermediaryCny'],
      withdrawDestination: ['inwardHkd', 'directInwardCny', 'intermediaryCny', 'exitPrice', 'returnHkdPrice', 'returnExtraCny'],
      returnCurrency: ['exitPrice', 'returnHkdPrice', 'returnWireHkd', 'returnExtraCny'],
      exitBank: ['directInwardCny', 'intermediaryCny', 'exitPrice', 'returnExtraCny', 'returnMethod'], returnMethod: ['returnWireHkd', 'returnExtraCny']
    };
    for (const field of reset[key] || []) next[field] = '';
    Object.assign(next, M.calculatorAccountState(state, next, D));
    if (key === 'broker') { next.useVoucher = false; next.ibkrPricing = value === 'ibkr-lite' ? 'lite' : 'fixed'; }
    if (['broker', 'exitBank', 'withdrawDestination'].includes(key)) next.directReceiptConfirmed = false;
    if (key === 'withdrawDestination' && value === 'mainland') { next.outcome = 'mainland-usd'; next.withdrawCurrency = 'USD'; next.returnCurrency = 'USD'; next.brokerExitPrice = ''; }
    if (key === 'outcome' && !['mainland', 'mainland-usd', 'broker-balance'].includes(value)) next.withdrawDestination = 'hong-kong';
    if (key === 'broker' || key === 'returnBank') next.hsbcChequeNonCounter = false;
    if (key === 'bank' || key === 'route') { next.senderFeeCny = ''; next.entryMiddleCny = ''; }
    if (key === 'returnBank' && next.outcome === 'cnh-card') next.exitPrice = '';
    if (key === 'broker') {
      next.useVoucher = false; next.voucherScope = value === 'za' ? 'platform' : 'commission';
      if (value !== 'ibkr') next.withdrawCurrency = 'USD';
      if (!M.supportsBrokerFx(value) && next.route !== 'USD') next.fxMode = 'bank';
      const provider = D.brokers.find(b => b.id === value);
      if (provider.withdrawalMethod !== 'wire' || provider.integratedBank) next.withdrawDestination = 'hong-kong';
    }
    const channels = availableChannels(next);
    // An optional full-receipt service belongs to the remittance, not to the
    // current Hong Kong account. Preserve it while the new route supports it.
    if (['bank', 'startBank', 'route'].includes(key) && ['full', 'cib-go', 'payment-connect'].includes(state.mainlandMethod) &&
        channels.mainlandMethods.includes(state.mainlandMethod)) next.mainlandMethod = state.mainlandMethod;
    // Explicit corporate or personal receiving-bank instructions remain the
    // same choice when other accounts change and that instruction still fits.
    if (['bank', 'broker', 'route', 'fxMode'].includes(key) && /^(?:via-|chats-|wise$)/.test(state.depositMethod) &&
        channels.depositMethods.includes(state.depositMethod)) next.depositMethod = state.depositMethod;
    if (key === 'broker' && ['fps', 'edda'].includes(state.depositMethod) && M.supportsBrokerFx(state.broker) && M.supportsBrokerFx(value) &&
        channels.depositMethods.includes(state.depositMethod)) next.depositMethod = state.depositMethod;
    return M.calculatorRoute(next);
  }
  function choose(key, value) {
    if (key === 'ibkrPricing' && ['fixed', 'lite'].includes(value)) { key = 'broker'; value = value === 'lite' ? 'ibkr-lite' : 'ibkr'; }
    const allowed = ['count', 'months', 'startBank', 'bank', 'broker', 'ibkrPricing', 'brokerWireChannel', 'outcome', 'returnBank', 'exitBank', 'route', 'mainlandMethod', 'depositMethod', 'returnMethod', 'returnCurrency', 'fxMode', 'cardMode', 'atmMode', 'withdrawCurrency', 'withdrawDestination', 'cnhWithdrawalMethod', 'voucherScope', 'zaPerksLevel'];
    if (!allowed.includes(key)) return;
    if (key === 'startBank' && !mainland.some(bank => bank.id === value)) return;
    if (key === 'exitBank' && !mainlandReceivers.some(bank => bank.id === value)) return;
    if (key === 'bank' && !D.calculator.hkBanks.includes(value)) return;
    if (key === 'returnBank' && !returnBanks.some(bank => bank.id === value)) return;
    if (key === 'broker' && !D.calculator.brokers.includes(value)) return;
    if (key === 'ibkrPricing' && !['fixed', 'lite'].includes(value)) return;
    if (key === 'brokerWireChannel' && !selected().broker?.withdrawalChannels?.[value]) return;
    if (key === 'atmMode' && !D.mainlandCash?.[state.returnBank]?.some(profile => profile.id === value)) return;
    if (key === 'withdrawCurrency' && !['USD', 'CNH'].includes(value)) return;
    if (key === 'withdrawDestination' && !['hong-kong', 'mainland'].includes(value)) return;
    if (key === 'cnhWithdrawalMethod' && !['local', 'wire'].includes(value)) return;
    if (key === 'cardMode' && !D.mainlandSpending?.[state.returnBank]?.modes.includes(value)) return;
    if (key === 'zaPerksLevel' && !['standard', 'lv1', 'lv2'].includes(value)) return;
    if (key === 'mainlandMethod' && !availableChannels(state).mainlandMethods.includes(value)) return;
    if (key === 'count' && value === 'custom') { detail('budget'); return; }
    if (state[key] === value) { save(); refresh(); return; }
    state = choiceState(key, value); save(); refresh();
  }
  function chequeBankCopy(bank, provider, r) {
    if (provider.withdrawalMethod !== 'cheque' && !provider.localChequeBanks?.includes(bank.id)) return null;
    if (bank.acceptsCheques === false) return '不接受支票存款；须使用其他取回银行';
    const actual = bank.id === state.returnBank ? M.number(state.inwardHkd) : null;
    if (actual != null && actual < 0) return '本人回单收款费须为非负数';
    const nonCounter = bank.id === state.returnBank && state.hsbcChequeNonCounter;
    const fee = actual ?? M.localUsdChequeFee(bank, M.number(state.chequeIndex), r?.returnDate || r?.trading?.sellDate || today(), state.chequePreFilled,
      { nonCounter, amountHkd: r?.steps?.afterTaxUsd * r?.refs?.USD / r?.refs?.HKD });
    const context = actual != null ? '本人回单收款费' : bank.localUsdChequeTariff?.nonCounterHkd != null ?
      '本地USD' + (nonCounter ? '非柜台' : '柜台') + '存票' : bank.localUsdChequeTariff ? '本地USD存票 · 当日第' + state.chequeIndex + '张' : '本地USD支票存入';
    const missing = !Number.isSafeInteger(M.number(state.chequeIndex)) || M.number(state.chequeIndex) < 1 ? '当日存票序号须为正整数' : '该日期的本地USD存票资费尚未取得';
    return context + '：' + (fee == null ? missing : num(fee) + ' HKD');
  }
  function bankPickerCopy(key, bank, data, config) {
    const r = data.selected || data.partial, provider = M.selectedBroker(config, D);
    const fee = row(r, key === 'bank' ? 'entryInward' : 'returnInward');
    const ownFee = bank.id === state[key] && M.number(state[key === 'bank' ? 'entryInwardHkd' : 'inwardHkd']) != null;
    let text = key === 'returnBank' ? chequeBankCopy(bank, provider, r) : null;
    if (text == null) {
      const settlement = key === 'returnBank' ? D.hkBanks.find(b => b.id === provider.integratedBank) : null;
      const virtualReturn = key === 'returnBank' && provider.withdrawalMethod === 'local' && !provider.localChequeBanks?.includes(bank.id);
      const label = ownFee ? '本人回单收款费' : key === 'bank' ? config.route + '汇入费' + (M.number(config.count) > 1 ? ' · ' + config.count + '笔合计' : '') :
        settlement ? 'USD' + (settlement.id === bank.id ? '内部交收' : '本地转账') : virtualReturn ? '数字银行USD提款' : (config.withdrawCurrency || 'USD') + (config.withdrawCurrency === 'CNH' && config.cnhWithdrawalMethod !== 'wire' ? '本地转账收款费' : '电汇收款费');
      const actualHkd = ownFee ? M.number(state[key === 'bank' ? 'entryInwardHkd' : 'inwardHkd']) : null;
      const count = key === 'bank' ? M.number(config.count) : 1;
      const validCount = Number.isSafeInteger(count) && count > 0;
      const hkd = actualHkd != null && actualHkd >= 0 && validCount ? actualHkd * count :
        fee?.cny == null || !(r?.refs?.HKD > 0) ? null : fee.cny / r.refs.HKD;
      const amount = actualHkd != null && actualHkd < 0 ? '须为非负数' : !validCount ? '汇出笔数须为正整数' :
        hkd == null ? fee?.status || (key === 'bank' ? '须先确定汇入金额与渠道' : '须先确定可出金金额与方式') :
        virtualReturn && !ownFee ? '参考 ' + num(fee.cny / r.refs.USD) + ' USD' : settlement && !ownFee ? displayCost(r, fee) : (fee.estimate ? '参考 ' : '') + num(hkd) + ' HKD';
      text = label + '：' + amount;
    }
    const account = row(r, 'account')?.items?.find(item => item.region === 'hong-kong' && item.bankId === bank.id);
    if (account?.cny != null) text += account.cny > 0 ? '；' + account.months + '个月管理费 ' + num(account.cny / r.refs.HKD) + ' HKD' : '；管理费0';
    if (key === 'returnBank' && bank.id === 'ccb-asia') text += '。陆港通龙卡可联动内地建行POS消费，须关联两地账户，卡年费50 HKD';
    if (key === 'returnBank' && bank.id === 'icbc-asia') text += '。支持内地银联POS／ICBC Pay；汇回本人内地工行可选e账通';
    if (key === 'returnBank' && config.outcome === 'atm') {
      const profiles = D.mainlandCash?.[bank.id];
      text += profiles?.length ? '。ATM：' + profiles.map(profile => profile.title + '，' + profile.fee + ' ' + profile.feeCurrency + '/笔' + (profile.dailyLimitHkd ? '，日最高等值' + profile.dailyLimitHkd.toLocaleString('en-US') + ' HKD' : '')).join('；') : '。尚缺该银行卡内地ATM资费及限额依据';
    }
    return text;
  }
  function picker(key) {
    modalKey = null;
    const titles = { startBank: '选择出发银行', bank: '选择香港收款银行', broker: '选择买美股的账户', outcome: '选择资金用途', returnBank: '选择取回／消费银行', exitBank: '选择内地收款银行' };
    const small = options.get(key), currentChoice = small?.value ?? state[key], isMainland = ['startBank', 'exitBank'].includes(key), isBank = ['bank', 'returnBank'].includes(key);
    const list = key === 'outcome' ? outcomes.map(([id, name]) => ({ id, name })) : isMainland ? (key === 'startBank' ? mainland : mainlandReceivers) : isBank ? key === 'returnBank' ? returnBanks : banks : key === 'broker' ? brokers : (small?.values || []).map(([id, name]) => ({ id, name }));
    const comparison = key === 'startBank' ? M.purchaseComparison({ ...state, date: today() }, comparisonData, window.MONEY_FLOW_QUOTES || {}) : null;
    const current = ['exitBank', 'bank', 'returnBank'].includes(key) ? result() : null;
    const exitCurrency = state.outcome === 'mainland-usd' || state.withdrawDestination === 'mainland' ? 'USD' : state.returnCurrency || 'USD', r = current?.selected || current?.partial;
    const exitDate = r?.returnDate || r?.trading?.sellDate || today();
    const exitQuotes = key === 'exitBank' ? M.quotedMainlandBanks(D, window.MONEY_FLOW_QUOTES || {}, today()) : [];
    const bankCopies = isBank ? new Map(list.map(item => {
      const config = { ...(item.id === state[key] ? state : choiceState(key, item.id)), date: today(), sellDate: today(), selectedOnly: true };
      const quote = item.id === state[key] ? current : M.calculatorJourney(config, D, window.MONEY_FLOW_QUOTES || {});
      return [item.id, bankPickerCopy(key, item, quote, config)];
    })) : null;
    const copy = item => key === 'broker' ? item.feeShort : key === 'exitBank' ? '境外' + exitCurrency + '汇入手续费：' + (item.inwardCny == null ? '尚未取得适用价目' : num(item.inwardCny) + ' CNY') : key === 'startBank' ? sourceTariffCopy(item) : bankCopies?.get(item.id) || '';
    const price = item => {
      if (key === 'exitBank') {
        if (state.outcome === 'mainland-usd') return '<span class="flow-picker-price"><small>保留USD原币</small></span>';
        const quote = exitQuotes.find(bank => bank.id === item.id)?.quotes?.[exitCurrency];
        const expired = quote?.spreadDiscount && exitDate > item.fxValidUntil;
        const actual = item.id === state.exitBank && M.number(state.exitPrice) > 0 ? M.number(state.exitPrice) : null;
        const buy = actual ?? (expired ? quote.publishedBuy : quote?.buy);
        return '<span class="flow-picker-price">' + (buy > 0 && (actual != null || M.quoteFresh(quote, today())) ? '<b>' + quoteNum(buy) + '</b><small>CNY/' + exitCurrency +
          (actual != null ? ' · 实际成交' : ' · 结汇' + (quote?.spreadDiscount && !expired ? ' · 点差五折' : '')) + '</small>' :
          '<small>' + (buy > 0 ? exitCurrency + '结汇牌价超过3天' : '尚未取得该行' + exitCurrency + '结汇牌价') + '</small>') + '</span>';
      }
      const q = comparison?.rows.find(x => x.bank.id === item.id);
      if (!comparison || state.route === 'CNH' || state.mainlandMethod === 'payment-connect') return '';
      return '<span class="flow-picker-price">' + (q?.comparable ? '<b>' + quoteNum(q.sell) + '</b><small>CNY/' + state.route + '</small>' +
        (comparison.best?.bank.id === item.id ? '<em>最低可比购汇价</em>' : '') : '<small>' + (q?.sell ? '报价超过3天' : '尚未取得该行' + state.route + '购汇牌价') + '</small>') + '</span>';
    };
    H.openModal(H.modalTitle(titles[key] || small?.label || '选择') + '<div class="flow-picker">' + list.map(item =>
      action((isMainland || isBank || key === 'broker' ? accountGlyph(key, item) : '') + '<span class="flow-picker-copy"><strong>' + esc(item.name) + '</strong>' + (copy(item) ? '<small>' + esc(copy(item)) + '</small>' : '') + '</span>' + price(item) +
        '<span class="flow-picker-check">' + (item.id === currentChoice ? '✓ 已选' : '') + '</span>', 'pick-choice',
        'data-field="' + key + '" data-value="' + esc(item.id) + '" aria-pressed="' + (item.id === currentChoice) + '"', 'flow-picker-option')).join('') + '</div>' +
      (comparison?.best && state.mainlandMethod !== 'payment-connect' ? '<p class="flow-picker-caption">购汇价按每1外币计；手续费由所选渠道另算。报价时间见详情。</p>' : ''));
  }
  function adjustments() {
    const s = selected(), active = new Set(M.calculatorAdjustmentFields(state, D));
    const fxAccount = state.fxMode === 'bank' ? shortName(s.bank) : 'IBKR';
    const prices = new Set(['brokerExitPrice', 'atmCnyPerUnit', 'startSell', 'entryPrice', 'returnHkdPrice', 'exitPrice', 'cardCnyPerHkd']);
    return '<div class="flow-parameter-grid">' + [
      ['brokerExitPrice', 'IBKR卖出后每1USD换回人民币', 'CNH'],
      ['directInwardCny', '内地USD收款行费', 'CNY'],
      ['atmCnyPerUnit', 'ATM人民币现金 ÷ 港币本金扣账（不含另列费用）', 'CNY/HKD'],
      ['atmExtraCny', '本次全部ATM运营方附加费', 'CNY'],
      ['atmDailyLimitCny', '本人已启用的每日提款限额', 'CNY'],
      ['atmPerTransactionCny', '所用ATM单笔提款上限', 'CNY'],
      ['startSell', state.mainlandMethod === 'payment-connect' ? '跨境支付通每1HKD成交价' : shortName(s.start) + '每1' + state.route + '购入价', 'CNY'], ['entryPrice', autoFxAtPurchase() ? 'IBKR每1USD成交价（含自动加价）' : fxAccount + '每1USD购入价', state.route],
      ['returnHkdPrice', '取回银行每1USD换回港币', 'HKD'],
      ['cardCnyPerHkd', '人民币消费金额 ÷ 港币总扣账（含费）', 'CNY/HKD'],
      ['exitPrice', '每1' + (state.outcome === 'mainland' ? state.returnCurrency || 'USD' : 'USD') + '换回金额', state.outcome === 'cnh-card' ? 'CNH' : 'CNY'],
      ['senderFeeCny', state.mainlandMethod === 'payment-connect' ? '每笔跨境支付通服务费' : '每笔汇出手续费＋电讯费', 'CNY'], ['entryMiddleCny', '每笔跨境代理费', 'CNY'], ['entryInwardHkd', '每笔香港汇入费', 'HKD'],
      ['depositHkd', state.depositMethod === 'wise' ? '香港银行 → Wise整段费用' : '股票入金转账费', 'HKD'], ['depositOtherCny', state.depositMethod === 'wise' ? 'Wise → IBKR整段费用折人民币' : '股票入金收款行／代理费', 'CNY'], ['tradeFeeUsd', '本次买卖实际交易费', 'USD'],
      ['inwardHkd', '出金收款行费', 'HKD'], ['intermediaryCny', '出金代理费', 'CNY'], ['returnWireHkd', '回内地汇出费', 'HKD'], ['returnExtraCny', '回内地其他费用', 'CNY'],
      ['monthlyHkd', '收款银行月费', 'HKD'], ['returnMonthlyHkd', '取回银行月费', 'HKD'], ['balanceHkd', '收款银行保留资产', 'HKD'], ['returnBalanceHkd', '取回银行保留资产', 'HKD'], ['openingCny', '开户实际支出', 'CNY']
    ].filter(([key]) => active.has(key)).map(args => field(...args, prices.has(args[0]) ? '实际成交价' : '留空使用公开收费')).join('') + '</div><p>' + action('恢复公开报价', 'clear-quotes') + '</p>';
  }
  function detail(key, updating = false) {
    modalKey = key;
    const data = result(), r = data.selected || data.partial, s = selected();
    let title = '费用明细', content = '', keys = [];
    if (key === 'budget') {
      title = '本金与汇出笔数'; content = '<div class="flow-form-grid">' + field('budgetCny', '人民币本金 · 含费用', 'CNY') + field('count', '汇出笔数', '笔') + '</div>';
    } else if (key === 'bank-settings') {
      const hsbcUsed = bankAccountSet(s).some(b => b.id === 'hsbc');
      title = '香港银行账户费用'; content = '<div class="flow-form-grid">' + field('months', '账户使用／持有月数', '月') +
        (hsbcUsed && !state.hsbcBalanceWaiver ? field('hkHsbcFreeMonths', 'One新户剩余免收费月数', '月') : '') + '</div>';
      content += row(r, 'account')?.items.filter(x => x.region !== 'mainland').map(x => feeLine(x.label, x.cny, accountFeeBasis(x), x.cny == null ? x.status || '' : num(x.cny / r.refs.HKD) + ' HKD', displayCny(r, x))).join('') || '';
      if (hsbcUsed) content += '<p>One新户开户后的首三个完整历月评估，随后未达标月份收100 HKD。剩余免收费月数默认0，不假定本次新开户；以后各月均符合豁免时勾选银行节点。过去三个月平均理财总值10,000 HKD含汇丰美股；香港身份证开户、2026年前One另获豁免。</p>';
      if (bankAccountSet(s).some(b => b.id === 'za')) {
        content += select('zaPerksLevel', 'ZA银行权益', [['standard', 'ZA Perks · 标准'], ['lv1', 'ZA Perks · Lv1'], ['lv2', 'ZA Perks · Lv2']]);
        if (M.zaPerksLevel(state) === 'lv1' && (state.bank === 'za' && state.depositMethod === 'swift' && s.broker.swiftDestination === 'overseas' || state.outcome === 'mainland' && state.returnBank === 'za')) content += field('zaSwiftUsed', '每个汇款月其他已用海外汇款笔数', '笔');
        content += '<p>ZA Perks等级按银行App已生效权益选择，不根据本次本金自动升级。2026年11月1日起，海外SWIFT本行费70 HKD/笔：Lv1每历月首3笔免，Lv2全免；香港本地SWIFT本行费仍为0。代理／收款行收费另计。</p>';
      }
      if (bankAccountSet(s).some(b => b.id === 'icbc-asia')) content += '<p>工银亚洲普通综合账户及借记卡年费豁免。本人非联名账户已在e账通绑定同名内地工行账户时，2026年7月1日至12月31日集团汇入基本费、手机集团汇出本行费免；其他银行费独立。人民币账户须香港身份证；未套用客户专属换汇优惠。</p>';
      keys = bankAccountSet(s).flatMap(b => evidenceFor('hkAccount', b));
    } else if (key.startsWith('cn-bank-')) {
      const bank = mainlandReceivers.find(bank => bank.id === key.slice(8)), service = bank?.accountService;
      if (!service) return;
      const item = row(r, 'account')?.items?.find(item => item.region === 'mainland' && item.bankId === bank.id);
      title = service.name + ' · 账户费用';
      content = '<div class="flow-form-grid">' + field('months', '账户使用／持有月数', '月') +
        (state[service.waiverField] ? '' : field(service.freeMonthsField, '剩余免收费月数', '月')) + '</div>' +
        (item ? feeLine(item.label, item.cny, accountFeeBasis(item)) : '') + checkbox(service.waiverField, '本持有期均已满足免月费条件') +
        '<p>' + esc(service.condition) + '</p>';
      keys = service.sources;
    } else if (key === 'trade-settings') {
      title = '美股买卖设置'; content = '<div class="flow-form-grid">' + field('sharePriceUsd', '买入均价', 'USD/股') + field('buyOrders', '买入笔数', '笔') + field('sellOrders', '卖出笔数', '笔') + '</div>';
      if (data.error && r?.errorAction === 'trade' && !['sharePriceUsd', 'buyOrders', 'sellOrders'].includes(r.errorField))
        content += '<p class="flow-error" role="status">' + esc(data.error) + '</p>';
      content += tradeLine(r, 'buy') + tradeLine(r, 'sell'); keys = actionSources('trade', s, r);
      if (s.broker.usdDepositMethods) content += '<p>' + esc(s.broker.feeText) + '</p>';
    } else if (key === 'profit-settings') {
      const chequeTariff = isChequeReturn(s) && s.returning?.localUsdChequeTariff;
      title = '盈亏、出金与税款'; content = '<div class="flow-form-grid">' + field('profitUsd', '卖出盈亏 · 交易费前', 'USD') +
        (state.outcome !== 'broker-balance' && s.broker?.freeWithdrawals ? field('withdrawalIndex', '本月第几次出金', '次') : '') +
        (chequeTariff?.freePerDay > 0 ? field('chequeIndex', '存票当日第几张支票', '张') : '') +
        field('taxRate', '应税所得税率', '%') + field('taxableCny', '人民币应税所得', 'CNY', '按正净利润估算') + field('creditCny', '税款抵免', 'CNY') + '</div>';
      if (chequeTariff?.preFilledHkd != null && M.number(state.chequeIndex) > chequeTariff.freePerDay) content += checkbox('chequePreFilled', '已预填多支票存款表');
      if (chequeTariff?.nonCounterHkd != null) content += checkbox('hsbcChequeNonCounter', '本次经存票机或其他非柜台渠道存票');
      if (chequeTariff) content += feeRow(r, 'returnInward', null, row(r, 'returnInward')?.evidence || '', 'HKD');
      keys = [...evidenceFor('brokerWithdrawal', s.broker), ...(chequeTariff ? chequeTariff.sources : []), 'tax'];
    } else if (key === 'offers') {
      title = shortName(s.broker) + ' · 优惠与费用券'; content = offers(s, r); keys = actionSources('offers', s, r);
    } else if (key.startsWith('edge-')) {
      const stage = key.slice(5), edgeKeys = ({ '01': transferKeys, '03': fundingRowKeys(r), trade: tradingRowKeys(r), withdraw: withdrawKeys,
        'return-fx': ['returnFx'], remit: returnTransferKeys, settle: ['exitFx'], '04': exitKeys })[stage] || [];
      title = ({ '01': '内地购汇与跨境汇款', '03': autoFxAtPurchase(r) ? '股票账户原币入金' : '换汇与股票入金', trade: autoFxAtPurchase(r) ? '买入时换美元与美股买卖' : '美股买卖',
        withdraw: state.withdrawDestination === 'mainland' ? '券商USD直接电汇内地' : '券商换汇与出金', 'return-fx': '美元换港币', remit: '汇回内地', settle: '内地结汇', '04': '资金使用' })[stage];
      content = '<div class="flow-action-details">' + edgeFees(r, edgeKeys, stage) + '</div>';
      if (stage === '03' && state.depositMethod === 'wise') content += '<p>' + esc(D.wiseFunding.condition) + '</p><p>' + esc(D.wiseFunding.evidence) + '</p>' +
        '<div class="flow-form-grid">' + field('depositHkd', '香港银行 → Wise整段费用', 'HKD', '留空按10 HKD参考费') +
        field('depositOtherCny', 'Wise → IBKR整段费用折人民币', 'CNY', '留空按10 HKD折算') + '</div>';
      if (s.broker.usdDepositMethods && ['03', 'trade', 'withdraw'].includes(stage) && !(stage === '03' && state.depositMethod === 'wise')) content += '<p>' +
        esc(stage === '03' ? s.broker.fundingText : stage === 'trade' ? s.broker.feeText : s.broker.withdrawalText) + '</p>';
      if (stage === '01') {
        content += '<p>' + esc(transferHint() || sourceTariffCopy(s.start)) + '</p>';
        if (state.mainlandMethod === 'payment-connect') content += paymentConnectDetails() + '<p>' + esc(D.paymentConnect.waiverEvidence) + '</p>';
        if (s.start?.id === 'cib' && state.route === 'CNH' && state.mainlandMethod !== 'payment-connect') {
          content += '<p>人民币原币汇出不发生购汇；先用人民币购汇再汇出美元／港币，才适用寰宇人生的跨境外汇优惠。这里按普通寰宇人生卡计算，VIP等级减免另按本人实际费用。</p>';
          const sender = row(r, 'sender');
          if (r?.steps?.mainlandForeign != null && sender?.cny != null) content += '<p>含费预算 ' + cost(r.budgetCny) + ' ＝ 汇出本金 ' +
            cost(r.steps.mainlandForeign) + ' ＋ 本行汇款费用 ' + displayCost(r, sender) + '；境外代理费及收款费另列。</p>';
        }
        if (s.start?.id === 'cib' && state.route !== 'CNH') content += M.telegramAllowance(s.start, today()) ?
          field('usedFreeTransfers', '优惠期内已汇出笔数', '笔') + '<p>寰宇人生外汇汇出手续费免，优惠期前30笔电讯费免；优惠至2027-06-30。</p>' :
          '<p>外汇汇款优惠已到期；手续费按标准1‰、50–200元，电讯费100元/笔。未预设优惠续期。</p>';
      }
      keys = [...actionSources(stage, s, r), ...(r?.rows || []).filter(item => edgeKeys.includes(item.key))
        .flatMap(item => [...(item.sources || []), ...(item.items || []).flatMap(part => part.sources || [])])];
      if (stage === 'withdraw' && state.withdrawCurrency === 'CNH') content += '<div class="flow-form-grid">' + field('brokerExitPrice', 'IBKR卖出后USD/CNH实际成交价', 'CNH/USD', '留空使用已存公开参考价') + field('inwardHkd', '香港CNH收款行费用', 'HKD', '仅填已确认费用') + '</div><p>手动换汇按每月首档0.20基点、每单最低2 USD计算，金额大时佣金超过2美元；未取得可成交报价，不宣称汇率最优。每月前两次出金免费，之后CNH本地转账7 CNH、电汇60 CNH。IBKR账户可选币种／渠道及收款银行实际支持情况仍须匹配。</p>';
      if (stage === 'withdraw' && state.withdrawDestination === 'mainland') content += '<div class="flow-form-grid">' + field('directInwardCny', '内地收款行费', 'CNY', '留空使用本行收费') + field('intermediaryCny', '券商直达内地的中转费', 'CNY', '尚未取得请留空') + '</div><p>这里展示本人账户已确认可出金及收款的条件情景。境外投资资金原币入账不代表自动符合结汇资格；不得将其改报为工资、赡家款或其他用途。未确认时保留券商余额。</p>';
      if (stage === '04' && state.outcome === 'atm') {
        const profile = M.mainlandCashProfile(state, D);
        content += '<p>' + esc(profile?.note || '尚缺该银行卡的内地ATM资费依据。') + '</p><div class="flow-form-grid">' +
          (state.withdrawCurrency === 'USD' ? profile?.currency === 'HKD' ? field('returnHkdPrice', '本行USD/HKD实际兑换价', 'HKD/USD', '留空使用本行直接价') : field('exitPrice', '本行USD/CNH直接兑换价', 'CNH/USD', '留空使用本行参考价') : '') +
          (profile?.currency === 'HKD' ? field('atmCnyPerUnit', '人民币现金 ÷ 港币本金扣账（不含另列费用）', 'CNY/HKD', '不得用银行现汇价替代') : '') +
          field('atmExtraCny', '本次全部ATM运营方附加费', 'CNY', '未取得请留空') + field('atmDailyLimitCny', '本人已启用的每日限额', 'CNY', '未确认请留空') + field('atmPerTransactionCny', 'ATM单笔提款上限', 'CNY', '未确认请留空') + '</div>' +
          '<p>' + esc(profile?.limitNote || '') + '本页为一笔或多笔计划提款费用，剩余资金保留在银行，不保证当天可执行；未启用海外提款时实际限额为0。不同银行的额度不相加为免审核额度，重复或异常交易仍可能被审核。现金估值差额按统一CNH／HKD及CNY参照价对账，原币提款的估值差不属于另收的银行手续费。</p>';
        keys.push(...(profile?.sources || []));
      }
      if (stage === '04' && state.outcome === 'cnh-card') {
        const spending = D.mainlandSpending?.[s.returning.id], mode = M.mainlandCardMode(state, D);
        if (spending) {
          content += '<h3>' + esc(spending.title) + '</h3><dl class="flow-consumption-detail"><dt>内地受理范围</dt><dd>' + esc(spending.coverage) +
            '</dd><dt>限制</dt><dd>' + esc(spending.limitation) + '</dd><dt>扣账与费用</dt><dd>' + esc(spending.note) + '</dd></dl>';
          keys.push(...spending.sources);
        }
        content += '<div class="flow-form-grid">' + (M.cnhCardMode(mode) ? state.withdrawCurrency === 'CNH' ? '' : field('exitPrice', '本行USD直接兑换人民币成交价', 'CNH/USD', '仅填直接兑换价') :
          field('returnHkdPrice', '本行USD兑换HKD成交价', 'HKD/USD', '本行直接报价') + field('cardCnyPerHkd', '人民币消费金额 ÷ 港币总扣账', 'CNY/HKD', '含该笔支付的全部扣费')) + '</div>';
        content += '<p>汇丰未填实际USD/CNH价时，按已存本行牌价折算作参考，不代表直接成交报价；实际价优先。其他银行不套用汇丰估算。港币卡消费使用其实际扣账汇率。</p>';
      }
      if (stage === 'settle') content += '<p>' + esc(D.mainlandSpending.bank.note) + '</p>';
    } else if (key === 'mainland') {
      title = '适用条件'; keys = ['safe', 'pbcRmb', 'scCnTerms', 'csrc'];
      content = '<p>大陆个人便利化购汇不得用于境外证券投资；同名香港账户不改变用途限制。本页比较收费，实际资金来源、用途和汇款资格由相关机构审核。</p>';
    } else if (key === 'adjustments') {
      title = '实际成交报价与费用'; content = '<p>仅填写已取得的个人报价或回单。更换对应银行、渠道或币种后，该段覆盖值自动清除。</p>' + adjustments();
    } else if (key === 'quotes') {
      title = '汇率与收费依据'; keys = mainland.flatMap(bank => evidenceFor('mainlandFx', bank));
      const q = window.MONEY_FLOW_QUOTES || {}, comparison = M.purchaseComparison({ ...state, date: today() }, comparisonData, q);
      content = '<h3>交易费用与换汇点差</h3><p>费用合计包含实际手续费，以及成交价相对同机构、同币对买卖中间价的点差。IBKR手动换汇的点差与佣金分开计算；自动换汇加价只计一次。原币余额始终按成交方向的买卖价计算。</p>' +
        '<h3>人民币估值</h3><p>不同币种的费用共用人民币折算基准：USD/CNY取中行现汇买卖价平均值，USD/HKD与USD/CNH取中银香港买卖价平均值。银行、币种及报价时点之间的估值变化在全程明细单列，不抵扣手续费，也不作为负费用或返现。</p>';
      if (r?.referenceQuote) content += '<p>本次USD/CNY基准：' + (r.referenceQuote.custom ? '实际设置的参照价' : esc(r.referenceQuote.bank) + '现汇买卖价平均值') +
        ' ' + quoteNum(r.refs.USD) + ' CNY/USD' + (r.referenceQuote.custom ? '' : ' · ' + esc(r.referenceQuote.asOf)) + '。</p>';
      content += '<div class="flow-cost-detail">' + comparison.rows.map(x => '<div><span>' + esc(x.bank.name) + '<small>' + esc(x.quote?.asOf || '尚未取得该行购汇牌价') +
        (x.quote?.timeBasis === 'observed' ? ' · 采集时点' : '') + '</small></span><b>' + (x.sell ? quoteNum(x.sell) + ' CNY/' + state.route : '—') + '</b></div>').join('') + '</div>';
      content += '<h3>香港银行公开换汇价</h3><div class="flow-cost-detail">' + Object.entries(q.offshoreUsd || {}).flatMap(([id, bank]) =>
        Object.entries(bank.quotes || {}).map(([currency, price]) => '<div><span>' + esc(shortName(returnBanks.find(b => b.id === id))) + ' · USD/' + currency +
          '<small>' + esc(price.asOf) + (price.path === 'via-HKD' ? ' · 港币两腿牌价折算' : '') + '</small></span><b>卖美元 ' + quoteNum(price.bidPerUsd) +
          '<small>买美元 ' + quoteNum(price.askPerUsd) + '</small></b></div>')).join('') + '</div>';
      const brokerQuotes = Object.entries(q.brokerUsd?.ibkr?.quotes || {});
      if (brokerQuotes.length) content += '<h3>IBKR公开换汇价</h3><div class="flow-cost-detail">' + brokerQuotes.map(([currency, price]) =>
        '<div><span>IBKR · USD/' + esc(currency) + '<small>' + esc(({ live: '实时参考', delayed: '延迟行情', frozen: '休市冻结行情', 'frozen-delayed': '休市延迟行情' })[price.quoteStatus] || '公开参考') +
        ' · 快照 ' + esc(price.asOf) + '</small></span><b>卖美元 ' + quoteNum(price.bidPerUsd) + '<small>买美元 ' + quoteNum(price.askPerUsd) + '</small></b></div>').join('') +
        '</div><p>金额按公开买卖盘测算；佣金和自动换汇加价另计。快照时间不是最后成交时间，休市价格不代表实时可成交价。个人成交价优先。</p>';
      if (r?.refs) content += '<p>统一折算：1 USD = ' + num(r.refs.USD, 6) + ' CNY；1 HKD = ' + num(r.refs.HKD, 6) + ' CNY。CNY与CNH分开计价。</p>';
      content += '<h3>同名转账豁免</h3><p>中行山西省分行2026年5月29日新华网供稿确认手机银行向境外中行汇款免手续费及电报费。中银香港官网确认同名基本汇入费免；代理费0另据USD/HKD同行SHA操作记录，不由上述基本费豁免推出。恒生、汇丰、渣打分别适用所列同名渠道和账户条件。</p>';
      keys.push('bocFx', 'bochkSame', 'bocMobile2026', 'bocMobileUsdGuide', 'hang', 'hsbcGlobal', 'sc', 'bochkUsdFx', 'hsbcHkFx', 'hangHkFx', 'ibFxQuotes', 'ibFxFields');
      content += paymentConnectDetails() + '<h3>收费与缺项复核 · ' + esc(D.verificationReview.checkedAt) + '</h3><dl class="flow-consumption-detail">' +
        D.verificationReview.items.map(item => '<dt>' + esc(item.title) + '</dt><dd>' + esc(item.finding) +
          (item.remaining ? '<p>仍缺：' + esc(item.remaining) + '</p>' : '') + item.sources.map(source).join(' · ') + '</dd>').join('') + '</dl>';
      keys.push(...D.paymentConnect.sources, 'paymentSouthReport', ...Object.values(D.paymentConnect.southbound.bankLimits).flatMap(item => item.sources));
    } else {
      const rows = key === 'stage' ? currentRows(r) : r?.rows || [];
      title = key === 'stage' ? stageNames[Number(state.activeStep) - 1] + ' · 费用明细' : '全程费用明细';
      content = rows.length ? detailRows(r, rows) :
        '<p>' + esc(data.error || '选择对应账户后显示资费') + '</p>';
      const valuation = rows.reduce((sum, item) => sum + (item.fxImpactCny || 0), 0);
      if (Math.abs(valuation) >= .005) content += '<h3>估值变化（不计入费用）</h3><p>' + (valuation > 0 ? '+' : '') + cost(valuation) + '。来自不同币种、银行及报价时点的人民币估值差异，不是银行返现，也没有增加原币余额。</p>';
      if (r?.missing?.length) content += '<h3>影响最终金额的项目</h3><ul>' + r.missing.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
      const presentation = balancePresentation(data), { canBalance, lastPoint } = presentation;
      if (canBalance && Number.isFinite(r?.netCny)) content += '<p>' + esc(finalBalanceLabel(presentation)) + ' ' + num(r.net) + ' ' + esc(r.currency) + '，折合 ' + num(r.netCny) + ' CNY。' +
        (r.complete ? '' : '未报价项目未扣除。') + '人民币折算尾差按余数分配，分项与合计一致；原币费用与余额按完整精度计算。</p>';
      else if (lastPoint) content += '<p>最后可计余额：' + num(lastPoint.amount) + ' ' + esc(lastPoint.currency) + '</p>';
      keys = [...journeySources(s, r), ...rows.flatMap(item => [...(item.sources || []), ...(item.items || []).flatMap(part => part.sources || [])])];
    }
    const html = H.modalTitle(title) + '<div class="flow-detail">' + content + '<div class="flow-detail-sources">' + [...new Set(keys)].filter(Boolean).map(source).join('') + '</div></div>';
    if (updating) patch(document.getElementById('flow-detail-live'), html);
    else H.openModal('<div id="flow-detail-live">' + html + '</div>');
  }
  function handleAction(button) {
    const act = button.dataset.action.replace('money-flow-', ''), value = button.dataset.value;
    if (act === 'pick' || act === 'control-pick') { picker(value); return; }
    if (act === 'preset') { const p = visiblePresets.find(x => x.id === value); if (!p) return; document.getElementById('dialog')?.close(); state = presetState(p); save(); refresh(); return; }
    if (act === 'detail') { detail(value); return; }
    if (act === 'choose' || act === 'pick-choice') { if (act === 'pick-choice') document.getElementById('dialog')?.close(); choose(button.dataset.field, value); return; }
    if (act === 'clear-quotes') { for (const key of quoteKeys) state[key] = ''; state.tradeFeeUsd = ''; save(); document.getElementById('dialog')?.close(); refresh(); return; }
    if (act === 'reset') { state = { ...defaults }; save(); refresh(); }
  }
  function handleInput(el) {
    const key = el.dataset.moneyField; if (!key || !Object.hasOwn(defaults, key)) return false;
    state[key] = el.value; state.plan = 'custom'; save(); clearTimeout(timer); timer = setTimeout(refresh, 120); return true;
  }
  function handleChange(el) {
    if (el.dataset.moneyCheck) { state[el.dataset.moneyCheck] = el.checked; if (el.dataset.moneyCheck === 'zaLv2') state.zaPerksLevel = el.checked ? 'lv2' : 'standard'; save(); refresh(); return true; }
    if (el.dataset.moneySelect) { choose(el.dataset.moneySelect, el.value); return true; }
    if (el.dataset.moneyField) { clearTimeout(timer); refresh(); return true; }
    return false;
  }
  window.ChanghengMoneyFlow = { view, handleAction, handleInput, handleChange };
}());
