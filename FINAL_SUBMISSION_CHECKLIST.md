# Final Submission Checklist

## Overall Status

Core implementation is complete and live API execution is working.

## Verified Complete

- Logging middleware implemented with real POST calls, bearer token, lowercase enum normalization, validation, and 401 retry.
- Stage 1 to Stage 6 design writeup is complete.
- Priority Inbox logic implemented with:
  - scoring formula using type weight + timestamp
  - min-heap based top 10 selection
  - terminal output showing Type, Message, Timestamp, Score
- Vehicle Scheduling logic implemented with:
  - dynamic programming knapsack approach
  - live depots and vehicles API parsing
  - per-depot output showing Depot ID, Budget, Selected Tasks, Hours Used, Total Impact
- Debug mode support implemented for notifications, depots, vehicles, and logging API responses.

## Latest Runtime Verification (May 11, 2026)

- `priority_inbox.ts` executed successfully and printed Top 10 notifications.
- `vehicle_scheduling.ts` executed successfully and printed depot scheduling blocks.

## Remaining Manual Step

- Capture and place these two screenshots:
  - `screenshots/stage6_priority_inbox_output.png`
  - `screenshots/vehicle_scheduling_output.png`

These image paths are already referenced in `notification_system_design.md`.

## Exact Commands To Reproduce Output (PowerShell)

```powershell
$env:DEBUG='true'
Get-Content .env | ForEach-Object {
  if ($_ -match '^\$env:([^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
npm exec --yes --package ts-node@10.9.2 --package typescript@5.8.3 -- ts-node --project tsconfig.json priority_inbox.ts
npm exec --yes --package ts-node@10.9.2 --package typescript@5.8.3 -- ts-node --project tsconfig.json vehicle_scheduling.ts
```
