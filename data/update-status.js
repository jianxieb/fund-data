var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:01:09+00:00",
      "asOf": "2026-11-11",
      "records": 432,
      "basis": "provider_adjusted_close",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 49.03
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:01:09+00:00",
        "asOf": "2026-11-11",
        "records": 432,
        "basis": "provider_adjusted_close",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 49.03
        }
      }
    },
    "funds": {
      "status": "partial",
      "attemptedAt": "2026-11-12T02:59:27+00:00",
      "asOf": "2026-11-10",
      "records": 46,
      "requested": 46,
      "failures": [],
      "metadataWarnings": [
        "050025:manager",
        "159655:manager",
        "159612:manager",
        "513650:manager",
        "160213:manager",
        "270042:manager",
        "040046:manager",
        "000834:manager",
        "161130:manager",
        "539001:manager",
        "015299:manager",
        "016055:manager",
        "016532:manager",
        "016452:manager",
        "018043:manager",
        "019172:manager",
        "019547:manager"
      ],
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 37.6
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-12T02:59:27+00:00",
        "asOf": "2026-11-10",
        "records": 46,
        "requested": 46,
        "failures": [],
        "metadataWarnings": [
          "050025:manager",
          "159655:manager",
          "159612:manager",
          "513650:manager",
          "160213:manager",
          "270042:manager",
          "040046:manager",
          "000834:manager",
          "161130:manager",
          "539001:manager",
          "015299:manager",
          "016055:manager",
          "016532:manager",
          "016452:manager",
          "018043:manager",
          "019172:manager",
          "019547:manager"
        ],
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 37.6
        }
      }
    },
    "indices": {
      "status": "success",
      "attemptedAt": "2026-11-12T02:59:12+00:00",
      "exitCode": 0,
      "seconds": 21.82,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T02:59:12+00:00",
        "exitCode": 0,
        "seconds": 21.82,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "stocks": {
      "status": "timeout",
      "attemptedAt": "2026-11-12T03:00:20+00:00",
      "exitCode": 124,
      "seconds": 90.33,
      "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n\n本阶段未成功，已恢复页面数据：snapshot.js。\n",
      "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
      "mode": "online",
      "lastOnlineAttempt": {
        "status": "timeout",
        "attemptedAt": "2026-11-12T03:00:20+00:00",
        "exitCode": 124,
        "seconds": 90.33,
        "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n\n本阶段未成功，已恢复页面数据：snapshot.js。\n",
        "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
        "mode": "online"
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-11-12T03:02:55+00:00",
      "exitCode": 0,
      "seconds": 2.41,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-12T03:02:55+00:00",
        "exitCode": 0,
        "seconds": 2.41,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-11-12T03:03:16+00:00",
      "exitCode": 0,
      "seconds": 1.88,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-12T03:03:16+00:00",
        "exitCode": 0,
        "seconds": 1.88,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "research_funds": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:02:55+00:00",
      "records": 395,
      "asOf": "2026-11-11",
      "failures": {},
      "refreshedCodes": null,
      "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 2.39
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:02:55+00:00",
        "records": 395,
        "asOf": "2026-11-11",
        "failures": {},
        "refreshedCodes": null,
        "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 2.39
        }
      }
    },
    "portfolio": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:02:50+00:00",
      "mode": "online",
      "records": 1873,
      "total": 1873,
      "available": 1873,
      "missing": 0,
      "historyFailures": {},
      "navUpdated": 0,
      "navWarnings": {},
      "returnsUpdated": 1683,
      "returnsRetained": {},
      "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:02:50+00:00",
        "mode": "online",
        "records": 1873,
        "total": 1873,
        "available": 1873,
        "missing": 0,
        "historyFailures": {},
        "navUpdated": 0,
        "navWarnings": {},
        "returnsUpdated": 1683,
        "returnsRetained": {},
        "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。"
      }
    },
    "overseas_stocks": {
      "status": "success",
      "attemptedAt": "2026-11-12T02:59:14+00:00",
      "asOf": "2026-11-11",
      "records": 79,
      "metadataWarnings": [],
      "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 24.23
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T02:59:14+00:00",
        "asOf": "2026-11-11",
        "records": 79,
        "metadataWarnings": [],
        "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 24.23
        }
      }
    },
    "fund_actions": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:02:58+00:00",
      "exitCode": 0,
      "seconds": 0.31,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:02:58+00:00",
        "exitCode": 0,
        "seconds": 0.31,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "etf_distributions": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:03:00+00:00",
      "exitCode": 0,
      "seconds": 2.54,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:03:00+00:00",
        "exitCode": 0,
        "seconds": 2.54,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "return_indices": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:02:59+00:00",
      "exitCode": 0,
      "seconds": 1.67,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:02:59+00:00",
        "exitCode": 0,
        "seconds": 1.67,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "financial_events": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:03:14+00:00",
      "exitCode": 0,
      "seconds": 2.37,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:03:14+00:00",
        "exitCode": 0,
        "seconds": 2.37,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "bank_fx": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:03:06+00:00",
      "exitCode": 0,
      "seconds": 8.78,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:03:06+00:00",
        "exitCode": 0,
        "seconds": 8.78,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "crossborder": {
      "status": "partial",
      "attemptedAt": "2026-11-12T03:03:05+00:00",
      "records": 305,
      "historyFailures": {
        "158042": {
          "error": "成交价历史：行情观测不足：158042.SZ",
          "asOf": "2026-11-06"
        }
      },
      "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 6.95
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-11-12T03:03:05+00:00",
        "records": 305,
        "historyFailures": {
          "158042": {
            "error": "成交价历史：行情观测不足：158042.SZ",
            "asOf": "2026-11-06"
          }
        },
        "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 6.95
        }
      }
    },
    "market_history": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:03:11+00:00",
      "exitCode": 0,
      "seconds": 13.83,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:03:11+00:00",
        "exitCode": 0,
        "seconds": 13.83,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "fund_batch": {
      "status": "partial",
      "attemptedAt": "2026-11-12T02:58:50+00:00",
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
        "attemptedAt": "2026-11-12T02:58:50+00:00",
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
      "attemptedAt": "2026-11-12T03:02:53+00:00",
      "exitCode": 0,
      "seconds": 3.08,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:02:53+00:00",
        "exitCode": 0,
        "seconds": 3.08,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_sync": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:02:50+00:00",
      "exitCode": 0,
      "seconds": 45.35,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:02:50+00:00",
        "exitCode": 0,
        "seconds": 45.35,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "benchmark_valuations": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:02:59+00:00",
      "exitCode": 0,
      "seconds": 1.61,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:02:59+00:00",
        "exitCode": 0,
        "seconds": 1.61,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_stress": {
      "status": "success",
      "attemptedAt": "2026-11-12T03:02:58+00:00",
      "exitCode": 0,
      "seconds": 0.85,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-12T03:02:58+00:00",
        "exitCode": 0,
        "seconds": 0.85,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    }
  },
  "checkedAt": "2026-11-12T03:03:16+00:00"
};
