var REFRESH_REPORT={
  "schemaVersion": 1,
  "startedAt": "2026-11-27T04:14:21+00:00",
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
      "seconds": 52.01,
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
      "seconds": 1.36,
      "log": ".tmp-snap/refresh-research_funds.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "indices",
      "status": "timeout",
      "exitCode": 124,
      "seconds": 90.09,
      "log": ".tmp-snap/refresh-indices.log",
      "publishedRollback": false,
      "retainedPrevious": true,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "stocks",
      "status": "completed",
      "exitCode": 0,
      "seconds": 72.59,
      "log": ".tmp-snap/refresh-stocks.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "overseas_stocks",
      "status": "completed",
      "exitCode": 0,
      "seconds": 30.2,
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
      "seconds": 1.41,
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
      "seconds": 28.81,
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
      "seconds": 69.12,
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
      "seconds": 1.12,
      "log": ".tmp-snap/refresh-quality.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    }
  ],
  "batchFundRecords": 1685,
  "batchFundSeconds": 3.91,
  "benchmarkSync": {
    "dataset": "benchmark_sync",
    "status": "completed",
    "exitCode": 0,
    "seconds": 2.01,
    "log": ".tmp-snap/refresh-benchmark_sync.log",
    "publishedRollback": false,
    "retainedPrevious": false,
    "sourcePartial": false,
    "checkpointValidated": false
  },
  "completedAt": "2026-11-27T04:17:10+00:00",
  "status": "partial"
};
