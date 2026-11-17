var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:30:48+00:00",
      "asOf": "2026-11-16",
      "records": 432,
      "basis": "provider_adjusted_close",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 24.59
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:30:48+00:00",
        "asOf": "2026-11-16",
        "records": 432,
        "basis": "provider_adjusted_close",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 24.59
        }
      }
    },
    "funds": {
      "status": "timeout",
      "attemptedAt": "2026-11-17T04:30:23+00:00",
      "exitCode": 124,
      "seconds": 90.36,
      "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n\n本阶段未成功，已恢复页面数据：snapshot.js。\n",
      "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
      "mode": "online",
      "lastOnlineAttempt": {
        "status": "timeout",
        "attemptedAt": "2026-11-17T04:30:23+00:00",
        "exitCode": 124,
        "seconds": 90.36,
        "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n\n本阶段未成功，已恢复页面数据：snapshot.js。\n",
        "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
        "mode": "online"
      }
    },
    "indices": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:29:18+00:00",
      "exitCode": 0,
      "seconds": 25.59,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:29:18+00:00",
        "exitCode": 0,
        "seconds": 25.59,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "stocks": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:29:48+00:00",
      "records": 71,
      "failures": [],
      "metadataWarnings": [],
      "asOf": "2026-11-17",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 55.5
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:29:48+00:00",
        "records": 71,
        "failures": [],
        "metadataWarnings": [],
        "asOf": "2026-11-17",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 55.5
        }
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-11-17T04:32:33+00:00",
      "exitCode": 0,
      "seconds": 1.32,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-17T04:32:33+00:00",
        "exitCode": 0,
        "seconds": 1.32,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-11-17T04:32:51+00:00",
      "exitCode": 0,
      "seconds": 1.06,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-17T04:32:51+00:00",
        "exitCode": 0,
        "seconds": 1.06,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "research_funds": {
      "status": "partial",
      "attemptedAt": "2026-11-17T04:32:33+00:00",
      "records": 395,
      "asOf": "2026-11-16",
      "failures": {
        "006567": "已取得2026-11-16净值，收益历史仍截至2026-11-13",
        "005094": "已取得2026-11-16净值，收益历史仍截至2026-11-13",
        "001323": "已取得2026-11-16净值，收益历史仍截至2026-11-13",
        "024393": "已取得2026-11-16净值，收益历史仍截至2026-11-13",
        "513210": "已取得2026-11-16净值，收益历史仍截至2026-11-13"
      },
      "refreshedCodes": null,
      "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 1.27
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-17T04:32:33+00:00",
        "records": 395,
        "asOf": "2026-11-16",
        "failures": {
          "006567": "已取得2026-11-16净值，收益历史仍截至2026-11-13",
          "005094": "已取得2026-11-16净值，收益历史仍截至2026-11-13",
          "001323": "已取得2026-11-16净值，收益历史仍截至2026-11-13",
          "024393": "已取得2026-11-16净值，收益历史仍截至2026-11-13",
          "513210": "已取得2026-11-16净值，收益历史仍截至2026-11-13"
        },
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
      "status": "partial",
      "attemptedAt": "2026-11-17T04:32:30+00:00",
      "mode": "online",
      "records": 1873,
      "total": 1873,
      "available": 1873,
      "missing": 0,
      "historyFailures": {
        "fund:001323": {
          "error": "<urlopen error [Errno 104] Connection reset by peer>",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_001323.html"
        },
        "fund:005094": {
          "error": "Remote end closed connection without response",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_005094.html"
        },
        "fund:000979": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_000979.html"
        },
        "fund:002252": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_002252.html"
        },
        "fund:006567": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_006567.html"
        },
        "fund:090013": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_090013.html"
        },
        "fund:519697": {
          "error": "Remote end closed connection without response",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_519697.html"
        },
        "fund:001036": {
          "error": "Remote end closed connection without response",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_001036.html"
        },
        "fund:003165": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_003165.html"
        },
        "fund:160518": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_160518.html"
        },
        "fund:005717": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_005717.html"
        },
        "fund:000189": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_000189.html"
        },
        "fund:001003": {
          "error": "Remote end closed connection without response",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_001003.html"
        },
        "fund:024393": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_024393.html"
        },
        "fund:513210": {
          "error": "The read operation timed out",
          "asOf": "2026-11-13",
          "sourceUrl": "https://fundf10.eastmoney.com/jjjz_513210.html"
        }
      },
      "navUpdated": 1668,
      "navWarnings": {},
      "returnsUpdated": 1668,
      "returnsRetained": {},
      "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-17T04:32:30+00:00",
        "mode": "online",
        "records": 1873,
        "total": 1873,
        "available": 1873,
        "missing": 0,
        "historyFailures": {
          "fund:001323": {
            "error": "<urlopen error [Errno 104] Connection reset by peer>",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_001323.html"
          },
          "fund:005094": {
            "error": "Remote end closed connection without response",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_005094.html"
          },
          "fund:000979": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_000979.html"
          },
          "fund:002252": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_002252.html"
          },
          "fund:006567": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_006567.html"
          },
          "fund:090013": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_090013.html"
          },
          "fund:519697": {
            "error": "Remote end closed connection without response",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_519697.html"
          },
          "fund:001036": {
            "error": "Remote end closed connection without response",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_001036.html"
          },
          "fund:003165": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_003165.html"
          },
          "fund:160518": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_160518.html"
          },
          "fund:005717": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_005717.html"
          },
          "fund:000189": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_000189.html"
          },
          "fund:001003": {
            "error": "Remote end closed connection without response",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_001003.html"
          },
          "fund:024393": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_024393.html"
          },
          "fund:513210": {
            "error": "The read operation timed out",
            "asOf": "2026-11-13",
            "sourceUrl": "https://fundf10.eastmoney.com/jjjz_513210.html"
          }
        },
        "navUpdated": 1668,
        "navWarnings": {},
        "returnsUpdated": 1668,
        "returnsRetained": {},
        "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。"
      }
    },
    "overseas_stocks": {
      "status": "partial",
      "attemptedAt": "2026-11-17T04:29:15+00:00",
      "asOf": "2026-11-16",
      "records": 79,
      "metadataWarnings": [
        {
          "symbol": "AMAT",
          "period": "2026-10",
          "missingFields": [
            "TotalRevenue",
            "NetIncome"
          ],
          "message": "2026-10财季来源缺营业收入、净利润"
        }
      ],
      "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。待补财报：AMAT 2026-10财季来源缺营业收入、净利润",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 22.23
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-17T04:29:15+00:00",
        "asOf": "2026-11-16",
        "records": 79,
        "metadataWarnings": [
          {
            "symbol": "AMAT",
            "period": "2026-10",
            "missingFields": [
              "TotalRevenue",
              "NetIncome"
            ],
            "message": "2026-10财季来源缺营业收入、净利润"
          }
        ],
        "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。待补财报：AMAT 2026-10财季来源缺营业收入、净利润",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 22.23
        }
      }
    },
    "fund_actions": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:35+00:00",
      "exitCode": 0,
      "seconds": 0.19,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:35+00:00",
        "exitCode": 0,
        "seconds": 0.19,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "etf_distributions": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:36+00:00",
      "exitCode": 0,
      "seconds": 1.43,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:36+00:00",
        "exitCode": 0,
        "seconds": 1.43,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "return_indices": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:36+00:00",
      "exitCode": 0,
      "seconds": 1.17,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:36+00:00",
        "exitCode": 0,
        "seconds": 1.17,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "financial_events": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:49+00:00",
      "exitCode": 0,
      "seconds": 1.93,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:49+00:00",
        "exitCode": 0,
        "seconds": 1.93,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "bank_fx": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:41+00:00",
      "exitCode": 0,
      "seconds": 6.43,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:41+00:00",
        "exitCode": 0,
        "seconds": 6.43,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "crossborder": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:39+00:00",
      "records": 305,
      "historyFailures": {},
      "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 4.8
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:39+00:00",
        "records": 305,
        "historyFailures": {},
        "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 4.8
        }
      }
    },
    "market_history": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:48+00:00",
      "exitCode": 0,
      "seconds": 6.39,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:48+00:00",
        "exitCode": 0,
        "seconds": 6.39,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "fund_batch": {
      "status": "partial",
      "attemptedAt": "2026-11-17T04:28:53+00:00",
      "mode": "online",
      "records": 1683,
      "requested": 1690,
      "failures": {
        "000970": "could not convert string to float: '--'",
        "001728": "could not convert string to float: '--'",
        "002924": "could not convert string to float: '--'",
        "004848": "could not convert string to float: '--'",
        "006111": "could not convert string to float: '--'",
        "006158": "could not convert string to float: '--'",
        "506009": "could not convert string to float: '--'"
      },
      "message": "批量取得最新净值及其原日期；缺项基金使用独立历史接口",
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-17T04:28:53+00:00",
        "mode": "online",
        "records": 1683,
        "requested": 1690,
        "failures": {
          "000970": "could not convert string to float: '--'",
          "001728": "could not convert string to float: '--'",
          "002924": "could not convert string to float: '--'",
          "004848": "could not convert string to float: '--'",
          "006111": "could not convert string to float: '--'",
          "006158": "could not convert string to float: '--'",
          "506009": "could not convert string to float: '--'"
        },
        "message": "批量取得最新净值及其原日期；缺项基金使用独立历史接口"
      }
    },
    "benchmark_sync": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:32+00:00",
      "exitCode": 0,
      "seconds": 1.86,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:32+00:00",
        "exitCode": 0,
        "seconds": 1.86,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_sync": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:30+00:00",
      "exitCode": 0,
      "seconds": 28.22,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:30+00:00",
        "exitCode": 0,
        "seconds": 28.22,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "benchmark_valuations": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:36+00:00",
      "exitCode": 0,
      "seconds": 1.06,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:36+00:00",
        "exitCode": 0,
        "seconds": 1.06,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_stress": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:35+00:00",
      "exitCode": 0,
      "seconds": 0.59,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:35+00:00",
        "exitCode": 0,
        "seconds": 0.59,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "drop_highs": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:50+00:00",
      "exitCode": 0,
      "seconds": 0.64,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:50+00:00",
        "exitCode": 0,
        "seconds": 0.64,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "market_history_pe": {
      "status": "success",
      "attemptedAt": "2026-11-17T04:32:36+00:00",
      "exitCode": 0,
      "seconds": 1.18,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-17T04:32:36+00:00",
        "exitCode": 0,
        "seconds": 1.18,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    }
  },
  "checkedAt": "2026-11-17T04:32:51+00:00"
};
