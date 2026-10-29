var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:49:55+00:00",
      "asOf": "2026-10-28",
      "records": 432,
      "basis": "provider_adjusted_close",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 50.42
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:49:55+00:00",
        "asOf": "2026-10-28",
        "records": 432,
        "basis": "provider_adjusted_close",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 50.42
        }
      }
    },
    "funds": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:49:01+00:00",
      "asOf": "2026-10-27",
      "records": 46,
      "requested": 46,
      "failures": [],
      "metadataWarnings": [],
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 55.36
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:49:01+00:00",
        "asOf": "2026-10-27",
        "records": 46,
        "requested": 46,
        "failures": [],
        "metadataWarnings": [],
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 55.36
        }
      }
    },
    "indices": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:48:23+00:00",
      "exitCode": 0,
      "seconds": 17.0,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:48:23+00:00",
        "exitCode": 0,
        "seconds": 17.0,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "stocks": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:49:04+00:00",
      "records": 71,
      "failures": [],
      "metadataWarnings": [],
      "asOf": "2026-10-29",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 58.69
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:49:04+00:00",
        "records": 71,
        "failures": [],
        "metadataWarnings": [],
        "asOf": "2026-10-29",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 58.69
        }
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-10-29T01:50:41+00:00",
      "exitCode": 0,
      "seconds": 2.76,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-10-29T01:50:41+00:00",
        "exitCode": 0,
        "seconds": 2.76,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-10-29T11:37:52+00:00",
      "exitCode": 0,
      "seconds": 0.83,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-10-29T11:37:52+00:00",
        "exitCode": 0,
        "seconds": 0.83,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "research_funds": {
      "status": "success",
      "attemptedAt": "2026-10-29T11:36:54+00:00",
      "mode": "online",
      "records": 395,
      "asOf": "2026-10-28",
      "failures": {},
      "refreshedCodes": [
        "019495",
        "021773",
        "513730"
      ],
      "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T11:36:54+00:00",
        "mode": "online",
        "records": 395,
        "asOf": "2026-10-28",
        "failures": {},
        "refreshedCodes": [
          "019495",
          "021773",
          "513730"
        ],
        "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立"
      }
    },
    "portfolio": {
      "status": "success",
      "attemptedAt": "2026-10-29T11:36:53+00:00",
      "mode": "online",
      "records": 1873,
      "total": 1873,
      "available": 1873,
      "missing": 0,
      "historyFailures": {},
      "navUpdated": 1672,
      "navWarnings": {},
      "returnsUpdated": 1679,
      "returnsRetained": {},
      "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
      "scope": "targeted",
      "repairedCodes": [
        "019495",
        "021773",
        "513730"
      ],
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T11:36:53+00:00",
        "mode": "online",
        "records": 1873,
        "total": 1873,
        "available": 1873,
        "missing": 0,
        "historyFailures": {},
        "navUpdated": 1672,
        "navWarnings": {},
        "returnsUpdated": 1679,
        "returnsRetained": {},
        "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
        "scope": "targeted",
        "repairedCodes": [
          "019495",
          "021773",
          "513730"
        ]
      }
    },
    "overseas_stocks": {
      "status": "partial",
      "attemptedAt": "2026-10-29T01:48:40+00:00",
      "asOf": "2026-10-28",
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
          "symbol": "UNH",
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
          "symbol": "VZ",
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
      "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。待补财报：JPM 2026-09财季来源缺营业收入、净利润；UNH 2026-09财季来源缺营业收入、净利润；ABT 2026-09财季来源缺营业收入、净利润；VZ 2026-09财季来源缺营业收入、净利润；ROP 2026-09财季来源缺营业收入、净利润",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 34.33
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-10-29T01:48:40+00:00",
        "asOf": "2026-10-28",
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
            "symbol": "UNH",
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
            "symbol": "VZ",
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
        "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。待补财报：JPM 2026-09财季来源缺营业收入、净利润；UNH 2026-09财季来源缺营业收入、净利润；ABT 2026-09财季来源缺营业收入、净利润；VZ 2026-09财季来源缺营业收入、净利润；ROP 2026-09财季来源缺营业收入、净利润",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 34.33
        }
      }
    },
    "fund_actions": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:50:43+00:00",
      "exitCode": 0,
      "seconds": 0.31,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:50:43+00:00",
        "exitCode": 0,
        "seconds": 0.31,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "etf_distributions": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:50:45+00:00",
      "exitCode": 0,
      "seconds": 2.34,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:50:45+00:00",
        "exitCode": 0,
        "seconds": 2.34,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "return_indices": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:50:45+00:00",
      "exitCode": 0,
      "seconds": 2.16,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:50:45+00:00",
        "exitCode": 0,
        "seconds": 2.16,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "financial_events": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:51:02+00:00",
      "exitCode": 0,
      "seconds": 2.96,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:51:02+00:00",
        "exitCode": 0,
        "seconds": 2.96,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "bank_fx": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:50:47+00:00",
      "exitCode": 0,
      "seconds": 3.91,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:50:47+00:00",
        "exitCode": 0,
        "seconds": 3.91,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "crossborder": {
      "status": "partial",
      "attemptedAt": "2026-10-29T11:37:51+00:00",
      "records": 305,
      "historyFailures": {
        "158042": {
          "error": "成交价历史：成交价历史落后净值超过7日",
          "asOf": "2026-10-26"
        }
      },
      "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 32.93
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-10-29T11:37:51+00:00",
        "records": 305,
        "historyFailures": {
          "158042": {
            "error": "成交价历史：成交价历史落后净值超过7日",
            "asOf": "2026-10-26"
          }
        },
        "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 32.93
        }
      }
    },
    "market_history": {
      "status": "success",
      "attemptedAt": "2026-10-29T01:50:59+00:00",
      "exitCode": 0,
      "seconds": 15.71,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T01:50:59+00:00",
        "exitCode": 0,
        "seconds": 15.71,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "fund_batch": {
      "status": "partial",
      "attemptedAt": "2026-10-29T11:24:29+00:00",
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
        "attemptedAt": "2026-10-29T11:24:29+00:00",
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
      "attemptedAt": "2026-10-29T11:27:11+00:00",
      "exitCode": 0,
      "seconds": 3.18,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T11:27:11+00:00",
        "exitCode": 0,
        "seconds": 3.18,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_sync": {
      "status": "success",
      "attemptedAt": "2026-10-29T11:27:08+00:00",
      "exitCode": 0,
      "seconds": 51.71,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-29T11:27:08+00:00",
        "exitCode": 0,
        "seconds": 51.71,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    }
  },
  "checkedAt": "2026-10-29T11:37:52+00:00"
};
