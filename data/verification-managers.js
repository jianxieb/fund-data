var VERIFICATION_MANAGERS={
  "schemaVersion": 1,
  "checkedAt": "2026-09-21T15:36:49+00:00",
  "scope": "FUNDS经理、任职起点及字段覆盖；EXTRA记录的是整改前覆盖，不冒充已逐项核验。",
  "initialCoverage": {
    "FUNDS": {
      "records": 46,
      "managerNames": 0,
      "individualStarts": 0,
      "scaleAndDate": 46,
      "navAndDate": 46,
      "ongoingFeeArray": 46,
      "exchangeEtfs": 20,
      "otcWithBuyRedeem": 26
    },
    "EXTRA": {
      "records": 1268,
      "managerNames": 1268,
      "legacyTeamStartAndTenure": 1266,
      "scaleValue": 1268,
      "scaleDate": 0,
      "navAndDate": 1268,
      "exchangeEtfs": 48,
      "otherWithBuyRedeem": 1220
    }
  },
  "result": {
    "funds": 46,
    "managerNames": 46,
    "individuals": 55,
    "individualsWithExplicitStart": 55,
    "multipleManagerFunds": 9,
    "differentStartFunds": 7,
    "nonManagerFieldChangesInPatch": 0,
    "extraBlockChangedByManagerPatch": false
  },
  "independentAppointmentChecks": [
    {
      "code": "050025",
      "name": "万琼",
      "start": "2015-10-08",
      "sourceUrl": "https://www.psbc.com/cn/grfw/tzlc/jj/jjcpgg/202109/t20210928_127185.html",
      "sourceType": "销售银行披露的基金公司产品资料概要",
      "comparison": "pass",
      "scope": "核对个人任职起点；旧公告不能单独证明当前仍在任，现任名单观察日另列。"
    },
    {
      "code": "160213",
      "name": "朱丹",
      "start": "2022-01-27",
      "sourceUrl": "https://st.gtfund.com/report/2022/01/国泰纳斯达克100指数证券投资基金基金经理变更公告.pdf",
      "sourceType": "基金公司经理变更公告",
      "comparison": "pass",
      "scope": "核对个人任职起点；旧公告不能单独证明当前仍在任，现任名单观察日另列。"
    },
    {
      "code": "539001",
      "name": "朱金钰",
      "start": "2021-09-22",
      "sourceUrl": "https://www.ccbfund.cn/u/cms/jx/brief/012752.pdf",
      "sourceType": "基金公司同主代码的C类产品资料概要",
      "comparison": "pass",
      "scope": "核对个人任职起点；旧公告不能单独证明当前仍在任，现任名单观察日另列。"
    }
  ],
  "funds": [
    {
      "code": "050025",
      "name": "博时标普500ETF联接A",
      "managerRecords": [
        {
          "name": "万琼",
          "start": "2015-10-08",
          "end": null,
          "tenureYears": 10.954365934961018,
          "tenureText": "10年348天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.225544+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_050025.html",
      "sourceSha256": "4153a7d368ad4f46a1dbc3c29dfdca459e700d1a9a6e7cbbba5b82cd14967982",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "161125",
      "name": "易方达标普500指数人民币A",
      "managerRecords": [
        {
          "name": "刘依姗",
          "start": "2025-04-11",
          "end": null,
          "tenureYears": 1.445614899689932,
          "tenureText": "1年163天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.174168+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_161125.html",
      "sourceSha256": "34768339b0e1e186846bdb2380dce98f79e04167f738cc598b219d2c7eb064dd",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "018064",
      "name": "华夏标普500ETF联接A",
      "managerRecords": [
        {
          "name": "赵宗庭",
          "start": "2023-05-10",
          "end": null,
          "tenureYears": 3.367625618595864,
          "tenureText": "3年134天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.203410+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_018064.html",
      "sourceSha256": "76d6fbab6a3433a25fb4f02e6071e981c82bc18be22cb99cbf3de7d9576ebbd3",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "096001",
      "name": "大成标普500等权重A",
      "managerRecords": [
        {
          "name": "冉凌浩",
          "start": "2011-08-26",
          "end": null,
          "tenureYears": 15.072178073471735,
          "tenureText": "15年26天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.240753+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_096001.html",
      "sourceSha256": "071686cb86e9112d22ba326c1917b8778bdd469ad4c83f3c67febd883c32fe2e",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "017641",
      "name": "摩根标普500指数人民币A",
      "managerRecords": [
        {
          "name": "张军",
          "start": "2023-04-06",
          "end": null,
          "tenureYears": 3.4607144568334736,
          "tenureText": "3年168天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.455003+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_017641.html",
      "sourceSha256": "5a2d1c4f8e9aa20f410864dc0380886283df9b0c2d149df360ccb5e8dd231892",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "007721",
      "name": "天弘标普500发起(QDII-FOF)A",
      "managerRecords": [
        {
          "name": "胡超",
          "start": "2019-09-24",
          "end": null,
          "tenureYears": 6.992614495848648,
          "tenureText": "6年362天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.417116+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_007721.html",
      "sourceSha256": "dc390fb12e6ebe8a01251bbbcbae747f148d6017adf810e21a5e9bfa9e7fe99c",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "513500",
      "name": "标普500ETF博时",
      "managerRecords": [
        {
          "name": "万琼",
          "start": "2015-10-08",
          "end": null,
          "tenureYears": 10.954365934961018,
          "tenureText": "10年348天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.469274+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_513500.html",
      "sourceSha256": "613a92ac3b6c76b8030f05b9602e2f67e467d048edac26d6831b677215f7cbfc",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159655",
      "name": "标普500ETF华夏",
      "managerRecords": [
        {
          "name": "赵宗庭",
          "start": "2022-10-12",
          "end": null,
          "tenureYears": 3.942586090063451,
          "tenureText": "3年344天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.492293+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159655.html",
      "sourceSha256": "e71d0b6a6229c7b790540e74d47caf5fb8beb90c180de9044228c3398cbaf94d",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159612",
      "name": "标普500ETF国泰",
      "managerRecords": [
        {
          "name": "艾小军",
          "start": "2023-05-23",
          "end": null,
          "tenureYears": 3.3320328275050137,
          "tenureText": "3年121天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.646573+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159612.html",
      "sourceSha256": "66593098559ae95026221899a74af4b37adf98cd95d8c287f1699fe69014322c",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "513650",
      "name": "标普500ETF南方",
      "managerRecords": [
        {
          "name": "张其思",
          "start": "2025-03-07",
          "end": null,
          "tenureYears": 1.5414416449345298,
          "tenureText": "1年198天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.648008+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_513650.html",
      "sourceSha256": "56fe58604271d2996a82f521d54a4b2b100f05852f5ca55fb647a581663458f3",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "160213",
      "name": "国泰纳斯达克100指数",
      "managerRecords": [
        {
          "name": "朱丹",
          "start": "2022-01-27",
          "end": null,
          "tenureYears": 4.648966097866486,
          "tenureText": "4年237天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.671789+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_160213.html",
      "sourceSha256": "e62dbf51f86ecf5c3a5e1053ca04f2da6a9ad71bdf4bd6a7589bd403f304accf",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "270042",
      "name": "广发纳斯达克100ETF联接A",
      "managerRecords": [
        {
          "name": "刘杰",
          "start": "2018-08-06",
          "end": null,
          "tenureYears": 8.12610799674189,
          "tenureText": "8年46天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.705563+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_270042.html",
      "sourceSha256": "5ade21b9cf6a6d6e184025f3b1a0b1c07cdeaeec42ab14b551e861033ac877ea",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "040046",
      "name": "华安纳斯达克100ETF联接A",
      "managerRecords": [
        {
          "name": "倪斌",
          "start": "2018-09-10",
          "end": null,
          "tenureYears": 8.030281251497293,
          "tenureText": "8年11天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:14.929242+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_040046.html",
      "sourceSha256": "162b9e8a3470d1d3f613ce43311e5e0fba0e8028f9e4c059513c95c503a6e3bd",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "000834",
      "name": "大成纳斯达克100ETF联接A",
      "managerRecords": [
        {
          "name": "冉凌浩",
          "start": "2014-11-13",
          "end": null,
          "tenureYears": 11.855137340260239,
          "tenureText": "11年312天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.849559+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_000834.html",
      "sourceSha256": "942f8e6e93cdb8a06e30230e89c459903bd9e605372f1cc95590140c12a265dd",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "161130",
      "name": "易方达纳斯达克100人民币A",
      "managerRecords": [
        {
          "name": "伍臣东",
          "start": "2022-11-29",
          "end": null,
          "tenureYears": 3.8111665537280026,
          "tenureText": "3年296天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:13.928729+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_161130.html",
      "sourceSha256": "847a8100102bce9e593bd7475be4982de40c2d569354b0b0e4acdad51da1856b",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "539001",
      "name": "建信纳斯达克100指数A人民币",
      "managerRecords": [
        {
          "name": "朱金钰",
          "start": "2021-09-22",
          "end": null,
          "tenureYears": 4.996680287754026,
          "tenureText": "4年364天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:14.967086+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_539001.html",
      "sourceSha256": "4bc891553412b721ccd642c403447502e65fd9ae4f5d38eb30cd60d2c7ba85aa",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "015299",
      "name": "华夏纳斯达克100ETF联接A",
      "managerRecords": [
        {
          "name": "赵宗庭",
          "start": "2022-04-14",
          "end": null,
          "tenureYears": 4.438147258328371,
          "tenureText": "4年160天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:14.060603+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_015299.html",
      "sourceSha256": "2c45bb5569c24535e9d8f504a68da5ed31bf4daa439e8f3e69f2311e3fb3d62d",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "016055",
      "name": "博时纳斯达克100ETF联接A",
      "managerRecords": [
        {
          "name": "万琼",
          "start": "2022-07-26",
          "end": null,
          "tenureYears": 4.156142836608555,
          "tenureText": "4年57天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:14.142456+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_016055.html",
      "sourceSha256": "122d58ee6e69c932ecff501482f0150b529f1174eb08f73dda69b9d3eed1f54b",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "016532",
      "name": "嘉实纳斯达克100ETF联接A",
      "managerRecords": [
        {
          "name": "张钟玉",
          "start": "2022-09-15",
          "end": null,
          "tenureYears": 4.016509579252141,
          "tenureText": "4年6天"
        },
        {
          "name": "蒋一茜",
          "start": "2024-10-28",
          "end": null,
          "tenureYears": 1.8973695558430357,
          "tenureText": "1年328天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.341116+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_016532.html",
      "sourceSha256": "c9d9c24cbeab9875e67a069417ad90ef56f8be7115cf93096a9999390dfafb66",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "016452",
      "name": "南方纳斯达克100指数发起A",
      "managerRecords": [
        {
          "name": "张其思",
          "start": "2022-11-29",
          "end": null,
          "tenureYears": 3.8111665537280026,
          "tenureText": "3年296天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:14.378835+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_016452.html",
      "sourceSha256": "b022be83295cf1c84308c3db4162a5948f0f6ccf66d888cf34bf57d9d45b3030",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "018043",
      "name": "天弘纳斯达克100指数发起A",
      "managerRecords": [
        {
          "name": "LIU DONG(刘冬)",
          "start": "2023-04-11",
          "end": null,
          "tenureYears": 3.447024921798531,
          "tenureText": "3年163天"
        },
        {
          "name": "胡超",
          "start": "2023-04-11",
          "end": null,
          "tenureYears": 3.447024921798531,
          "tenureText": "3年163天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.646654+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_018043.html",
      "sourceSha256": "4e5ee9d8ea0152dfdccb62b8e2a486654f752148f4daf5de32c6a28bf26c5613",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "019172",
      "name": "摩根纳斯达克100指数人民币A",
      "managerRecords": [
        {
          "name": "何智豪",
          "start": "2025-10-22",
          "end": null,
          "tenureYears": 0.9144609403341616,
          "tenureText": "334天"
        },
        {
          "name": "徐寅",
          "start": "2026-08-21",
          "end": null,
          "tenureYears": 0.08487511721664373,
          "tenureText": "31天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.155017+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_019172.html",
      "sourceSha256": "56e58b1d030d154295b3e80021c095909a4efde67d6ffbda7408d6d74c72d5ea",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "019547",
      "name": "招商纳斯达克100ETF联接A",
      "managerRecords": [
        {
          "name": "刘重杰",
          "start": "2023-11-29",
          "end": null,
          "tenureYears": 2.811830496177197,
          "tenureText": "2年296天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.200048+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_019547.html",
      "sourceSha256": "aef1645dab0b2091d3265c39990e746945d7d4c8fcba6a5ca9f448bb590f9e4b",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "019524",
      "name": "华泰柏瑞纳斯达克100ETF联接A",
      "managerRecords": [
        {
          "name": "李沐阳",
          "start": "2023-10-19",
          "end": null,
          "tenureYears": 2.924084683463726,
          "tenureText": "2年337天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.435716+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_019524.html",
      "sourceSha256": "6123cf4a653924d912336dce783f6a0d74378658f53c25b44cfc032bc9ea552e",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "018966",
      "name": "汇添富纳斯达克100ETF联接A",
      "managerRecords": [
        {
          "name": "乐无穹",
          "start": "2026-08-12",
          "end": null,
          "tenureYears": 0.1095162802795403,
          "tenureText": "40天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.423381+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_018966.html",
      "sourceSha256": "482aaf684fcf9539bbab2c1f46861d2e95ecf9b60d8117483396e6c293f3361f",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "019441",
      "name": "万家纳斯达克100指数发起A",
      "managerRecords": [
        {
          "name": "杨坤",
          "start": "2023-09-27",
          "end": null,
          "tenureYears": 2.984318637617473,
          "tenureText": "2年359天"
        },
        {
          "name": "贺方舟",
          "start": "2026-07-06",
          "end": null,
          "tenureYears": 0.2108188395381151,
          "tenureText": "77天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.621601+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_019441.html",
      "sourceSha256": "313161af35f97f319f21388c813f3bb024ab12445ff1f840d7a7a03bc58105d9",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "017091",
      "name": "景顺长城纳斯达克科技ETF联接A",
      "managerRecords": [
        {
          "name": "汪洋",
          "start": "2022-12-09",
          "end": null,
          "tenureYears": 3.7837874836581173,
          "tenureText": "3年286天"
        },
        {
          "name": "张晓南",
          "start": "2023-02-10",
          "end": null,
          "tenureYears": 3.6112993422178414,
          "tenureText": "3年223天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.706342+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_017091.html",
      "sourceSha256": "42cb39a7914019652e432a72ee815a4a43559f3b56d24f9a1f3b4f55824c1839",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "017894",
      "name": "汇添富纳斯达克生物科技ETF联接A",
      "managerRecords": [
        {
          "name": "乐无穹",
          "start": "2026-08-12",
          "end": null,
          "tenureYears": 0.1095162802795403,
          "tenureText": "40天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.742557+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_017894.html",
      "sourceSha256": "e7c66caebed6fe07550669939a1f481cc7d684ef34046663ee74a12101fcec6b",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "017436",
      "name": "华宝纳斯达克精选A",
      "managerRecords": [
        {
          "name": "周晶",
          "start": "2023-03-02",
          "end": null,
          "tenureYears": 3.5565412020780713,
          "tenureText": "3年203天"
        },
        {
          "name": "赵启元",
          "start": "2023-08-05",
          "end": null,
          "tenureYears": 3.129427708987864,
          "tenureText": "3年47天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.868038+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_017436.html",
      "sourceSha256": "0413ed2ed226fc1828be8a7869730b075381a9b37058385e0781885ffcbe0144",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "513100",
      "name": "纳指ETF国泰",
      "managerRecords": [
        {
          "name": "艾小军",
          "start": "2023-05-10",
          "end": null,
          "tenureYears": 3.367625618595864,
          "tenureText": "3年134天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.860466+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_513100.html",
      "sourceSha256": "7a47a0c0227a63ab30814a73c50e901889b4e0882428fb6ecf3c4dc6c6a51bb0",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159941",
      "name": "纳指ETF广发",
      "managerRecords": [
        {
          "name": "刘杰",
          "start": "2018-08-06",
          "end": null,
          "tenureYears": 8.12610799674189,
          "tenureText": "8年46天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:15.928868+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159941.html",
      "sourceSha256": "63d3f963483e4cd0c685421defd2df0fcef11e121953d54d236b5b304eabe3c6",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "513300",
      "name": "纳斯达克ETF华夏",
      "managerRecords": [
        {
          "name": "赵宗庭",
          "start": "2020-10-22",
          "end": null,
          "tenureYears": 5.9138791350951765,
          "tenureText": "5年334天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:17.392116+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_513300.html",
      "sourceSha256": "21902bf85dfda63380021cb5c0984f775c40127fad6ae429c3c34de39dff5e03",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "513390",
      "name": "纳指100ETF博时",
      "managerRecords": [
        {
          "name": "万琼",
          "start": "2023-04-19",
          "end": null,
          "tenureYears": 3.425121665742623,
          "tenureText": "3年155天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:16.083505+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_513390.html",
      "sourceSha256": "d80e1b0b02e265bee9d26d725896f0e21afe581c777eb3a4e1bfa8a6e8185f13",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "513110",
      "name": "纳指ETF华泰柏瑞",
      "managerRecords": [
        {
          "name": "柳军",
          "start": "2023-03-01",
          "end": null,
          "tenureYears": 3.5592791090850597,
          "tenureText": "3年204天"
        },
        {
          "name": "李沐阳",
          "start": "2023-03-01",
          "end": null,
          "tenureYears": 3.5592791090850597,
          "tenureText": "3年204天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:16.102945+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_513110.html",
      "sourceSha256": "c37f02435c79fddfe4f7397919a1785c4dafb4c4794fbfa6e04c800f111d5a0d",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159660",
      "name": "纳指ETF汇添富",
      "managerRecords": [
        {
          "name": "乐无穹",
          "start": "2026-08-12",
          "end": null,
          "tenureYears": 0.1095162802795403,
          "tenureText": "40天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:16.246350+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159660.html",
      "sourceSha256": "03238a9e268a070bf551007e8f81c7146620b08d98a45cdbd19166d36624708f",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159501",
      "name": "纳指ETF嘉实",
      "managerRecords": [
        {
          "name": "张钟玉",
          "start": "2023-05-31",
          "end": null,
          "tenureYears": 3.3101295714491057,
          "tenureText": "3年113天"
        },
        {
          "name": "蒋一茜",
          "start": "2024-10-28",
          "end": null,
          "tenureYears": 1.8973695558430357,
          "tenureText": "1年328天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:16.280708+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159501.html",
      "sourceSha256": "7aa736dcd7f91af3556846dc43ea0cc126b5be7a499fc3d49b9d721827c807f0",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159659",
      "name": "纳斯达克100ETF招商",
      "managerRecords": [
        {
          "name": "刘重杰",
          "start": "2023-04-12",
          "end": null,
          "tenureYears": 3.4442870147915428,
          "tenureText": "3年162天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:16.391053+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159659.html",
      "sourceSha256": "b66ec3e1ff3be74c4c9183a6d099e88d93eaa81dd266794668bb13141bc6dda7",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159513",
      "name": "纳斯达克100ETF大成",
      "managerRecords": [
        {
          "name": "冉凌浩",
          "start": "2023-07-12",
          "end": null,
          "tenureYears": 3.1951374771555883,
          "tenureText": "3年71天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:16.489721+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159513.html",
      "sourceSha256": "04d80918f0ce9fceebdb88be3a022cd141bd084402c576efeef2bf1fdb7fd403",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159696",
      "name": "纳指ETF易方达",
      "managerRecords": [
        {
          "name": "林伟斌",
          "start": "2023-08-17",
          "end": null,
          "tenureYears": 3.096572824904002,
          "tenureText": "3年35天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:17.501540+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159696.html",
      "sourceSha256": "7f66460a2fa6802e0c159698e96ee5eb3823b019290b9c2fb156ec2a727fa654",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159632",
      "name": "纳斯达克ETF华安",
      "managerRecords": [
        {
          "name": "倪斌",
          "start": "2022-07-21",
          "end": null,
          "tenureYears": 4.169832371643497,
          "tenureText": "4年62天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:16.615665+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159632.html",
      "sourceSha256": "932d7a7196b9dd326df0bef83b80859ec05087dc127318db6768031f7062aa5c",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "513870",
      "name": "纳指ETF富国",
      "managerRecords": [
        {
          "name": "葛俊阳",
          "start": "2025-07-04",
          "end": null,
          "tenureYears": 1.2156307111028974,
          "tenureText": "1年79天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:16.697096+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_513870.html",
      "sourceSha256": "1575c209d1b3411aae188693e2e4e7e4d99bec62fe7734edd213115acd158313",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159509",
      "name": "纳指科技ETF景顺",
      "managerRecords": [
        {
          "name": "汪洋",
          "start": "2023-07-19",
          "end": null,
          "tenureYears": 3.1759721281066686,
          "tenureText": "3年64天"
        },
        {
          "name": "张晓南",
          "start": "2023-08-08",
          "end": null,
          "tenureYears": 3.1212139879668985,
          "tenureText": "3年44天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:17.922495+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159509.html",
      "sourceSha256": "7447e374655bde426c5202c332ec44e8b6842305b12d6487d4b6b1de5d00df5d",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "513290",
      "name": "纳指生物科技ETF汇添富",
      "managerRecords": [
        {
          "name": "乐无穹",
          "start": "2026-08-12",
          "end": null,
          "tenureYears": 0.1095162802795403,
          "tenureText": "40天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:16.929468+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_513290.html",
      "sourceSha256": "f998f0e1ce487acb0cbbeecf5b28d7806ad5b18dc62d8e06ba172ac4bd1a941b",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "519981",
      "name": "长信标普100等权重指数人民币",
      "managerRecords": [
        {
          "name": "傅瑶纯",
          "start": "2020-01-02",
          "end": null,
          "tenureYears": 6.718823795149798,
          "tenureText": "6年262天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:17.086756+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_519981.html",
      "sourceSha256": "15534333a55c509f1612bd5a7059af4fbcabc46fa5236ce70d7dc77da7c30aee",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "513850",
      "name": "美国50ETF易方达",
      "managerRecords": [
        {
          "name": "林伟斌",
          "start": "2023-11-06",
          "end": null,
          "tenureYears": 2.874802357337933,
          "tenureText": "2年319天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:17.316823+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_513850.html",
      "sourceSha256": "6da8df7e51fa0887ffd3e7fbfbb409c09c0713fcd929a2babc5dd16ee1b92cd2",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    },
    {
      "code": "159577",
      "name": "美国50ETF汇添富",
      "managerRecords": [
        {
          "name": "乐无穹",
          "start": "2024-02-05",
          "end": null,
          "tenureYears": 2.625652819701979,
          "tenureText": "2年228天"
        }
      ],
      "managerAsOf": "2026-09-21",
      "managerCheckedAt": "2026-09-21T15:33:17.526103+00:00",
      "sourceUrl": "https://fundf10.eastmoney.com/jjjl_159577.html",
      "sourceSha256": "90e9dbf76b609f74422d373696ea7e7dc9549ce31e3e86cd7ef612b4fec4f218",
      "sourceStatus": "public_source_parsed",
      "limitation": "个人起点来自现任经理简介的明确上任日期；所列源未给整页发布日期，观察日为实际抓取日期。"
    }
  ]
};
