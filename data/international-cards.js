(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.INTERNATIONAL_CARDS = data;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const reviewedAt = '2026-10-25';
  const sources = {
    hsbcHK: ['香港汇丰 Mastercard 扣账卡', 'https://www.hsbc.com.hk/debit-cards/products/mastercard-debit-card/'],
    hsbcHKFAQ: ['香港汇丰：申请、费用、寄送与启用', 'https://www.hsbc.com.hk/zh-hk/help/faq/debit-cards/'],
    hsbcHKFees: ['香港汇丰：Mastercard扣账卡零年费', 'https://www.hsbc.com.hk/help/faq/debit-cards/'],
    hsbcOne: ['HSBC One 账户收费条件', 'https://www.hsbc.com.hk/accounts/products/one/'],
    firstradeProduct: ['Firstrade CMA 产品与免费开卡', 'https://www.firstrade.com/trading/cash-management'],
    firstrade: ['Firstrade：借记卡申请条件（2026-05-07）', 'https://help.firstrade.info/en/articles/9260135-how-do-i-apply-for-a-debit-card'],
    firstradeFees: ['Firstrade：CMA 费用与规则（2026-05-04）', 'https://help.firstrade.info/en/articles/14897737-debit-card-and-cash-management-account-rules'],
    schwab: ['嘉信国际开户入口', 'https://international.schwab.com/open-account-intro'],
    schwabFees: ['嘉信国际：无开户及账户维护费', 'https://international.schwab.com/us-investing-brokerage-account'],
    schwabAgreement: ['嘉信账户及 Visa 协议（2026-10）', 'https://www.schwab.com/legal/schwab-one-account-agreement'],
    velo: ['Velo 中国护照远程开户', 'https://velobank.com/'],
    veloFees: ['Velo Global Checking 门槛与费用', 'https://velobank.com/en/products/global-checking.html'],
    veloCredit: ['Velo 担保信用卡', 'https://velobank.com/en/products/credit-cards/secured-credit-card.html'],
    hsbcUS: ['美国汇丰：海外申请及无 SSN 路径', 'https://www.us.hsbc.com/account-opening/frequently-asked-questions/'],
    hsbcUSFees: ['美国汇丰 Premier 维持与关户条款', 'https://www.us.hsbc.com/checking-accounts/products/premier/'],
    fv: ['FV Bank 个人账户与国家资格检查器', 'https://fvbank.us/personal-banking'],
    fvMinimum: ['FV Bank Individual Plus 开户说明', 'https://i-plus-global.fvbank.us/'],
    fvFees: ['FV Bank 账户费用', 'https://fvbank.us/banking-fees'],
    fvCard: ['FV Bank Visa 卡费用', 'https://fvbank.us/debit-card-fees'],
    wiseUS: ['Wise 美国卡：无 SSN、费用及启用', 'https://wise.com/help/articles/2975581/what-do-i-need-to-do-to-get-my-wise-multi-currency-card-in-the-us'],
    wiseAddress: ['Wise 地址证明要求', 'https://wise.com/help/articles/2949804/how-do-i-verify-my-address'],
    wiseResidence: ['Wise 居留资格核验', 'https://wise.com/help/articles/3xConsbhr7buWkQuqDEQ5V/how-do-i-verify-my-country-of-residence'],
    wiseDigital: ['Wise 数字卡支持地区与申请', 'https://wise.com/help/articles/1AqrRndtxosydM2GLR3U6T/getting-started-with-your-wise-digital-card'],
    wiseDigitalFee: ['Wise 美国虚拟卡', 'https://wise.com/us/virtual-card/'],
    freedom: ['Freedom Bank 电子居民开卡流程', 'https://bankffin.kz/en/cards/e-residency'],
    eResidency: ['哈萨克斯坦政府电子居民中文 FAQ', 'https://www.eresidency.gov.kz/zh/faq'],
    dukascopy: ['Dukascopy 开户资格及视频核验', 'https://www.dukascopy.bank/faq/'],
    dukascopyCards: ['Dukascopy 合作发卡产品', 'https://www.dukascopy.bank/services/cards/'],
    dukascopyFees: ['Dukascopy 账户及卡片费表', 'https://www.dukascopy.bank/fees/'],
    unfcu: ['UNFCU 会员资格', 'https://www.unfcu.org/join/eligibility/'],
    unfcuApply: ['UNFCU 申请材料', 'https://www.unfcu.org/help/apply-UNFCU-membership/'],
    unfcuChecking: ['UNFCU Checking 账户收费', 'https://www.unfcu.org/checking/'],
    unausa: ['UNA-USA 入会资格及会费', 'https://unausa.org/join/membership-faqs/'],
    hsbcSG: ['新加坡汇丰国际开户', 'https://www.hsbc.com.sg/international/open-an-account/'],
    scSG: ['新加坡渣打国际银行服务', 'https://www.sc.com/sg/international-banking/'],
    scCN: ['渣打中国跨境开户服务', 'https://www.sc.com/cn/en/international-banking-new/'],
    xapo: ['Xapo 地区限制、会员费用及借记卡', 'https://www.xapobank.com/en/help/faq/company-and-membership'],
    ibkr: ['IBKR Karta 支持国籍与门槛', 'https://us1.interactivebrokers.com/en/accounts/karta-visa-infinite.php'],
    ifast: ['iFAST 英国借记卡资格', 'https://www.ifastgb.com/en/service/debit-card'],
    ocbc: ['OCBC 外国护照开户条件', 'https://www.ocbc.com/personal-banking/digital-banking/sg-bank-account'],
    expat: ['HSBC Expat 资格检查流程', 'https://www.expat.hsbc.com/apply-expat/'],
    lloyds: ['Lloyds International 资格检查器', 'https://www.lloydsbank.com/international/international-eligibility-checker.html'],
    revolut: ['Revolut 申请资格', 'https://help.revolut.com/en-US/help/profile-and-plan/getting-started-with-revolut/'],
    n26: ['N26 开户国家范围', 'https://support.n26.com/en-eu/account-and-personal-details/opening-an-account/can-i-open-an-n26-account-in-my-country'],
    bunq: ['bunq 从欧洲经济区外申请', 'https://help.bunq.com/articles/sign-up-for-bunq-from-outside-the-eea'],
    monzo: ['Monzo UK 开户要求', 'https://monzo.com/help/opening-an-account/how-to-open-a-Monzo-Personal-Account'],
    chime: ['Chime 开户材料', 'https://help.chime.com/how-do-i-open-a-chime-account-bafa327e'],
    mercury: ['Mercury Personal 申请资格', 'https://support.mercury.com/hc/en-us/articles/30467047130516-Eligibility-for-Mercury-Personal'],
    grabrfi: ['GrabrFi 支持国家', 'https://help.grabrfi.com/en/content/in-which-countries-can-i-open-a-grabrfi-account'],
    grabrfiID: ['GrabrFi 开户材料', 'https://help.grabrfi.com/en/content/requirements-to-open-a-grabrfi-account'],
    utoppia: ['Utoppia 美元账户资格', 'https://www.utoppia.com/faqs-categories/usd-account'],
    facebank: ['Facebank 美元账户申请地区', 'https://tucuentadolar.facebank.pr/es-cuenta-en-dolares/'],
    boa: ['Bank of America 国际客户开户', 'https://info.bankofamerica.com/en/international/professional-bank-account?subcategoryid=25'],
    chase: ['Chase 材料与分行要求', 'https://account.chase.com/consumer/banking/secure/college-offer'],
    paysera: ['Paysera Visa 居民资格', 'https://www.paysera.com/v2/en-DZ/payment-card-visa'],
    zen: ['ZEN Personal 支持证件国家', 'https://ask.zen.com/hc/en-us/articles/10955956082076-Where-can-I-open-a-ZEN-Personal-account'],
    swissquote: ['Swissquote 实体及虚拟卡 FAQ', 'https://www.swissquote.com/en-ch/private/help/bank/debit-cards'],
    payoneer: ['Payoneer 商业卡资格', 'https://www.payoneer.com/zh-hans/commercial-card/'],
    redotpay: ['RedotPay 不支持的国家与地区', 'https://helpcenter.redotpay.com/en/articles/10339263-unsupported-countries-regions'],
    adro: ['Adro 个人开户材料', 'https://help.joinadro.com/en/articles/9541534-opening-a-personal-account'],
    adroCard: ['Adro 卡片启用及实体卡要求', 'https://help.joinadro.com/en/articles/9541511-ordering-a-physical-card'],
    zenus: ['Zenus 当前官网', 'https://zenus.com/'],
    kast: ['KAST 服务条款', 'https://www.kast.xyz/en/legal/terms-and-conditions-of-service'],
    cim: ['CIM Banque 远程开户入口', 'https://mycim.cimbanque.com/en/open'],
    standard: ['Standard Bank Offshore 国际银行账户', 'https://international.standardbank.com/international/personal/products-and-services/bank/international-bank-accounts'],
    caye: ['Caye International Bank 开户资料', 'https://www.cayebank.bz/account-opening/'],
    citiSG: ['Citi IPB 新加坡申请条件', 'https://www.ipb.citibank.com.sg/chinese/forms/chinese/open-an-IPB-account/open-an-ipb-account.htm']
  };
  const fee = (status, text, note = '', amount = null, currency = null) => ({ status, text, note, amount, currency });
  const free = (note = '') => fee('free', '0', note, 0);
  const unknown = (note = '尚缺该产品适用的明确费表') => fee('unknown', '未核实', note);
  const paid = (amount, currency, note = '') => fee('paid', amount.toLocaleString('en-US') + ' ' + currency, note, amount, currency);
  const waived = (amount, currency, note) => ({ ...paid(amount, currency, note), status: 'waivable' });
  const included = text => fee('included', text, '无需为此项另行支付费用');
  const rows = [];
  function add(r) {
    rows.push({ rank: rows.length + 1, reviewedAt, network: '', format: [], cardType: 'unknown', type: 'bank', status: 'unverified', mode: 'unknown',
      requirements: [], delivery: '寄送及启用条件尚未核实', notes: [], ...r,
      fees: { opening: unknown(), issuance: unknown(), annual: unknown(), monthly: unknown(), ...r.fees },
      capital: { status: 'unknown', text: '资金要求未核实', ...r.capital }
    });
  }
  add({ id:'hsbc-one', name:'汇丰 One · Mastercard 扣账卡', institution:'香港汇丰', region:'香港', type:'bank', status:'priority', mode:'remote', format:['physical'], network:'Mastercard', logo:'hsbc.png',
    reason:'已有综合账户即可加办', condition:'须持有已启用的香港汇丰综合理财账户',
    fees:{ opening:included('无需新开户'), issuance:free('所有综合理财账户持有人可免费申请'), annual:free('Mastercard扣账卡FAQ明确零年费。'), monthly:waived(100,'HKD','2026-01-01起开立的非香港身份证One账户，近3个月平均关系余额达10,000 HKD可免；此前账户按原条款。') },
    capital:{ status:'conditional',text:'已有 One；免月费条件另计',amount:10000,currency:'HKD',note:'10,000 HKD是部分One账户的管理费豁免条件，并非加办扣账卡的最低资金。' },
    requirements:['已有香港汇丰综合理财账户，包括 One','账户资料及有效通讯地址保持更新'],
    delivery:'官方支持海外地址寄送；收到卡后可通过HSBC HK App或电话启用，无须为该卡赴香港。',
    notes:['每个综合账户最多关联一张Mastercard主卡。','免费开卡及零年费不代表所有账户管理费、ATM费或其他服务均免费。'],
    sources:['hsbcHK','hsbcHKFAQ','hsbcHKFees','hsbcOne'] });
  add({ id:'firstrade',name:'Firstrade CMA · Visa 借记卡',institution:'Firstrade / UMB Bank',region:'美国',type:'broker',status:'priority',mode:'remote',format:['physical'],network:'Visa',logo:'firstrade.png',
    reason:'已有券商账户可加办，国际申请路径明确',condition:'账户净资产至少25,000 USD',
    fees:{ opening:free('CMA产品页明确No Setup Fee；在现有券商账户上申请。'),issuance:free('CMA产品页明确Free ATM/Debit Card。'),annual:free('CMA年费为0；境外消费另收费') },capital:{status:'required',text:'25,000 USD 净资产',amount:25000,currency:'USD',note:'账户净资产门槛，不是要求全部持有现金。'},
    requirements:['持有Firstrade个人国际账户','账户净资产达到25,000 USD'],delivery:'提供国际账户申请表及国际寄送；初次国内和国际加急寄送费豁免。',
    notes:['2026年5月帮助页要求25,000 USD；不沿用旧申请PDF的100 USD条件。','境外消费手续费3%；符合资产要求时，每月第一笔境外消费的该手续费可返还。','申请入口：Accounts → Profile → Other Account Features → Firstrade Cash Management Account → Apply。'],sources:['firstrade','firstradeFees','firstradeProduct'] });
  add({ id:'schwab',name:'Schwab One International · Visa',institution:'嘉信国际 / BNY Mellon',region:'美国',type:'broker',status:'priority',mode:'remote',format:['physical'],network:'Visa',logo:'schwab.png',
    reason:'中国居民可在线申请国际账户及配套卡',condition:'卡片另行审核；大陆具体收件地址需确认',fees:{opening:free('国际账户产品说明无开户费。'),monthly:free('无账户维护费；交易及其他服务费用另计。')},capital:{status:'none',text:'开户最低 0 USD',amount:0,currency:'USD',note:'开户最低资金为0，不等于借记卡自动获批。'},
    requirements:['护照或合资格身份证件、近期住址证明','本国税号或ITIN、职业及税务资料','申请Schwab One International及配套卡'],delivery:'卡片可申请邮寄；中国具体邮寄地址与启用要求须在申请中确认。',
    notes:['2026-10协议及选择China后的个人开户入口均显示最低开户金额0 USD。','此处是国际券商账户配套Visa，不是美国本地Schwab Bank Investor Checking。'],sources:['schwab','schwabAgreement','schwabFees'] });
  add({ id:'velo',name:'Velo Global Checking · Visa',institution:'East West Bank 华美银行',region:'美国',type:'bank',status:'priority',mode:'remote',format:['physical'],network:'Visa',
    reason:'中国护照远程美国银行开户路径明确',condition:'首次入金至少25,000 USD；开户费较高',
    fees:{opening:paid(300,'USD','初次入金后扣除；Velo Gold退款另有条件。'),monthly:waived(25,'USD','Global Checking月平均余额达25,000 USD，或合资格存款账户合计余额符合50,000 USD标准可免。')},
    capital:{status:'required',text:'首次入金 25,000 USD',amount:25000,currency:'USD',note:'扣除300 USD开户费后，仍需满足相应平均余额才能免月费。'},requirements:['中国护照、身份证及身份核验','按银行要求提交地址、税务和资金来源资料','按期限完成最低首次入金'],delivery:'大陆可走官网网上银行申请；Visa实体卡寄送可能另收费，以申请支持地址为准。',notes:['美国银行存款账户，适用FDIC保障。','App与网页的可开户地区存在差异，优先使用官网指向的适用入口。'],sources:['velo','veloFees'] });
  add({id:'hsbc-us',name:'HSBC US Premier · 借记卡',institution:'美国汇丰',region:'美国',type:'bank',status:'priority',mode:'remote',format:['physical'],logo:'hsbc.png',
    reason:'人在中国可申请，支持无SSN税务声明路径',condition:'Premier资金或收入要求；不达标可能关户',fees:{monthly:waived(50,'USD','常见标准为100,000 USD合资格关系余额或每月5,000 USD合资格直接存款等。')},
    capital:{status:'alternative',text:'100,000 USD 或合资格收入',amount:100000,currency:'USD',note:'也可满足每月5,000 USD合资格直接存款等条件，不能把普通自行转账直接视为工资入账。'},requirements:['有效护照、永久住址、职业及收入资料','SSN或完成有效税务声明','满足Premier维持条件；香港One不等同Premier'],delivery:'官方列中国为可在线申请的所在地；卡片寄送及具体地址按开户审核结果办理。',
    notes:['开户当月及随后3个自然月免月费；紧接豁免期后不达标且连续收取3次月费，账户将被关闭。','关联支票、储蓄、信用卡及Global Money账户也可能关闭，除非另有符合条款的Premier关系。'],sources:['hsbcUS','hsbcUSFees']});
  add({id:'fv-bank',name:'FV Bank · Visa Debit',institution:'FV Bank',region:'波多黎各',type:'bank',status:'priority',mode:'remote',format:['physical'],network:'Visa',reason:'官方China资格检查支持银行账户及Visa',condition:'不受FDIC保障；中国具体寄卡地址待确认',
    fees:{opening:paid(25,'USD'),issuance:paid(50,'USD','非美国居民实体卡费表。'),annual:paid(100,'USD','非美国居民卡片年维护费。'),monthly:{...paid(25,'USD','官方目前豁免，未承诺永久免费。'),status:'temporary',text:'25 USD · 目前暂免'}},
    capital:{status:'none',text:'无最低余额要求',amount:0,currency:'USD'},requirements:['护照及身份、地址核验','税务、职业及资金来源资料'],delivery:'国家检查器选择China后，美元账户与Visa均显示支持；具体收件地址须在申请时确认。',notes:['波多黎各银行，不受FDIC存款保险保障。','境外换汇交易费2.99%；ACH、电汇、休眠等费用另计。'],sources:['fv','fvFees','fvCard','fvMinimum']});
  add({id:'wise-digital',name:'Wise 美国 · 数字卡',institution:'Wise',region:'美国',type:'payment',status:'conditional',mode:'remote',format:['virtual'],logo:'wise.png',reason:'美国区已支持数字卡，存在无SSN路径',condition:'可能要求美国居留文件；地址账单不能替代',
    fees:{issuance:free('美国个人数字卡产品页列为免费。'),annual:free('数字卡本身免费；账户换汇及转账另收费。')},requirements:['外国身份证件及本人美国真实居住地址证明','如触发居留审核，需美国签发的合资格居留文件'],delivery:'完成数字卡申请后即可使用；数字卡资格仍取决于美国区账户及身份审核。',
    notes:['近期银行或信用卡账单可用于地址审核；无SSN并非必定不能申请。','合法居留审核与地址审核分开；旅游签、过境签及账单不能代替要求的居留文件。','大陆或香港地址不在Wise发卡地区内。'],sources:['wiseUS','wiseAddress','wiseResidence','wiseDigital','wiseDigitalFee']});
  add({id:'freedom',name:'Freedom Bank · eResidency 卡',institution:'Freedom Bank',region:'哈萨克斯坦',type:'bank',status:'conditional',mode:'remote',format:['physical','virtual'],network:'Visa / Mastercard',reason:'正式电子居民项目支持远程开卡',condition:'先办eResidency；银行仍独立审核',
    fees:{opening:fee('conflict','49 USD / 120 USD','银行页面列一次性49 USD项目服务费；政府中文FAQ仍列120 USD/年，渠道费用未统一，不是已核实的银行开户费。'),annual:fee('conflict','项目续费口径冲突','电子居民项目费与银行卡年费分开；支付前核对渠道和所选卡种。')},requirements:['带NFC芯片的有效生物识别护照','支持NFC及所需eSIM流程的手机','先完成eResidency，取得项目IIN并接受银行审核'],delivery:'虚拟卡可线上办理；实体卡国际寄送地区及费用以App为准，未沿用已过期免邮活动。',notes:['电子居民身份不是签证、居留许可或税务居民身份，也不能用它替代Wise居留证明。','电子居民项目费用不自动包含银行开户、发卡及快递费用。'],sources:['freedom','eResidency']});
  add({id:'unfcu',name:'UNFCU · Visa 借记卡',institution:'联合国联邦信用社',region:'美国',type:'credit-union',status:'conditional',mode:'remote',format:['physical'],network:'Visa',reason:'合资格会员可远程申请，非美纳税人可填本国税号',condition:'须先满足会员资格；美国账单不等于入会资格',fees:{monthly:free('Checking无月维护费；纸质账单等服务另计。'),annual:{...paid(50,'USD','此为UNA-USA常规会员年费，不是已核实的UNFCU卡年费；仅适用于该入会路线。'),text:'50 USD 会员费'},},capital:{status:'required',text:'25 USD 会员股金',amount:25,currency:'USD',note:'会员股金是保留资金，不是手续费。'},requirements:['满足UNFCU会员资格，例如合资格UNA-USA会员','UNA-USA路径须符合其美国居民／公民及地址条件','身份证件、地址、对应税务资料及会员股金'],delivery:'可向国际地址寄卡；实际卡片及地址由会员审核决定。',notes:['不能仅购买协会会员资格就推断任何大陆申请人均可开UNFCU。'],sources:['unfcu','unfcuApply','unfcuChecking','unausa']});
  add({id:'hsbc-sg',name:'HSBC Singapore Premier',institution:'新加坡汇丰',region:'新加坡',type:'bank',status:'conditional',mode:'witness',format:['physical'],logo:'hsbc.png',reason:'国际客户远程及转介渠道',condition:'财富门槛及中国来源客户渠道需审核',capital:{status:'required',text:'通常 200,000 SGD',amount:200000,currency:'SGD',note:'Premier关系余额；境外客户接受条件需国际业务确认。'},requirements:['护照、地址及税务材料','满足Premier关系余额与客户审核','可能需要中国境内见证或国际业务转介'],delivery:'国际客户可申请远程服务；具体中国来源流程及寄卡需经理确认。',notes:['香港One不会自动带来全球Premier资格。'],sources:['hsbcSG']});
  add({id:'sc-sg',name:'Standard Chartered 国际账户',institution:'新加坡渣打',region:'新加坡',type:'bank',status:'conditional',mode:'witness',format:['physical'],logo:'sc.png',reason:'官方提供国际开户及境内见证渠道',condition:'国际／财富客户资格和资金门槛需确认',requirements:['有效身份证件、地址、税务及资金来源材料','满足国际业务接受条件','可能需在中国境内完成见证'],delivery:'有远程及中国境内协助渠道；不是仅凭护照和账单自动获批。',notes:['普通优先理财标准、国际客户活动门槛和实际开户资格不得混为同一个金额。'],sources:['scSG','scCN']});
  add({id:'velo-secured',name:'Velo · Secured Credit Card',institution:'East West Bank 华美银行',region:'美国',type:'bank',status:'conditional',mode:'remote',format:['physical'],network:'Visa',cardType:'secured-credit',reason:'银行账户开立后的无SSN担保信用卡路径',condition:'先开Velo账户，再提供担保存款并接受授信审核',fees:{annual:free('无年费；银行账户费用单独计算。')},capital:{status:'required',text:'账户门槛 + 等额担保',amount:25000,currency:'USD',note:'Global Checking首次入金门槛之外，信用额度以所需担保存款及审批为准；不将保证金算为费用。'},requirements:['已有合资格Velo银行账户','按信用额度提供担保存款','完成信用卡独立审核'],delivery:'具体寄卡地址及启用按信用卡申请结果。',notes:['无SSN或既有美国信用记录也有申请路径。','信用卡无年费不代表Velo银行账户无开户费或月费。'],sources:['veloCredit','veloFees']});
  add({id:'payoneer',name:'Payoneer · 商业卡',institution:'派安盈',region:'多地区',type:'payment',status:'conditional',mode:'remote',format:['physical','virtual'],reason:'面向真实商业收款客户的卡片路径',condition:'需要合资格商业收款，个人银行账单不足以证明资格',requirements:['真实商业收款场景及Payoneer账户','满足账户显示的卡片资格和合资格收款条件'],delivery:'卡片形态、寄送地区与收费取决于账户和发卡项目。',notes:['不作为普通个人储蓄银行账户的替代。'],sources:['payoneer']});
  add({id:'dukascopy',name:'Dukascopy · 合作银行卡',institution:'杜高斯贝银行',region:'瑞士',type:'bank',status:'unverified',mode:'remote',format:['physical','virtual'],network:'Visa / Mastercard 等',reason:'可远程视频开户，公开列有多个合作发卡商',condition:'缺大陆居民可选卡种及寄送对应表',requirements:['有效护照与视频核验','如实申报实际居住地、税务及资金来源'],delivery:'官网宣传全球卡片服务，但大陆账户具体可选发卡商及收件国家需登录后确认。',notes:['不要把旧EEA限定攻略套到所有新合作卡，也不能把全球营销文字当成大陆每款卡都可办。','美国居民受限制；不同发卡商的制卡、月费及汇兑费不同。'],sources:['dukascopy','dukascopyCards','dukascopyFees']});
  add({id:'xapo',name:'Xapo Bank · 金属借记卡',institution:'Xapo Bank',region:'直布罗陀',type:'bank',status:'unverified',mode:'remote',format:['physical'],reason:'支持线上开户，公开禁止居住地名单未列中国',condition:'缺中国实际接受及寄送确认；美国居民不支持',fees:{annual:paid(1000,'USD','银行会员年费，包含卡片及相关服务。'),issuance:included('包含于会员费')},requirements:['受支持司法管辖区居民','身份证明、住址与合规审核','承担年度会员费'],delivery:'会员包含金属卡；中国收件地址仍需App核实。',notes:['禁止名单没有中国，不能独立证明所有中国申请人都会被接受。'],sources:['xapo']});
  add({id:'rbk',name:'Bank RBK · eResidency',institution:'Bank RBK',region:'哈萨克斯坦',type:'bank',status:'unverified',mode:'remote',reason:'政府中文FAQ列为电子居民合作银行',condition:'缺当前实际接入、卡种及费用证据',requirements:['先取得合资格电子居民身份','通过银行独立核验'],notes:['不同语言页面的合作银行名单存在更新差异，不能将Freedom卡片规则套用。'],sources:['eResidency']});
  add({id:'swissquote-virtual',name:'Swissquote · 虚拟卡',institution:'瑞讯银行',region:'瑞士',type:'bank',status:'unverified',mode:'remote',format:['virtual'],reason:'公开产品提供虚拟卡',condition:'缺中国居民虚拟卡资格确认',notes:['实体卡支持名单与虚拟卡资格分开核验。'],sources:['swissquote']});
  [
    ['zenus','Zenus · 个人账户','波多黎各','bank','当前个人零售开户是否开放、是否接受大陆申请人尚未确认','zenus'],
    ['kast','KAST · 支付卡','多地区','payment','公开条款未确认中国大陆具体开户及发卡资格','kast'],
    ['cim','CIM Banque · 银行卡','瑞士','bank','缺大陆申请人的远程开户、发卡及启用完整证据','cim'],
    ['standard-offshore','Standard Bank Offshore','离岸多地区','bank','远程入口存在，但缺中国居民发卡及完整材料要求','standard'],
    ['caye','Caye International Bank','伯利兹','bank','缺中国居民远程开户及配套卡的明确接受条件','caye'],
    ['bereke','Bereke · eResidency','哈萨克斯坦','bank','仅找到预计开放信息，缺已上线远程发卡证据','eResidency']
  ].forEach(([id,name,region,type,condition,source])=>add({id,name,institution:name,region,type,condition,reason:'保留待核实候选',sources:[source]}));
  function blocked(id,name,region,condition,source,extra={}) { add({id,name,institution:name,region,status:'ineligible',condition,reason:'当前研究基线不满足公开条件',sources:Array.isArray(source)?source:[source],...extra}); }
  blocked('wise-physical','Wise 美国 · 实体卡','美国','官方要求人在美国启用，当前人在大陆不能完成','wiseUS',{type:'payment',mode:'onsite',format:['physical'],logo:'wise.png',fees:{issuance:paid(10,'USD','美国帮助页列10 USD；最终以下单报价为准。')},notes:['仍需满足美国地址及可能的居留核验；不能用VPN替代官方要求的实际所在地。'],sources:['wiseUS','wiseResidence']});
  blocked('ibkr-karta','IBKR Karta Visa Infinite','美国','支持国籍名单不包含中国','ibkr',{type:'broker',mode:'remote',format:['physical'],network:'Visa',logo:'ibkr.png',fees:{annual:paid(300,'USD')},capital:{status:'required',text:'50,000 USD资产 + 25,000可取',amount:50000,currency:'USD'},notes:['门槛和美国住址不能消除中国国籍不在支持名单的限制。']});
  blocked('ifast','iFAST Global Bank · 借记卡','英国','卡片仅向英国居民提供；账户资格不等于卡片资格','ifast',{mode:'remote',format:['physical','virtual']});
  blocked('ocbc','OCBC · 外国护照开户','新加坡','还需赴新加坡工作、学习或生活证明','ocbc',{mode:'remote',format:['physical'],capital:{status:'required',text:'首次入金 3,000 SGD',amount:3000,currency:'SGD'},notes:['例如工作邀请、录取、IPA、准证或合资格租约等；不沿用仅护照即可的旧攻略。']});
  blocked('hsbc-expat','HSBC Expat','泽西岛','资格检查器选择中国居住地未通过','expat',{mode:'remote',format:['physical'],logo:'hsbc.png',notes:['本次核验的是中国实际居住地路径；下拉列表出现China不代表符合资格。']});
  blocked('lloyds','Lloyds International','离岸多地区','官方检查器中中国及美国居住地均未通过','lloyds',{mode:'remote',format:['physical']});
  blocked('revolut','Revolut','多地区','需要受支持国家的合法居住资格','revolut',{type:'payment',mode:'remote',format:['physical','virtual']});
  blocked('n26','N26','欧洲经济区','需要受支持欧洲国家的居住条件','n26',{mode:'remote',format:['physical','virtual']});
  blocked('bunq','bunq','欧洲经济区','境外可开始申请，仍需满足欧洲经济区居民条件','bunq',{mode:'remote',format:['physical','virtual']});
  blocked('monzo','Monzo UK','英国','需要英国实际居民及合法居留条件','monzo',{mode:'remote',format:['physical']});
  blocked('chime','Chime','美国','公开申请流程要求有效SSN及美国居民材料','chime',{type:'payment',mode:'remote',format:['physical']});
  blocked('mercury','Mercury Personal','美国','要求SSN、美国地址和电话，ITIN也不能替代SSN','mercury',{type:'payment',mode:'remote',format:['physical','virtual']});
  blocked('grabrfi','GrabrFi','美国','大陆不在支持范围；美国路径要求SSN',['grabrfi','grabrfiID'],{type:'payment',mode:'remote',format:['physical','virtual']});
  blocked('utoppia','Utoppia','美国','公开线上路径的国籍／居住地范围不匹配','utoppia',{type:'payment',mode:'remote'});
  blocked('facebank','Facebank · 线上美元账户','波多黎各','常见线上路径接受国家名单未包含中国','facebank',{mode:'remote'});
  blocked('boa','Bank of America · 常规账户','美国','相关非居民路径需要赴美国分行核验','boa',{mode:'onsite',format:['physical']});
  blocked('chase','Chase · 常规账户','美国','无SSN的相应路径需要到美国分行办理','chase',{mode:'onsite',format:['physical']});
  blocked('paysera','Paysera Visa','欧洲经济区','卡片要求欧洲经济区居民','paysera',{type:'payment',mode:'remote',format:['physical']});
  blocked('zen-personal','ZEN Personal','欧洲经济区','公开可接受护照国家名单未包含中国','zen',{type:'payment',mode:'remote',format:['physical','virtual']});
  blocked('swissquote-physical','Swissquote · 实体卡','瑞士','实体卡支持居住国家名单未包含中国','swissquote',{mode:'remote',format:['physical']});
  blocked('redotpay','RedotPay','多地区','现行限制包含中国大陆相关身份／居住地及美国','redotpay',{type:'payment',mode:'remote',format:['physical','virtual']});
  blocked('adro','Adro','美国','需学生／签证等资格，卡片启用涉及到达美国',['adro','adroCard'],{type:'payment',mode:'onsite',format:['physical','virtual']});
  blocked('citi-ipb','Citi IPB Singapore','新加坡','公开申请页仍包含赴新加坡办理条件','citiSG',{mode:'onsite',format:['physical'],capital:{status:'required',text:'200,000 USD',amount:200000,currency:'USD'}});
  const debitIds = new Set(['hsbc-one','firstrade','schwab','velo','hsbc-us','fv-bank','wise-digital','wise-physical','freedom','unfcu','xapo','ifast','paysera']);
  rows.forEach(r=>{ if (debitIds.has(r.id)) r.cardType='debit'; if (r.id==='ibkr-karta') r.cardType='charge'; });
  return { schemaVersion:1, reviewedAt,
    scope:'中国大陆护照 · 未提供境外居留身份或SSN/ITIN · 目前在大陆',
    methodology:[
      '优先级按已有账户加办便利性、官方远程申请证据、资金及持续费用综合排序；是研究判断，不是获批概率。',
      '“优先办理”仍须满足行内所列账户、资产及审核条件；“补充条件”需另有居留、会员、资金或业务资格。',
      '开户费、首次开卡费、年费／会员费、月费分别筛选。费用已包含不代表该产品整体免费；暂免不视为永久免费。',
      '未知收费不记为0；资金、保证金及会员股金不记为手续费。费用排序只按收费状态，金额保留原币，不跨币种直接比较。',
      '美国地址证明、居留资格及税务身份分别核验；VPN不改变身份和实际所在地要求。',
      '研究核验日不是账户实时状态；尚未用个人身份提交开户申请。账户获批、发卡、邮寄和启用是不同环节。'
    ], sources:Object.fromEntries(Object.entries(sources).map(([id,[label,url]])=>[id,{label,url}])), rows };
});
