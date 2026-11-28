var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:07+00:00",
      "asOf": "2026-11-27",
      "records": 432,
      "basis": "provider_adjusted_close",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 25.94
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:07+00:00",
        "asOf": "2026-11-27",
        "records": 432,
        "basis": "provider_adjusted_close",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 25.94
        }
      }
    },
    "funds": {
      "status": "partial",
      "attemptedAt": "2026-11-28T03:55:04+00:00",
      "asOf": "2026-11-26",
      "records": 46,
      "requested": 46,
      "failures": [],
      "metadataWarnings": [
        "159655:manager"
      ],
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 53.25
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-28T03:55:04+00:00",
        "asOf": "2026-11-26",
        "records": 46,
        "requested": 46,
        "failures": [],
        "metadataWarnings": [
          "159655:manager"
        ],
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 53.25
        }
      }
    },
    "indices": {
      "status": "timeout",
      "attemptedAt": "2026-11-28T03:55:41+00:00",
      "exitCode": 124,
      "seconds": 90.08,
      "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n",
      "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
      "mode": "online",
      "lastOnlineAttempt": {
        "status": "timeout",
        "attemptedAt": "2026-11-28T03:55:41+00:00",
        "exitCode": 124,
        "seconds": 90.08,
        "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n",
        "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
        "mode": "online"
      }
    },
    "stocks": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:55:03+00:00",
      "records": 71,
      "failures": [],
      "metadataWarnings": [],
      "asOf": "2026-11-27",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 52.08
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:55:03+00:00",
        "records": 71,
        "failures": [],
        "metadataWarnings": [],
        "asOf": "2026-11-27",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 52.08
        }
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-11-28T03:56:44+00:00",
      "exitCode": 0,
      "seconds": 1.32,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-28T03:56:44+00:00",
        "exitCode": 0,
        "seconds": 1.32,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-11-28T03:57:04+00:00",
      "exitCode": 0,
      "seconds": 1.05,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-28T03:57:04+00:00",
        "exitCode": 0,
        "seconds": 1.05,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "research_funds": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:44+00:00",
      "records": 395,
      "asOf": "2026-11-27",
      "failures": {},
      "refreshedCodes": null,
      "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 1.27
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:44+00:00",
        "records": 395,
        "asOf": "2026-11-27",
        "failures": {},
        "refreshedCodes": null,
        "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 1.27
        }
      }
    },
    "portfolio": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:41+00:00",
      "records": 1873,
      "total": 1873,
      "available": 1873,
      "missing": 0,
      "historyFailures": {},
      "navUpdated": 1642,
      "navWarnings": {},
      "returnsUpdated": 1688,
      "returnsRetained": {},
      "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 59.36
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:41+00:00",
        "records": 1873,
        "total": 1873,
        "available": 1873,
        "missing": 0,
        "historyFailures": {},
        "navUpdated": 1642,
        "navWarnings": {},
        "returnsUpdated": 1688,
        "returnsRetained": {},
        "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 59.36
        }
      }
    },
    "overseas_stocks": {
      "status": "partial",
      "attemptedAt": "2026-11-28T03:54:35+00:00",
      "asOf": "2026-11-27",
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
        "seconds": 24.06
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-28T03:54:35+00:00",
        "asOf": "2026-11-27",
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
          "seconds": 24.06
        }
      }
    },
    "fund_actions": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:46+00:00",
      "exitCode": 0,
      "seconds": 0.17,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:46+00:00",
        "exitCode": 0,
        "seconds": 0.17,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "etf_distributions": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:47+00:00",
      "exitCode": 0,
      "seconds": 1.49,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:47+00:00",
        "exitCode": 0,
        "seconds": 1.49,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "return_indices": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:47+00:00",
      "exitCode": 0,
      "seconds": 1.62,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:47+00:00",
        "exitCode": 0,
        "seconds": 1.62,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "financial_events": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:57:02+00:00",
      "exitCode": 0,
      "seconds": 3.06,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:57:02+00:00",
        "exitCode": 0,
        "seconds": 3.06,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "bank_fx": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:49+00:00",
      "exitCode": 0,
      "seconds": 3.61,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:49+00:00",
        "exitCode": 0,
        "seconds": 3.61,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "crossborder": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:53+00:00",
      "records": 305,
      "historyFailures": {},
      "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 7.24
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:53+00:00",
        "records": 305,
        "historyFailures": {},
        "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 7.24
        }
      }
    },
    "market_history": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:59+00:00",
      "exitCode": 0,
      "seconds": 6.46,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:59+00:00",
        "exitCode": 0,
        "seconds": 6.46,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "fund_batch": {
      "status": "partial",
      "attemptedAt": "2026-11-28T03:54:11+00:00",
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
        "attemptedAt": "2026-11-28T03:54:11+00:00",
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
      "attemptedAt": "2026-11-28T03:56:43+00:00",
      "exitCode": 0,
      "seconds": 1.89,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:43+00:00",
        "exitCode": 0,
        "seconds": 1.89,
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
      "attemptedAt": "2026-11-28T03:56:47+00:00",
      "exitCode": 0,
      "seconds": 1.52,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:47+00:00",
        "exitCode": 0,
        "seconds": 1.52,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_stress": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:46+00:00",
      "exitCode": 0,
      "seconds": 0.6,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:46+00:00",
        "exitCode": 0,
        "seconds": 0.6,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "drop_highs": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:57:03+00:00",
      "exitCode": 0,
      "seconds": 1.02,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:57:03+00:00",
        "exitCode": 0,
        "seconds": 1.02,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "market_history_pe": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:48+00:00",
      "exitCode": 0,
      "seconds": 2.21,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:48+00:00",
        "exitCode": 0,
        "seconds": 2.21,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "condition_vix": {
      "status": "success",
      "attemptedAt": "2026-11-28T03:56:46+00:00",
      "exitCode": 0,
      "seconds": 0.47,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-28T03:56:46+00:00",
        "exitCode": 0,
        "seconds": 0.47,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    }
  },
  "checkedAt": "2026-11-28T03:57:04+00:00"
};
