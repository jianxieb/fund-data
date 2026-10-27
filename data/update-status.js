var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:31:20+00:00",
      "asOf": "2026-10-23",
      "records": 432,
      "basis": "provider_adjusted_close",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 55.57
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:31:20+00:00",
        "asOf": "2026-10-23",
        "records": 432,
        "basis": "provider_adjusted_close",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 55.57
        }
      }
    },
    "funds": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:30:19+00:00",
      "asOf": "2026-10-23",
      "records": 46,
      "requested": 46,
      "failures": [],
      "metadataWarnings": [],
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 68.79
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:30:19+00:00",
        "asOf": "2026-10-23",
        "records": 46,
        "requested": 46,
        "failures": [],
        "metadataWarnings": [],
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 68.79
        }
      }
    },
    "indices": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:29:30+00:00",
      "exitCode": 0,
      "seconds": 19.49,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:29:30+00:00",
        "exitCode": 0,
        "seconds": 19.49,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "stocks": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:30:24+00:00",
      "records": 71,
      "failures": [],
      "metadataWarnings": [],
      "asOf": "2026-10-27",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 73.99
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:30:24+00:00",
        "records": 71,
        "failures": [],
        "metadataWarnings": [],
        "asOf": "2026-10-27",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 73.99
        }
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-10-27T01:31:41+00:00",
      "exitCode": 0,
      "seconds": 2.6,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-10-27T01:31:41+00:00",
        "exitCode": 0,
        "seconds": 2.6,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-10-27T01:32:01+00:00",
      "exitCode": 0,
      "seconds": 1.73,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-10-27T01:32:01+00:00",
        "exitCode": 0,
        "seconds": 1.73,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "research_funds": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:31:41+00:00",
      "records": 395,
      "asOf": "2026-10-26",
      "failures": {},
      "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 2.46
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:31:41+00:00",
        "records": 395,
        "asOf": "2026-10-26",
        "failures": {},
        "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 2.46
        }
      }
    },
    "portfolio": {
      "status": "partial",
      "attemptedAt": "2026-10-27T01:31:35+00:00",
      "records": 1873,
      "total": 1873,
      "available": 1873,
      "missing": 0,
      "navUpdated": 0,
      "navWarnings": {},
      "returnsUpdated": 46,
      "returnsRetained": {},
      "historyFailures": {
        "fund:020516": {
          "error": "本次历史接口未更新：The read operation timed out",
          "asOf": "2026-10-23",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_020516.html"
        },
        "fund:018064": {
          "error": "本次历史接口未更新：The read operation timed out",
          "asOf": "2026-10-23",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_018064.html"
        },
        "fund:513650": {
          "error": "本次历史接口未更新：<urlopen error [Errno 104] Connection reset by peer>",
          "asOf": "2026-10-23",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_513650.html"
        },
        "fund:159659": {
          "error": "本次历史接口未更新：The read operation timed out",
          "asOf": "2026-10-23",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_159659.html"
        }
      },
      "message": "全部研究对象纳入标的库；基金收益由已校验净值曲线复算，实际日期逐项保存；费率、规模、经理及经营研究保持独立证据日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 70.23
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-10-27T01:31:35+00:00",
        "records": 1873,
        "total": 1873,
        "available": 1873,
        "missing": 0,
        "navUpdated": 0,
        "navWarnings": {},
        "returnsUpdated": 46,
        "returnsRetained": {},
        "historyFailures": {
          "fund:020516": {
            "error": "本次历史接口未更新：The read operation timed out",
            "asOf": "2026-10-23",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_020516.html"
          },
          "fund:018064": {
            "error": "本次历史接口未更新：The read operation timed out",
            "asOf": "2026-10-23",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_018064.html"
          },
          "fund:513650": {
            "error": "本次历史接口未更新：<urlopen error [Errno 104] Connection reset by peer>",
            "asOf": "2026-10-23",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_513650.html"
          },
          "fund:159659": {
            "error": "本次历史接口未更新：The read operation timed out",
            "asOf": "2026-10-23",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_159659.html"
          }
        },
        "message": "全部研究对象纳入标的库；基金收益由已校验净值曲线复算，实际日期逐项保存；费率、规模、经理及经营研究保持独立证据日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 70.23
        }
      }
    },
    "overseas_stocks": {
      "status": "partial",
      "attemptedAt": "2026-10-27T01:29:37+00:00",
      "asOf": "2026-10-23",
      "records": 79,
      "metadataWarnings": [
        {
          "symbol": "JPM",
          "period": "2026-09",
          "missingFields": [
            "TotalRevenue",
            "NetIncome"
          ],
          "message": "2026-09财季来源缺营业收入、净利润"
        },
        {
          "symbol": "ABT",
          "period": "2026-09",
          "missingFields": [
            "TotalRevenue",
            "NetIncome"
          ],
          "message": "2026-09财季来源缺营业收入、净利润"
        },
        {
          "symbol": "ROP",
          "period": "2026-09",
          "missingFields": [
            "TotalRevenue",
            "NetIncome"
          ],
          "message": "2026-09财季来源缺营业收入、净利润"
        }
      ],
      "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。待补财报：JPM 2026-09财季来源缺营业收入、净利润；ABT 2026-09财季来源缺营业收入、净利润；ROP 2026-09财季来源缺营业收入、净利润",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 26.33
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-10-27T01:29:37+00:00",
        "asOf": "2026-10-23",
        "records": 79,
        "metadataWarnings": [
          {
            "symbol": "JPM",
            "period": "2026-09",
            "missingFields": [
              "TotalRevenue",
              "NetIncome"
            ],
            "message": "2026-09财季来源缺营业收入、净利润"
          },
          {
            "symbol": "ABT",
            "period": "2026-09",
            "missingFields": [
              "TotalRevenue",
              "NetIncome"
            ],
            "message": "2026-09财季来源缺营业收入、净利润"
          },
          {
            "symbol": "ROP",
            "period": "2026-09",
            "missingFields": [
              "TotalRevenue",
              "NetIncome"
            ],
            "message": "2026-09财季来源缺营业收入、净利润"
          }
        ],
        "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。待补财报：JPM 2026-09财季来源缺营业收入、净利润；ABT 2026-09财季来源缺营业收入、净利润；ROP 2026-09财季来源缺营业收入、净利润",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 26.33
        }
      }
    },
    "fund_actions": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:31:43+00:00",
      "exitCode": 0,
      "seconds": 0.26,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:31:43+00:00",
        "exitCode": 0,
        "seconds": 0.26,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "etf_distributions": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:31:46+00:00",
      "exitCode": 0,
      "seconds": 2.95,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:31:46+00:00",
        "exitCode": 0,
        "seconds": 2.95,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "return_indices": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:31:44+00:00",
      "exitCode": 0,
      "seconds": 1.74,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:31:44+00:00",
        "exitCode": 0,
        "seconds": 1.74,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "financial_events": {
      "status": "failed",
      "attemptedAt": "2026-10-27T01:31:46+00:00",
      "exitCode": 1,
      "seconds": 3.07,
      "message": "gs.offline)\n                                      ^^^^^^^^^^^^^^^^^^^\n  File \"/home/runner/work/fund-data/fund-data/scripts/build_financial_events.py\", line 98, in build\n    return check()\n           ^^^^^^^\n  File \"/home/runner/work/fund-data/fund-data/scripts/build_financial_events.py\", line 119, in check\n    assert sha(ROOT / r['sourceFile']) == r['sourceSha256']\n           ^^^^^^^^^^^^^^^^^^^^^^^^^^^\n  File \"/home/runner/work/fund-data/fund-data/scripts/build_financial_events.py\", line 31, in sha\n    return hashlib.sha256(path.read_bytes()).hexdigest()\n                          ^^^^^^^^^^^^^^^^^\n  File \"/opt/hostedtoolcache/Python/3.12.15/x64/lib/python3.12/pathlib.py\", line 1019, in read_bytes\n    with self.open(mode='rb') as f:\n         ^^^^^^^^^^^^^^^^^^^^\n  File \"/opt/hostedtoolcache/Python/3.12.15/x64/lib/python3.12/pathlib.py\", line 1013, in open\n    return io.open(self, mode, buffering, encoding, errors, newline)\n           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\nFileNotFoundError: [Errno 2] No such file or directory: '/home/runner/work/fund-data/fund-data/data/return-comparison/IXIC-dab3e7f83cc1c4d1.json'\n\n本阶段未成功，已恢复页面数据：financial-events-history.json。\n",
      "error": "FileNotFoundError: [Errno 2] No such file or directory: '/home/runner/work/fund-data/fund-data/data/return-comparison/IXIC-dab3e7f83cc1c4d1.json'",
      "mode": "online",
      "lastOnlineAttempt": {
        "status": "failed",
        "attemptedAt": "2026-10-27T01:31:46+00:00",
        "exitCode": 1,
        "seconds": 3.07,
        "message": "gs.offline)\n                                      ^^^^^^^^^^^^^^^^^^^\n  File \"/home/runner/work/fund-data/fund-data/scripts/build_financial_events.py\", line 98, in build\n    return check()\n           ^^^^^^^\n  File \"/home/runner/work/fund-data/fund-data/scripts/build_financial_events.py\", line 119, in check\n    assert sha(ROOT / r['sourceFile']) == r['sourceSha256']\n           ^^^^^^^^^^^^^^^^^^^^^^^^^^^\n  File \"/home/runner/work/fund-data/fund-data/scripts/build_financial_events.py\", line 31, in sha\n    return hashlib.sha256(path.read_bytes()).hexdigest()\n                          ^^^^^^^^^^^^^^^^^\n  File \"/opt/hostedtoolcache/Python/3.12.15/x64/lib/python3.12/pathlib.py\", line 1019, in read_bytes\n    with self.open(mode='rb') as f:\n         ^^^^^^^^^^^^^^^^^^^^\n  File \"/opt/hostedtoolcache/Python/3.12.15/x64/lib/python3.12/pathlib.py\", line 1013, in open\n    return io.open(self, mode, buffering, encoding, errors, newline)\n           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\nFileNotFoundError: [Errno 2] No such file or directory: '/home/runner/work/fund-data/fund-data/data/return-comparison/IXIC-dab3e7f83cc1c4d1.json'\n\n本阶段未成功，已恢复页面数据：financial-events-history.json。\n",
        "error": "FileNotFoundError: [Errno 2] No such file or directory: '/home/runner/work/fund-data/fund-data/data/return-comparison/IXIC-dab3e7f83cc1c4d1.json'",
        "mode": "online"
      }
    },
    "bank_fx": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:31:46+00:00",
      "exitCode": 0,
      "seconds": 3.38,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:31:46+00:00",
        "exitCode": 0,
        "seconds": 3.38,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "crossborder": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:31:52+00:00",
      "exitCode": 0,
      "seconds": 8.78,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:31:52+00:00",
        "exitCode": 0,
        "seconds": 8.78,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "market_history": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:31:59+00:00",
      "exitCode": 0,
      "seconds": 16.22,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:31:59+00:00",
        "exitCode": 0,
        "seconds": 16.22,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "fund_batch": {
      "status": "partial",
      "attemptedAt": "2026-10-27T01:29:10+00:00",
      "mode": "online",
      "records": 1683,
      "requested": 1690,
      "failures": {
        "000970": "could not convert string to float: '--'",
        "001728": "could not convert string to float: '--'",
        "002924": "could not convert string to float: '--'",
        "004848": "could not convert string to float: '--'",
        "006111": "could not convert string to float: '--'",
        "006150": "could not convert string to float: '--'",
        "506009": "could not convert string to float: '--'"
      },
      "message": "批量取得最新净值及其原日期；缺项基金使用独立历史接口",
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-10-27T01:29:10+00:00",
        "mode": "online",
        "records": 1683,
        "requested": 1690,
        "failures": {
          "000970": "could not convert string to float: '--'",
          "001728": "could not convert string to float: '--'",
          "002924": "could not convert string to float: '--'",
          "004848": "could not convert string to float: '--'",
          "006111": "could not convert string to float: '--'",
          "006150": "could not convert string to float: '--'",
          "506009": "could not convert string to float: '--'"
        },
        "message": "批量取得最新净值及其原日期；缺项基金使用独立历史接口"
      }
    },
    "benchmark_sync": {
      "status": "success",
      "attemptedAt": "2026-10-27T01:31:38+00:00",
      "exitCode": 0,
      "seconds": 2.83,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-27T01:31:38+00:00",
        "exitCode": 0,
        "seconds": 2.83,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    }
  },
  "checkedAt": "2026-10-27T01:32:01+00:00"
};
