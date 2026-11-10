var REFRESH_REPORT={
  "schemaVersion": 1,
  "startedAt": "2026-11-10T04:06:55+00:00",
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
      "seconds": 90.13,
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
      "seconds": 2.42,
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
      "seconds": 20.86,
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
      "seconds": 90.12,
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
      "seconds": 25.19,
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
      "seconds": 2.52,
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
      "seconds": 51.52,
      "log": ".tmp-snap/refresh-strategy.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "portfolio",
      "status": "partial",
      "exitCode": 124,
      "seconds": 104.53,
      "log": ".tmp-snap/refresh-portfolio.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": true,
      "checkpointValidated": true
    },
    {
      "dataset": "quality",
      "status": "completed",
      "exitCode": 0,
      "seconds": 1.86,
      "log": ".tmp-snap/refresh-quality.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    }
  ],
  "batchFundRecords": 1683,
  "batchFundSeconds": 4.28,
  "portfolioSync": {
    "dataset": "portfolio_sync",
    "status": "completed",
    "exitCode": 0,
    "seconds": 46.6,
    "log": ".tmp-snap/refresh-portfolio_sync.log",
    "publishedRollback": false,
    "retainedPrevious": false,
    "sourcePartial": false,
    "checkpointValidated": false
  },
  "benchmarkSync": {
    "dataset": "benchmark_sync",
    "status": "completed",
    "exitCode": 0,
    "seconds": 3.06,
    "log": ".tmp-snap/refresh-benchmark_sync.log",
    "publishedRollback": false,
    "retainedPrevious": false,
    "sourcePartial": false,
    "checkpointValidated": false
  },
  "completedAt": "2026-11-10T04:11:09+00:00",
  "status": "partial"
};
