var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:11:31+00:00",
      "asOf": "2026-11-25",
      "records": 432,
      "basis": "provider_adjusted_close",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 35.28
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:11:31+00:00",
        "asOf": "2026-11-25",
        "records": 432,
        "basis": "provider_adjusted_close",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 35.28
        }
      }
    },
    "funds": {
      "status": "timeout",
      "attemptedAt": "2026-11-26T04:10:55+00:00",
      "exitCode": 124,
      "seconds": 90.02,
      "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n",
      "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
      "mode": "online",
      "lastOnlineAttempt": {
        "status": "timeout",
        "attemptedAt": "2026-11-26T04:10:55+00:00",
        "exitCode": 124,
        "seconds": 90.02,
        "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n",
        "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
        "mode": "online"
      }
    },
    "indices": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:10:29+00:00",
      "exitCode": 0,
      "seconds": 63.8,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:10:29+00:00",
        "exitCode": 0,
        "seconds": 63.8,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "stocks": {
      "status": "timeout",
      "attemptedAt": "2026-11-26T04:10:56+00:00",
      "exitCode": 124,
      "seconds": 90.24,
      "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n",
      "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
      "mode": "online",
      "lastOnlineAttempt": {
        "status": "timeout",
        "attemptedAt": "2026-11-26T04:10:56+00:00",
        "exitCode": 124,
        "seconds": 90.24,
        "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n",
        "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
        "mode": "online"
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-11-26T04:12:09+00:00",
      "exitCode": 0,
      "seconds": 1.52,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-26T04:12:09+00:00",
        "exitCode": 0,
        "seconds": 1.52,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-11-26T04:12:27+00:00",
      "exitCode": 0,
      "seconds": 1.29,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-26T04:12:27+00:00",
        "exitCode": 0,
        "seconds": 1.29,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "research_funds": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:09+00:00",
      "records": 395,
      "asOf": "2026-11-25",
      "failures": {},
      "refreshedCodes": null,
      "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 1.47
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:09+00:00",
        "records": 395,
        "asOf": "2026-11-25",
        "failures": {},
        "refreshedCodes": null,
        "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 1.47
        }
      }
    },
    "portfolio": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:05+00:00",
      "records": 1873,
      "total": 1873,
      "available": 1873,
      "missing": 0,
      "historyFailures": {},
      "navUpdated": 1685,
      "navWarnings": {},
      "returnsUpdated": 1685,
      "returnsRetained": {},
      "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 69.23
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:05+00:00",
        "records": 1873,
        "total": 1873,
        "available": 1873,
        "missing": 0,
        "historyFailures": {},
        "navUpdated": 1685,
        "navWarnings": {},
        "returnsUpdated": 1685,
        "returnsRetained": {},
        "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 69.23
        }
      }
    },
    "overseas_stocks": {
      "status": "partial",
      "attemptedAt": "2026-11-26T04:09:46+00:00",
      "asOf": "2026-11-25",
      "records": 79,
      "metadataWarnings": [
        {
          "symbol": "WMT",
          "period": "2026-10",
          "missingFields": [
            "TotalRevenue",
            "NetIncome"
          ],
          "message": "2026-10财季来源缺营业收入、净利润"
        },
        {
          "symbol": "AMAT",
          "period": "2026-10",
          "missingFields": [
            "TotalRevenue",
            "NetIncome"
          ],
          "message": "2026-10财季来源缺营业收入、净利润"
        },
        {
          "symbol": "NVDA",
          "period": "2026-10",
          "missingFields": [
            "TotalRevenue",
            "NetIncome"
          ],
          "message": "2026-10财季来源缺营业收入、净利润"
        }
      ],
      "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。待补财报：WMT 2026-10财季来源缺营业收入、净利润；AMAT 2026-10财季来源缺营业收入、净利润；NVDA 2026-10财季来源缺营业收入、净利润",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 20.42
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-26T04:09:46+00:00",
        "asOf": "2026-11-25",
        "records": 79,
        "metadataWarnings": [
          {
            "symbol": "WMT",
            "period": "2026-10",
            "missingFields": [
              "TotalRevenue",
              "NetIncome"
            ],
            "message": "2026-10财季来源缺营业收入、净利润"
          },
          {
            "symbol": "AMAT",
            "period": "2026-10",
            "missingFields": [
              "TotalRevenue",
              "NetIncome"
            ],
            "message": "2026-10财季来源缺营业收入、净利润"
          },
          {
            "symbol": "NVDA",
            "period": "2026-10",
            "missingFields": [
              "TotalRevenue",
              "NetIncome"
            ],
            "message": "2026-10财季来源缺营业收入、净利润"
          }
        ],
        "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。待补财报：WMT 2026-10财季来源缺营业收入、净利润；AMAT 2026-10财季来源缺营业收入、净利润；NVDA 2026-10财季来源缺营业收入、净利润",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 20.42
        }
      }
    },
    "fund_actions": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:11+00:00",
      "exitCode": 0,
      "seconds": 0.19,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:11+00:00",
        "exitCode": 0,
        "seconds": 0.19,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "etf_distributions": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:12+00:00",
      "exitCode": 0,
      "seconds": 1.34,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:12+00:00",
        "exitCode": 0,
        "seconds": 1.34,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "return_indices": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:12+00:00",
      "exitCode": 0,
      "seconds": 1.3,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:12+00:00",
        "exitCode": 0,
        "seconds": 1.3,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "financial_events": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:25+00:00",
      "exitCode": 0,
      "seconds": 1.77,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:25+00:00",
        "exitCode": 0,
        "seconds": 1.77,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "bank_fx": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:14+00:00",
      "exitCode": 0,
      "seconds": 3.49,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:14+00:00",
        "exitCode": 0,
        "seconds": 3.49,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "crossborder": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:15+00:00",
      "records": 305,
      "historyFailures": {},
      "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 4.81
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:15+00:00",
        "records": 305,
        "historyFailures": {},
        "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 4.81
        }
      }
    },
    "market_history": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:23+00:00",
      "exitCode": 0,
      "seconds": 7.75,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:23+00:00",
        "exitCode": 0,
        "seconds": 7.75,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "fund_batch": {
      "status": "partial",
      "attemptedAt": "2026-11-26T04:09:25+00:00",
      "mode": "online",
      "records": 1685,
      "requested": 1690,
      "failures": {
        "000970": "could not convert string to float: '--'",
        "002924": "could not convert string to float: '--'",
        "006111": "could not convert string to float: '--'",
        "006158": "could not convert string to float: '--'",
        "506009": "could not convert string to float: '--'"
      },
      "message": "批量取得最新净值及其原日期；缺项基金使用独立历史接口",
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-26T04:09:25+00:00",
        "mode": "online",
        "records": 1685,
        "requested": 1690,
        "failures": {
          "000970": "could not convert string to float: '--'",
          "002924": "could not convert string to float: '--'",
          "006111": "could not convert string to float: '--'",
          "006158": "could not convert string to float: '--'",
          "506009": "could not convert string to float: '--'"
        },
        "message": "批量取得最新净值及其原日期；缺项基金使用独立历史接口"
      }
    },
    "benchmark_sync": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:08+00:00",
      "exitCode": 0,
      "seconds": 2.11,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:08+00:00",
        "exitCode": 0,
        "seconds": 2.11,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_sync": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:03+00:00",
      "exitCode": 0,
      "seconds": 47.76,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:03+00:00",
        "exitCode": 0,
        "seconds": 47.76,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "benchmark_valuations": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:12+00:00",
      "exitCode": 0,
      "seconds": 1.04,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:12+00:00",
        "exitCode": 0,
        "seconds": 1.04,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_stress": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:11+00:00",
      "exitCode": 0,
      "seconds": 0.5,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:11+00:00",
        "exitCode": 0,
        "seconds": 0.5,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "drop_highs": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:26+00:00",
      "exitCode": 0,
      "seconds": 0.68,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:26+00:00",
        "exitCode": 0,
        "seconds": 0.68,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "market_history_pe": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:12+00:00",
      "exitCode": 0,
      "seconds": 1.08,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:12+00:00",
        "exitCode": 0,
        "seconds": 1.08,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "condition_vix": {
      "status": "success",
      "attemptedAt": "2026-11-26T04:12:11+00:00",
      "exitCode": 0,
      "seconds": 0.37,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-26T04:12:11+00:00",
        "exitCode": 0,
        "seconds": 0.37,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    }
  },
  "checkedAt": "2026-11-26T04:12:27+00:00"
};
