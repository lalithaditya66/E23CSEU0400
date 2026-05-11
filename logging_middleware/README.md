# Logging Middleware

This folder contains a small TypeScript logger that sends real POST requests to the evaluation logging API.

## What it exports

- `Log(stack, level, packageName, message)`

## Environment variables

- `AUTH_TOKEN` - required bearer token for the logging API
- `LOGGING_TOKEN` - optional fallback if you prefer a different local variable name

## Usage

```ts
import { Log } from "./src";

await Log("backend", "info", "route", "Notification route was called");
```

The function normalizes `stack`, `level`, and `packageName` to lowercase before sending the request, then posts this body:

```json
{
  "stack": "backend",
  "level": "info",
  "package": "route",
  "message": "Notification route was called"
}
```

## Example

Run the sample script with a token already set:

```bash
AUTH_TOKEN=your_token npx ts-node examples/example.ts
```

If the request succeeds, the script prints the API response. If it fails, it returns a plain error object instead of crashing.