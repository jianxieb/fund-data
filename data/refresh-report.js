var REFRESH_REPORT={
  "schemaVersion": 1,
  "startedAt": "2026-11-26T04:09:20+00:00",
  "mode": "online",
  "dailyMode": true,
  "scope": "all",
  "datasets": [
    "funds",
    "research_funds",
    "indices",
    "stocks",
    "overseas_stocks",
    "screening",
    "strategy",
    "portfolio",
    "quality"
  ],
  "steps": [
    {
      "dataset": "funds",
      "status": "timeout",
      "exitCode": 124,
      "seconds": 90.02,
      "log": ".tmp-snap/refresh-funds.log",
      "publishedRollback": false,
      "retainedPrevious": true,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "research_funds",
      "status": "completed",
      "exitCode": 0,
      "seconds": 1.47,
      "log": ".tmp-snap/refresh-research_funds.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "indices",
      "status": "completed",
      "exitCode": 0,
      "seconds": 63.8,
      "log": ".tmp-snap/refresh-indices.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "stocks",
      "status": "timeout",
      "exitCode": 124,
      "seconds": 90.24,
      "log": ".tmp-snap/refresh-stocks.log",
      "publishedRollback": false,
      "retainedPrevious": true,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "overseas_stocks",
      "status": "completed",
      "exitCode": 0,
      "seconds": 20.42,
      "log": ".tmp-snap/refresh-overseas_stocks.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "screening",
      "status": "completed",
      "exitCode": 0,
      "seconds": 1.52,
      "log": ".tmp-snap/refresh-screening.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "strategy",
      "status": "completed",
      "exitCode": 0,
      "seconds": 35.28,
      "log": ".tmp-snap/refresh-strategy.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "portfolio",
      "status": "completed",
      "exitCode": 0,
      "seconds": 69.23,
      "log": ".tmp-snap/refresh-portfolio.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "quality",
      "status": "completed",
      "exitCode": 0,
      "seconds": 1.28,
      "log": ".tmp-snap/refresh-quality.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    }
  ],
  "batchFundRecords": 1685,
  "batchFundSeconds": 5.74,
  "benchmarkSync": {
    "dataset": "benchmark_sync",
    "status": "completed",
    "exitCode": 0,
    "seconds": 2.11,
    "log": ".tmp-snap/refresh-benchmark_sync.log",
    "publishedRollback": false,
    "retainedPrevious": false,
    "sourcePartial": false,
    "checkpointValidated": false
  },
  "completedAt": "2026-11-26T04:12:10+00:00",
  "status": "partial"
};
