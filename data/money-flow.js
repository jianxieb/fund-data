(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.MONEY_FLOW = data;
}(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  return {
    verifiedAt: '2026-10-08',
    sources: {
      safe: { name: '外汇局 · 个人购汇用途与额度', url: 'https://www.safe.gov.cn/shanghai/2019/1213/1198.html' },
      remit: { name: '外汇局 · 外汇账户汇出与真实性材料', url: 'https://www.safe.gov.cn/tianjin/2026/0422/3039.html' },
      csrc: { name: '证监会 · 2026年跨境证券经营整治', url: 'https://www.csrc.gov.cn/csrc/c100028/c7634324/content.shtml' },
      boc: { name: '中国银行 · 电子银行汇款标准价', url: 'https://www.boc.cn/ebanking/service/cs1/200905/t20090506_990712.html' },
      bocFx: { name: '中国银行 · 外汇牌价（每100外币）', url: 'https://www.boc.cn/sourcedb/whpj/' },
      cmb: { name: '招商银行 · 专业版跨境汇款标准价', url: 'https://www.cmbchina.com/personalbank/gb/page/standfee.htm' },
      cmbFx: { name: '招商银行 · 外汇牌价（每100外币）', url: 'https://fx.cmbchina.com/hq/' },
      bochkUsdFx: { name: '中银香港 · 每1USD的CNH/HKD参考买卖价', url: 'https://www.bochk.com/whk/rates/exchangeRatesUSD/exchangeRatesUSD-input.action?lang=cn' },
      ibCnh: { name: 'IBKR · 离岸人民币可作入金币种', url: 'https://www.interactivebrokers.com/campus/glossary-terms/chinese-offshore-renminbi-cnh/' },
      pbcRmb: { name: '人民银行 · 跨境人民币经常与资本项目规定', url: 'https://www.pbc.gov.cn/chubanwu/114566/114579/4356052/4356380/2021100915525242238.pdf' },
      scCnTerms: { name: '渣打中国 · 境外转账范围与用途', url: 'https://www.sc.com/cn/electronic-banking-overseas-transfer-service-terms/' },
      cib: { name: '兴业银行 · 综合服务价目表', url: 'https://www.cib.com.cn/cn/aboutCIB/about/charges/adjustment/combined.html' },
      hsbcCn: { name: '汇丰中国 · 卓越理财50万元条件', url: 'https://www.hsbc.com.cn/premier/' },
      hsbcGlobal: { name: '汇丰 · 环球账户间免费转账', url: 'https://internationalservices.hsbc.com/zh-cn/international-banking/global-view-global-transfers/' },
      hsbcHk: { name: '汇丰香港 · 2026年8月1日收费表', url: 'https://www.hsbc.com.hk/content/dam/hsbc/hk/tc/docs/ways-to-bank/bank-tariff/20260801-guide.pdf' },
      hsbcCard: { name: '汇丰香港 · 多币种Mastercard扣账卡', url: 'https://www.hsbc.com.hk/zh-hk/debit-cards/products/mastercard-debit-card/' },
      sc: { name: '渣打中国 · 同名汇款费用豁免', url: 'https://www.sc.com/cn/gba/personal-finance-cross-boundary/' },
      scTier: { name: '渣打中国 · 优先理财资格', url: 'https://www.sc.com/cn/international-banking-new/' },
      hang: { name: '恒生 · 两地同名跨域转账', url: 'https://www.hangseng.com/zh-cn/personal/banking/cross-border-view-and-transfer/' },
      hangOpen: { name: '恒生香港 · 内地居民开户及账户门槛', url: 'https://www.hangseng.com/zh-cn/cross-border-banking/personal/account-opening/' },
      hangLocal: { name: '恒生香港 · 免费网上本地转账', url: 'https://www.hangseng.com/zh-cn/personal/banking/fps/' },
      bochk: { name: '中银香港 · 汇款收费', url: 'https://www.bochk.com/sc/crossborder/remittance/charges.html' },
      bochkSame: { name: '中银香港 · 内地中行同名汇款豁免', url: 'https://www.bochk.com/sc/crossborder/personal/financialservicehk/remittance.html' },
      za: { name: '众安银行 · 2026年6月转账收费更新', url: 'https://bank.za.group/hk/notice-detail/979ca80f-2fb4-4add-b30c-18144d3a757f' },
      zaNov: { name: '众安银行 · 11月1日将调整SWIFT汇出费', url: 'https://bank.za.group/hk/notice-detail/9275c1df-5e53-4327-b0f2-1862361ce630' },
      zaCard: { name: '众安银行 · 外币及跨境港元签账费用', url: 'https://bank.za.group/hk/notice-detail/6db8b52c-bcb3-4d4e-a051-7dc9bae37560' },
      zaOpen: { name: '众安银行 · 在港开户与免账户管理费', url: 'https://bank.za.group/hk/account-open' },
      zaVisit: { name: '众安银行 · 访港旅客开户材料', url: 'https://blog.za.group/hk/article/open_a_hong_kong_account' },
      ibFx: { name: 'IBKR · 手动换汇佣金与自动换汇加价', url: 'https://www.interactivebrokers.com/en/pricing/commissions-spot-currencies.php' },
      ibFees: { name: 'IBKR · 每月两次免费出金及后续收费', url: 'https://www.interactivebrokers.com/en/pricing/other-fees.php' },
      ibFunding: { name: 'IBKR · 入金通知、同名资金与存取限制', url: 'https://brokerage.ibkr.com/en/support/fund-my-account.php' },
      sfc: { name: '香港证监会 · 指定银行账户远程开户方法', url: 'https://www.sfc.hk/en/Rules-and-standards/Account-opening/Acceptable-account-opening-approaches' },
      tax: { name: '税务总局 · 居民境外所得个人所得税', url: 'https://www.chinatax.gov.cn/chinatax/n810219/n810744/n3752930/n3752974/c5143076/content.html' },
      payment: { name: '香港政府 · 跨境支付通范围与限额', url: 'https://www.info.gov.hk/gia/general/202509/10/P2025090900719.htm' },
      paymentHsbc: { name: '汇丰香港 · 跨境支付通使用资格', url: 'https://www.hsbc.com.hk/zh-hk/help/faq/transfers-and-payments/' },
      scHk: { name: '渣打香港 · 2026年10月服务收费', url: 'https://av.sc.com/hk/zh/content/docs/hk-service-charges-zh.pdf' },
      scCard: { name: '渣打香港 · 多货币扣账卡', url: 'https://www.sc.com/hk/zh/bank-with-us/multicurrency-debit-card/' },
      hangHk: { name: '恒生香港 · 2026年7月服务收费', url: 'https://www.hangseng.com/content/dam/wpb/hase/config/bde/pws/personal/servicecharges/pdfs/zh_HK/tariff_personal_sc.pdf' },
      hangCard: { name: '恒生香港 · 多货币扣账卡', url: 'https://www.hangseng.com/zh-cn/personal/cards/products/multi-currency-debit-card/' },
      bochkAccount: { name: '中银香港 · 个人账户及扣账卡收费', url: 'https://www.bochk.com/sc/servicecharge.common.html' },
      bochkCard: { name: '中银香港 · 多货币扣账设置', url: 'https://www.bochk.com/dam/more/bocdebitcard/card/sc.html' }
    },
    mainlandBanks: [
      { id: 'boc', name: '中国银行', group: 'boc', rate: 0.001, minimum: 50, maximum: 260, telegram: 80, feeText: '1‰，50–260元 + 80元电讯费', condition: '公开电子银行标准价；App优惠另填', sources: ['boc', 'bocFx'], quoteSource: 'bocFx' },
      { id: 'cmb', name: '招商银行', group: 'cmb', rate: 0.001, minimum: 100, maximum: 1000, telegram: 150, feeText: '1‰，100–1,000元 + 150元电讯费', condition: '专业版标准价；不等同手机银行优惠', sources: ['cmb', 'cmbFx'], quoteSource: 'cmbFx' },
      { id: 'cib', name: '兴业 · 寰宇人生', group: 'cib', rate: 0, minimum: 0, maximum: 0, telegram: 100, freeTelegram: 30, validFrom: '2026-07-01', validUntil: '2027-06-30', required: 'cib', feeText: '汇款费免；优惠期前30笔电讯费免', condition: '须持指定寰宇人生卡；中转/收款行费用另计', sources: ['cib'] },
      { id: 'hang', name: '恒生 · 跨域转账', group: 'hang', rate: 0, minimum: 0, maximum: 0, telegram: 0, required: 'hang', includedIntermediary: true, feeText: '指定两地同名转账免费', condition: '须有恒生中国＋香港账户；内地账户准入需银行确认', sources: ['hang', 'hangOpen'] },
      { id: 'hsbc', name: '汇丰 · 环球转账', group: 'hsbc', rate: 0, minimum: 0, maximum: 0, telegram: 0, required: 'hsbc', thresholdCny: 500000, includedIntermediary: true, feeText: '已连通同名环球转账免费', condition: '中国卓越理财通常月日均50万元；境外卓越身份等可豁免', sources: ['hsbcCn', 'hsbcGlobal'] },
      { id: 'sc', name: '渣打 · 同名速汇', group: 'sc', rate: 0, minimum: 0, maximum: 0, telegram: 0, required: 'sc', thresholdCny: 500000, includedIntermediary: true, feeText: '手续费、电讯费、中间行费用免', condition: '优先理财＋两地同名账户＋指定网上/手机渠道，选OUR', sources: ['sc', 'scTier'] }
    ],
    hkBanks: [
      { id: 'za', name: '众安 ZA Bank', group: 'za', inwardHkd: 0, localHkd: 0, localUsd: 0, outwardHkd: 0, outwardChanges: [{ from: '2026-11-01', fee: 70 }], monthlyHkd: 0, thresholdHkd: 0, cardForeignPct: 1.95, condition: '在港申请；无账户管理费。外币/海外处理港元签账有1.95%费用', sources: ['za', 'zaNov', 'zaOpen', 'zaCard'] },
      { id: 'hsbc', name: '汇丰 HSBC One', group: 'hsbc', inwardHkd: 0, localHkd: 0, localUsd: 0, outwardHkd: 70, monthlyHkd: 100, thresholdHkd: 10000, directUsdCard: true, cardForeignPct: 0, condition: '2026年起新开非香港身份证One：低于1万港元收100港元/月；扣账卡外币交易费免', sources: ['hsbcHk', 'hsbcCard'] },
      { id: 'bochk', name: '中银香港', group: 'boc', inwardHkd: 60, inwardSmallLimitHkd: 500, sameGroupWaiver: true, localHkd: 0, localUsd: 0, outwardHkd: 65, monthlyHkd: 0, thresholdHkd: 0, directUsdCard: true, cardForeignPct: 0, condition: '普通个人账户免月费；一般汇入超过500港元收60港元，内地中行同名优惠可免。中银快汇指定渠道另免汇出费', sources: ['bochkAccount', 'bochkSame', 'bochkCard'] },
      { id: 'hang', name: '恒生 · 优进理财', group: 'hang', inwardHkd: 0, sameGroupWaiver: true, localHkd: 0, localUsd: 0, outwardHkd: 65, monthlyHkd: 0, thresholdHkd: 0, directUsdCard: true, cardForeignPct: 0, condition: '优进理财无最低理财总值/月费；跨域转账须已登记，并经指定页面提交', sources: ['hangHk', 'hangOpen', 'hangCard'] },
      { id: 'sc', name: '渣打 · 快易理财', group: 'sc', inwardHkd: 0, sameGroupWaiver: true, localHkd: 0, localUsd: null, localUsdNative: 22, outwardHkd: 50, monthlyHkd: 0, thresholdHkd: 0, directUsdCard: true, cardForeignPct: 0, condition: '快易理财免服务费；HKD/CNH网上非RTGS转账免；USD本地RTGS标准费22美元，实际豁免可覆盖', sources: ['scHk', 'scCard', 'sc'] }
    ],
    broker: { name: 'IBKR直接客户', manualRate: 0.00002, manualMinimumUsd: 2, autoMarkup: 0.0003, freeWithdrawals: 2, withdrawUsd: 10, withdrawHkdWire: 95, withdrawHkdLocal: 8, sources: ['ibFx', 'ibFees', 'ibFunding'] }
  };
}));
