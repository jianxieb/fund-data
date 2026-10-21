var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-10-21T18:57:48+00:00",
      "asOf": "2026-10-20",
      "records": 432,
      "basis": "provider_adjusted_close",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 44.49
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-21T18:57:48+00:00",
        "asOf": "2026-10-20",
        "records": 432,
        "basis": "provider_adjusted_close",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 44.49
        }
      }
    },
    "funds": {
      "status": "partial",
      "attemptedAt": "2026-10-21T18:50:39+00:00",
      "asOf": "2026-10-20",
      "records": 46,
      "requested": 46,
      "failures": [],
      "metadataWarnings": [
        "539001:manager"
      ],
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 115.11
      },
      "lastOnlineAttempt": {
        "status": "partial",
        "attemptedAt": "2026-10-21T18:50:39+00:00",
        "asOf": "2026-10-20",
        "records": 46,
        "requested": 46,
        "failures": [],
        "metadataWarnings": [
          "539001:manager"
        ],
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 115.11
        }
      }
    },
    "indices": {
      "status": "success",
      "attemptedAt": "2026-10-21T18:53:09+00:00",
      "exitCode": 0,
      "seconds": 19.91,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-21T18:53:09+00:00",
        "exitCode": 0,
        "seconds": 19.91,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "stocks": {
      "status": "success",
      "attemptedAt": "2026-10-21T18:56:21+00:00",
      "records": 71,
      "failures": [],
      "asOf": "2026-10-21",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 192.05
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-21T18:56:21+00:00",
        "records": 71,
        "failures": [],
        "asOf": "2026-10-21",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 192.05
        }
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-10-21T18:57:04+00:00",
      "exitCode": 0,
      "seconds": 2.55,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-10-21T18:57:04+00:00",
        "exitCode": 0,
        "seconds": 2.55,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-10-21T19:16:17+00:00",
      "exitCode": 0,
      "seconds": 1.67,
      "mode": "online",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-10-21T19:16:17+00:00",
        "exitCode": 0,
        "seconds": 1.67,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    },
    "research_funds": {
      "status": "success",
      "attemptedAt": "2026-10-21T18:52:49+00:00",
      "records": 395,
      "requested": 395,
      "asOf": "2026-10-21",
      "dateRange": [
        "2026-10-20",
        "2026-10-21"
      ],
      "failures": [],
      "riskWarnings": {
        "158042": "日频风险观测不足（17条，至少19条）"
      },
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 129.62
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-21T18:52:49+00:00",
        "records": 395,
        "requested": 395,
        "asOf": "2026-10-21",
        "dateRange": [
          "2026-10-20",
          "2026-10-21"
        ],
        "failures": [],
        "riskWarnings": {
          "158042": "日频风险观测不足（17条，至少19条）"
        },
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 129.62
        }
      }
    },
    "portfolio": {
      "status": "success",
      "attemptedAt": "2026-10-21T19:16:15+00:00",
      "records": 1873,
      "total": 1873,
      "available": 1873,
      "missing": 0,
      "navUpdated": 7,
      "navWarnings": {},
      "returnsUpdated": 448,
      "returnsRetained": {},
      "message": "全部研究对象纳入标的库；基金收益由已校验净值曲线复算，实际日期逐项保存；费率、规模、经理及经营研究保持独立证据日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 1106.05
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-21T19:16:15+00:00",
        "records": 1873,
        "total": 1873,
        "available": 1873,
        "missing": 0,
        "navUpdated": 7,
        "navWarnings": {},
        "returnsUpdated": 448,
        "returnsRetained": {},
        "message": "全部研究对象纳入标的库；基金收益由已校验净值曲线复算，实际日期逐项保存；费率、规模、经理及经营研究保持独立证据日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 1106.05
        }
      }
    },
    "overseas_stocks": {
      "status": "success",
      "attemptedAt": "2026-10-21T18:57:01+00:00",
      "asOf": "2026-10-20",
      "records": 79,
      "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。",
      "mode": "online",
      "execution": {
        "exitCode": 0,
        "seconds": 40.81
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-10-21T18:57:01+00:00",
        "asOf": "2026-10-20",
        "records": 79,
        "message": "发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 40.81
        }
      }
    }
  },
  "checkedAt": "2026-10-21T19:16:17+00:00"
};
