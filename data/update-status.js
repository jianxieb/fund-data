var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:04:19+00:00",
      "asOf": "2026-11-23",
      "records": 432,
      "basis": "provider_adjusted_close",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 49.45
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:04:19+00:00",
        "asOf": "2026-11-23",
        "records": 432,
        "basis": "provider_adjusted_close",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 49.45
        }
      }
    },
    "funds": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:02:28+00:00",
      "asOf": "2026-11-20",
      "records": 46,
      "requested": 46,
      "failures": [],
      "metadataWarnings": [],
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 28.97
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:02:28+00:00",
        "asOf": "2026-11-20",
        "records": 46,
        "requested": 46,
        "failures": [],
        "metadataWarnings": [],
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 28.97
        }
      }
    },
    "indices": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:02:24+00:00",
      "exitCode": 0,
      "seconds": 25.1,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:02:24+00:00",
        "exitCode": 0,
        "seconds": 25.1,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "stocks": {
      "status": "timeout",
      "attemptedAt": "2026-11-24T06:03:30+00:00",
      "exitCode": 124,
      "seconds": 90.38,
      "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n\n本阶段未成功，已恢复页面数据：snapshot.js。\n",
      "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
      "mode": "online",
      "lastOnlineAttempt": {
        "status": "timeout",
        "attemptedAt": "2026-11-24T06:03:30+00:00",
        "exitCode": 124,
        "seconds": 90.38,
        "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n\n本阶段未成功，已恢复页面数据：snapshot.js。\n",
        "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
        "mode": "online"
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-11-24T06:06:09+00:00",
      "exitCode": 0,
      "seconds": 2.52,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-24T06:06:09+00:00",
        "exitCode": 0,
        "seconds": 2.52,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-11-24T06:06:34+00:00",
      "exitCode": 0,
      "seconds": 1.86,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-24T06:06:34+00:00",
        "exitCode": 0,
        "seconds": 1.86,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "research_funds": {
      "status": "partial",
      "attemptedAt": "2026-11-24T06:06:09+00:00",
      "records": 395,
      "asOf": "2026-11-23",
      "failures": {
        "519212": "已取得2026-11-23净值，收益历史仍截至2026-11-20",
        "159750": "已取得2026-11-23净值，收益历史仍截至2026-11-20"
      },
      "refreshedCodes": null,
      "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 2.61
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-24T06:06:09+00:00",
        "records": 395,
        "asOf": "2026-11-23",
        "failures": {
          "519212": "已取得2026-11-23净值，收益历史仍截至2026-11-20",
          "159750": "已取得2026-11-23净值，收益历史仍截至2026-11-20"
        },
        "refreshedCodes": null,
        "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 2.61
        }
      }
    },
    "portfolio": {
      "status": "partial",
      "attemptedAt": "2026-11-24T06:06:03+00:00",
      "mode": "online",
      "records": 1873,
      "total": 1873,
      "available": 1873,
      "missing": 0,
      "historyFailures": {
        "fund:519212": {
          "error": "Remote end closed connection without response",
          "asOf": "2026-11-20",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_519212.html"
        },
        "fund:470009": {
          "error": "The read operation timed out",
          "asOf": "2026-11-20",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_470009.html"
        },
        "fund:166005": {
          "error": "<urlopen error [Errno 104] Connection reset by peer>",
          "asOf": "2026-11-20",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_166005.html"
        },
        "fund:202001": {
          "error": "The read operation timed out",
          "asOf": "2026-11-20",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_202001.html"
        },
        "fund:000977": {
          "error": "The read operation timed out",
          "asOf": "2026-11-20",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_000977.html"
        },
        "fund:004119": {
          "error": "The read operation timed out",
          "asOf": "2026-11-20",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_004119.html"
        },
        "fund:501059": {
          "error": "The read operation timed out",
          "asOf": "2026-11-20",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_501059.html"
        },
        "fund:018868": {
          "error": "The read operation timed out",
          "asOf": "2026-11-20",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_018868.html"
        },
        "fund:159750": {
          "error": "The read operation timed out",
          "asOf": "2026-11-20",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_159750.html"
        },
        "fx:CNY": {
          "error": "本次汇率历史刷新尚未完成",
          "asOf": "2026-11-20",
          "sourceUrl": null
        }
      },
      "navUpdated": 1630,
      "navWarnings": {},
      "returnsUpdated": 1676,
      "returnsRetained": {},
      "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-24T06:06:03+00:00",
        "mode": "online",
        "records": 1873,
        "total": 1873,
        "available": 1873,
        "missing": 0,
        "historyFailures": {
          "fund:519212": {
            "error": "Remote end closed connection without response",
            "asOf": "2026-11-20",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_519212.html"
          },
          "fund:470009": {
            "error": "The read operation timed out",
            "asOf": "2026-11-20",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_470009.html"
          },
          "fund:166005": {
            "error": "<urlopen error [Errno 104] Connection reset by peer>",
            "asOf": "2026-11-20",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_166005.html"
          },
          "fund:202001": {
            "error": "The read operation timed out",
            "asOf": "2026-11-20",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_202001.html"
          },
          "fund:000977": {
            "error": "The read operation timed out",
            "asOf": "2026-11-20",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_000977.html"
          },
          "fund:004119": {
            "error": "The read operation timed out",
            "asOf": "2026-11-20",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_004119.html"
          },
          "fund:501059": {
            "error": "The read operation timed out",
            "asOf": "2026-11-20",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_501059.html"
          },
          "fund:018868": {
            "error": "The read operation timed out",
            "asOf": "2026-11-20",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_018868.html"
          },
          "fund:159750": {
            "error": "The read operation timed out",
            "asOf": "2026-11-20",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_159750.html"
          },
          "fx:CNY": {
            "error": "本次汇率历史刷新尚未完成",
            "asOf": "2026-11-20",
            "sourceUrl": null
          }
        },
        "navUpdated": 1630,
        "navWarnings": {},
        "returnsUpdated": 1676,
        "returnsRetained": {},
        "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。"
      }
    },
    "overseas_stocks": {
      "status": "partial",
      "attemptedAt": "2026-11-24T06:02:22+00:00",
      "asOf": "2026-11-23",
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
        "seconds": 22.81
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-24T06:02:22+00:00",
        "asOf": "2026-11-23",
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
          "seconds": 22.81
        }
      }
    },
    "fund_actions": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:11+00:00",
      "exitCode": 0,
      "seconds": 0.3,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:11+00:00",
        "exitCode": 0,
        "seconds": 0.3,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "etf_distributions": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:18+00:00",
      "exitCode": 0,
      "seconds": 6.78,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:18+00:00",
        "exitCode": 0,
        "seconds": 6.78,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "return_indices": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:12+00:00",
      "exitCode": 0,
      "seconds": 1.45,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:12+00:00",
        "exitCode": 0,
        "seconds": 1.45,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "financial_events": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:31+00:00",
      "exitCode": 0,
      "seconds": 1.91,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:31+00:00",
        "exitCode": 0,
        "seconds": 1.91,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "bank_fx": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:15+00:00",
      "exitCode": 0,
      "seconds": 4.57,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:15+00:00",
        "exitCode": 0,
        "seconds": 4.57,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "crossborder": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:17+00:00",
      "records": 305,
      "historyFailures": {},
      "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 6.04
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:17+00:00",
        "records": 305,
        "historyFailures": {},
        "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 6.04
        }
      }
    },
    "market_history": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:29+00:00",
      "exitCode": 0,
      "seconds": 11.24,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:29+00:00",
        "exitCode": 0,
        "seconds": 11.24,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "fund_batch": {
      "status": "partial",
      "attemptedAt": "2026-11-24T06:01:59+00:00",
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
        "attemptedAt": "2026-11-24T06:01:59+00:00",
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
      "attemptedAt": "2026-11-24T06:06:06+00:00",
      "exitCode": 0,
      "seconds": 3.06,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:06+00:00",
        "exitCode": 0,
        "seconds": 3.06,
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
      "attemptedAt": "2026-11-24T06:06:12+00:00",
      "exitCode": 0,
      "seconds": 1.28,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:12+00:00",
        "exitCode": 0,
        "seconds": 1.28,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_stress": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:12+00:00",
      "exitCode": 0,
      "seconds": 0.81,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:12+00:00",
        "exitCode": 0,
        "seconds": 0.81,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "drop_highs": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:32+00:00",
      "exitCode": 0,
      "seconds": 1.42,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:32+00:00",
        "exitCode": 0,
        "seconds": 1.42,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "market_history_pe": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:13+00:00",
      "exitCode": 0,
      "seconds": 1.78,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:13+00:00",
        "exitCode": 0,
        "seconds": 1.78,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "condition_vix": {
      "status": "success",
      "attemptedAt": "2026-11-24T06:06:12+00:00",
      "exitCode": 0,
      "seconds": 0.77,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-24T06:06:12+00:00",
        "exitCode": 0,
        "seconds": 0.77,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    }
  },
  "checkedAt": "2026-11-24T06:06:34+00:00"
};
