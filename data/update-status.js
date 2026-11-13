var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:40:52+00:00",
      "asOf": "2026-11-12",
      "records": 432,
      "basis": "provider_adjusted_close",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 38.51
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:40:52+00:00",
        "asOf": "2026-11-12",
        "records": 432,
        "basis": "provider_adjusted_close",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 38.51
        }
      }
    },
    "funds": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:39:35+00:00",
      "asOf": "2026-11-11",
      "records": 46,
      "requested": 46,
      "failures": [],
      "metadataWarnings": [],
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 52.36
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:39:35+00:00",
        "asOf": "2026-11-11",
        "records": 46,
        "requested": 46,
        "failures": [],
        "metadataWarnings": [],
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 52.36
        }
      }
    },
    "indices": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:39:02+00:00",
      "exitCode": 0,
      "seconds": 19.45,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:39:02+00:00",
        "exitCode": 0,
        "seconds": 19.45,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "stocks": {
      "status": "timeout",
      "attemptedAt": "2026-11-13T02:40:13+00:00",
      "exitCode": 124,
      "seconds": 90.34,
      "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n\n本阶段未成功，已恢复页面数据：snapshot.js。\n",
      "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
      "mode": "online",
      "lastOnlineAttempt": {
        "status": "timeout",
        "attemptedAt": "2026-11-13T02:40:13+00:00",
        "exitCode": 124,
        "seconds": 90.34,
        "message": "\n执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。\n\n本阶段未成功，已恢复页面数据：snapshot.js。\n",
        "error": "执行超过 90 秒，子进程已终止；该数据集不能视为更新成功。",
        "mode": "online"
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-11-13T02:41:39+00:00",
      "exitCode": 0,
      "seconds": 1.91,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-13T02:41:39+00:00",
        "exitCode": 0,
        "seconds": 1.91,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-11-13T02:41:57+00:00",
      "exitCode": 0,
      "seconds": 1.49,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-11-13T02:41:57+00:00",
        "exitCode": 0,
        "seconds": 1.49,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "research_funds": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:39+00:00",
      "records": 395,
      "asOf": "2026-11-12",
      "failures": {},
      "refreshedCodes": null,
      "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 1.85
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:39+00:00",
        "records": 395,
        "asOf": "2026-11-12",
        "failures": {},
        "refreshedCodes": null,
        "message": "复用本轮已更新的行情曲线；原费率和研究核验日期保持独立",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 1.85
        }
      }
    },
    "portfolio": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:33+00:00",
      "records": 1873,
      "total": 1873,
      "available": 1873,
      "missing": 0,
      "historyFailures": {},
      "navUpdated": 1637,
      "navWarnings": {},
      "returnsUpdated": 1683,
      "returnsRetained": {},
      "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 79.38
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:33+00:00",
        "records": 1873,
        "total": 1873,
        "available": 1873,
        "missing": 0,
        "historyFailures": {},
        "navUpdated": 1637,
        "navWarnings": {},
        "returnsUpdated": 1683,
        "returnsRetained": {},
        "message": "逐标的保存已验证历史；失败项保留原日期，收益与净值按同一份历史同步。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 79.38
        }
      }
    },
    "overseas_stocks": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:39:08+00:00",
      "asOf": "2026-11-12",
      "records": 79,
      "metadataWarnings": [],
      "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 24.88
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:39:08+00:00",
        "asOf": "2026-11-12",
        "records": 79,
        "metadataWarnings": [],
        "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 24.88
        }
      }
    },
    "fund_actions": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:41+00:00",
      "exitCode": 0,
      "seconds": 0.24,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:41+00:00",
        "exitCode": 0,
        "seconds": 0.24,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "etf_distributions": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:43+00:00",
      "exitCode": 0,
      "seconds": 1.96,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:43+00:00",
        "exitCode": 0,
        "seconds": 1.96,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "return_indices": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:42+00:00",
      "exitCode": 0,
      "seconds": 1.29,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:42+00:00",
        "exitCode": 0,
        "seconds": 1.29,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "financial_events": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:55+00:00",
      "exitCode": 0,
      "seconds": 2.4,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:55+00:00",
        "exitCode": 0,
        "seconds": 2.4,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "bank_fx": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:45+00:00",
      "exitCode": 0,
      "seconds": 4.28,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:45+00:00",
        "exitCode": 0,
        "seconds": 4.28,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "crossborder": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:47+00:00",
      "records": 305,
      "historyFailures": {},
      "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 5.81
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:47+00:00",
        "records": 305,
        "historyFailures": {},
        "message": "净值复用已发布且哈希核对的曲线；成交价失败保留原同期比较及日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 5.81
        }
      }
    },
    "market_history": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:53+00:00",
      "exitCode": 0,
      "seconds": 11.68,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:53+00:00",
        "exitCode": 0,
        "seconds": 11.68,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "fund_batch": {
      "status": "partial",
      "attemptedAt": "2026-11-13T02:38:43+00:00",
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
        "attemptedAt": "2026-11-13T02:38:43+00:00",
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
      "attemptedAt": "2026-11-13T02:41:37+00:00",
      "exitCode": 0,
      "seconds": 2.64,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:37+00:00",
        "exitCode": 0,
        "seconds": 2.64,
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
      "attemptedAt": "2026-11-13T02:41:43+00:00",
      "exitCode": 0,
      "seconds": 2.34,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:43+00:00",
        "exitCode": 0,
        "seconds": 2.34,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "portfolio_stress": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:42+00:00",
      "exitCode": 0,
      "seconds": 0.6,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:42+00:00",
        "exitCode": 0,
        "seconds": 0.6,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "drop_highs": {
      "status": "success",
      "attemptedAt": "2026-11-13T02:41:56+00:00",
      "exitCode": 0,
      "seconds": 0.81,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-11-13T02:41:56+00:00",
        "exitCode": 0,
        "seconds": 0.81,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    }
  },
  "checkedAt": "2026-11-13T02:41:57+00:00"
};
