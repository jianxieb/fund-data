var REFRESH_REPORT={
  "schemaVersion": 1,
  "startedAt": "2026-11-07T01:55:46+00:00",
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
      "status": "completed",
      "exitCode": 0,
      "seconds": 58.08,
      "log": ".tmp-snap/refresh-funds.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "research_funds",
      "status": "completed",
      "exitCode": 0,
      "seconds": 1.34,
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
      "seconds": 19.82,
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
      "seconds": 90.33,
      "log": ".tmp-snap/refresh-stocks.log",
      "publishedRollback": true,
      "retainedPrevious": true,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "overseas_stocks",
      "status": "completed",
      "exitCode": 0,
      "seconds": 31.66,
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
      "seconds": 1.42,
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
      "seconds": 28.22,
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
      "seconds": 73.74,
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
      "seconds": 1.15,
      "log": ".tmp-snap/refresh-quality.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    }
  ],
  "batchFundRecords": 1682,
  "batchFundSeconds": 4.36,
  "benchmarkSync": {
    "dataset": "benchmark_sync",
    "status": "completed",
    "exitCode": 0,
    "seconds": 1.97,
    "log": ".tmp-snap/refresh-benchmark_sync.log",
    "publishedRollback": false,
    "retainedPrevious": false,
    "sourcePartial": false,
    "checkpointValidated": false
  },
  "completedAt": "2026-11-07T01:58:40+00:00",
  "status": "partial"
};
