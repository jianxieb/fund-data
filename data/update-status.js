var UPDATE_STATUS={
  "schemaVersion": 1,
  "datasets": {
    "strategy": {
      "status": "success",
      "attemptedAt": "2026-09-23T15:09:51+00:00",
      "asOf": "2026-09-21",
      "records": 288,
      "basis": "provider_adjusted_close"
    },
    "funds": {
      "status": "cached",
      "attemptedAt": "2026-09-21T15:52:29+00:00",
      "asOf": "2026-09-18",
      "records": 46,
      "requested": 46,
      "failures": [],
      "mode": "offline",
      "execution": {
        "exitCode": 0,
        "seconds": 1.55
      }
    },
    "indices": {
      "status": "cached",
      "attemptedAt": "2026-09-21T15:52:30+00:00",
      "exitCode": 0,
      "seconds": 0.09,
      "mode": "offline",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。"
    },
    "stocks": {
      "status": "cached",
      "attemptedAt": "2026-09-21T15:52:30+00:00",
      "records": 23,
      "asOf": "2026-09-21",
      "message": "仅保留股票快照；未下载或重算历史，复权口径尚需独立核验。",
      "mode": "offline",
      "execution": {
        "exitCode": 0,
        "seconds": 0.06
      },
      "lastOnlineAttempt": {
        "status": "success",
        "attemptedAt": "2026-09-21T13:54:02+00:00",
        "records": 23,
        "failures": [],
        "asOf": "2026-09-21",
        "mode": "online",
        "execution": {
          "exitCode": 0,
          "seconds": 52.93
        }
      }
    },
    "screening": {
      "status": "checked",
      "attemptedAt": "2026-09-21T15:58:14+00:00",
      "exitCode": 0,
      "seconds": 0.45,
      "mode": "offline",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。"
    },
    "quality": {
      "status": "checked",
      "attemptedAt": "2026-09-23T02:50:50+00:00",
      "exitCode": 0,
      "seconds": 0.2,
      "mode": "offline",
      "message": "执行成功；数据准确性与日期由质量报告单独说明。",
      "lastOnlineAttempt": {
        "status": "checked",
        "attemptedAt": "2026-09-21T13:54:02+00:00",
        "exitCode": 0,
        "seconds": 0.11,
        "mode": "online",
        "message": "执行成功；数据准确性与日期由质量报告单独说明。"
      }
    }
  },
  "checkedAt": "2026-09-23T15:09:51+00:00"
};
