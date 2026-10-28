var REFRESH_REPORT={
  "schemaVersion": 1,
  "startedAt": "2026-10-28T01:21:30+00:00",
  "mode": "online",
  "dailyMode": true,
  "steps": [
    {
      "dataset": "funds",
      "status": "completed",
      "exitCode": 0,
      "seconds": 52.82,
      "log": ".tmp-snap/refresh-funds.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false
    },
    {
      "dataset": "research_funds",
      "status": "completed",
      "exitCode": 0,
      "seconds": 2.43,
      "log": ".tmp-snap/refresh-research_funds.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false
    },
    {
      "dataset": "indices",
      "status": "completed",
      "exitCode": 0,
      "seconds": 28.65,
      "log": ".tmp-snap/refresh-indices.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false
    },
    {
      "dataset": "stocks",
      "status": "completed",
      "exitCode": 0,
      "seconds": 64.0,
      "log": ".tmp-snap/refresh-stocks.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false
    },
    {
      "dataset": "overseas_stocks",
      "status": "completed",
      "exitCode": 0,
      "seconds": 26.67,
      "log": ".tmp-snap/refresh-overseas_stocks.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false
    },
    {
      "dataset": "screening",
      "status": "completed",
      "exitCode": 0,
      "seconds": 2.58,
      "log": ".tmp-snap/refresh-screening.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false
    },
    {
      "dataset": "strategy",
      "status": "completed",
      "exitCode": 0,
      "seconds": 52.79,
      "log": ".tmp-snap/refresh-strategy.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false
    },
    {
      "dataset": "portfolio",
      "status": "timeout",
      "exitCode": 124,
      "seconds": 90.34,
      "log": ".tmp-snap/refresh-portfolio.log",
      "publishedRollback": true,
      "retainedPrevious": true,
      "sourcePartial": false
    },
    {
      "dataset": "quality",
      "status": "completed",
      "exitCode": 0,
      "seconds": 1.7,
      "log": ".tmp-snap/refresh-quality.log",
      "publishedRollback": false,
      "retainedPrevious": false,
      "sourcePartial": false
    }
  ],
  "batchFundRecords": 1683,
  "batchFundSeconds": 3.99,
  "benchmarkSync": {
    "dataset": "benchmark_sync",
    "status": "completed",
    "exitCode": 0,
    "seconds": 2.74,
    "log": ".tmp-snap/refresh-benchmark_sync.log",
    "publishedRollback": false,
    "retainedPrevious": false,
    "sourcePartial": false
  },
  "completedAt": "2026-10-28T01:24:15+00:00",
  "status": "partial"
};
