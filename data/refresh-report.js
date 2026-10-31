var REFRESH_REPORT={
  "schemaVersion": 1,
  "startedAt": "2026-10-31T01:35:53+00:00",
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
      "seconds": 41.92,
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
      "seconds": 2.46,
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
      "seconds": 13.68,
      "log": ".tmp-snap/refresh-indices.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    },
    {
      "dataset": "stocks",
      "status": "completed",
      "exitCode": 0,
      "seconds": 66.03,
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
      "seconds": 21.84,
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
      "seconds": 49.48,
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
      "seconds": 104.25,
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
      "seconds": 1.91,
      "log": ".tmp-snap/refresh-quality.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false,
      "checkpointValidated": false
    }
  ],
  "batchFundRecords": 1682,
  "batchFundSeconds": 4.17,
  "portfolioSync": {
    "dataset": "portfolio_sync",
    "status": "completed",
    "exitCode": 0,
    "seconds": 45.6,
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
    "seconds": 3.16,
    "log": ".tmp-snap/refresh-benchmark_sync.log",
    "publishedRollback": false,
    "retainedPrevious": false,
    "sourcePartial": false,
    "checkpointValidated": false
  },
  "completedAt": "2026-10-31T01:39:41+00:00",
  "status": "partial"
};
