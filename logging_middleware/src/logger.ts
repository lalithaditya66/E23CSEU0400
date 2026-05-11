export type LogStack = "backend" | "frontend";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type BackendPackage =
  | "cache"
  | "controller"
  | "cron_job"
  | "db"
  | "domain"
  | "handler"
  | "repository"
  | "route"
  | "service";

export type FrontendPackage = "api" | "component" | "hook" | "page" | "state" | "style";

export type SharedPackage = "auth" | "config" | "middleware" | "utils";

export type LogPackage = BackendPackage | FrontendPackage | SharedPackage;

declare const process: {
  env: Record<string, string | undefined>;
};

import { getAuthToken } from "./auth";
const DEBUG = process.env.DEBUG === "true";

export interface LogRequestPayload {
  stack: LogStack;
  level: LogLevel;
  package: LogPackage;
  message: string;
}

export interface LogResult {
  success: boolean;
  status?: number;
  response?: unknown;
  error?: string;
}

const LOG_API_URL = "http://4.224.186.213/evaluation-service/logs";
const MAX_LOG_MESSAGE_LENGTH = 48;

const allowedStacks: LogStack[] = ["backend", "frontend"];
const allowedLevels: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];

const backendPackages: BackendPackage[] = [
  "cache",
  "controller",
  "cron_job",
  "db",
  "domain",
  "handler",
  "repository",
  "route",
  "service",
];

const frontendPackages: FrontendPackage[] = ["api", "component", "hook", "page", "state", "style"];

const sharedPackages: SharedPackage[] = ["auth", "config", "middleware", "utils"];

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function isAllowedStack(value: string): value is LogStack {
  return allowedStacks.includes(value as LogStack);
}

function isAllowedLevel(value: string): value is LogLevel {
  return allowedLevels.includes(value as LogLevel);
}

function isAllowedPackage(value: string, stack: LogStack): value is LogPackage {
  if (sharedPackages.includes(value as SharedPackage)) {
    return true;
  }

  if (stack === "backend") {
    return backendPackages.includes(value as BackendPackage);
  }

  return frontendPackages.includes(value as FrontendPackage);
}

function printDebugLoggingResponse(status: number, headers: Headers, payload: unknown): void {
  if (!DEBUG) {
    return;
  }

  const headerSnapshot = {
    contentType: headers.get("content-type"),
    cacheControl: headers.get("cache-control"),
    requestId: headers.get("x-request-id") ?? headers.get("x-correlation-id"),
  };

  console.log("\n[DEBUG] Logging API response");
  console.log(`STATUS: ${status}`);
  console.log("HEADERS:");
  console.log(JSON.stringify(headerSnapshot, null, 2));
  console.log("PAYLOAD:");
  console.log(JSON.stringify(payload, null, 2));
}

export async function Log(
  stack: string,
  level: string,
  packageName: string,
  message: string,
): Promise<LogResult> {
  const normalizedStack = normalizeValue(stack);
  const normalizedLevel = normalizeValue(level);
  const normalizedPackage = normalizeValue(packageName);
  const cleanMessage = message.trim();
  const safeMessage =
    cleanMessage.length > MAX_LOG_MESSAGE_LENGTH
      ? `${cleanMessage.slice(0, MAX_LOG_MESSAGE_LENGTH - 3)}...`
      : cleanMessage;

  if (!safeMessage) {
    return { success: false, error: "message cannot be empty" };
  }

  if (!isAllowedStack(normalizedStack)) {
    return { success: false, error: `invalid stack: ${stack}` };
  }

  if (!isAllowedLevel(normalizedLevel)) {
    return { success: false, error: `invalid level: ${level}` };
  }

  if (!isAllowedPackage(normalizedPackage, normalizedStack)) {
    return { success: false, error: `invalid package for ${normalizedStack}: ${packageName}` };
  }

  const authToken = await getAuthToken();
  if (!authToken) {
    return { success: false, error: "AUTH_TOKEN is missing from the environment" };
  }

  const payload: LogRequestPayload = {
    stack: normalizedStack,
    level: normalizedLevel,
    package: normalizedPackage,
    message: safeMessage,
  };

  try {
    let response = await fetch(LOG_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      const refreshedToken = await getAuthToken(true);
      if (refreshedToken && refreshedToken !== authToken) {
        response = await fetch(LOG_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${refreshedToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      }
    }

    const responseText = await response.text();
    const parsedResponse = responseText ? tryParseJson(responseText) : null;
    printDebugLoggingResponse(response.status, response.headers, parsedResponse ?? responseText);

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: typeof parsedResponse === "string" ? parsedResponse : responseText || response.statusText,
      };
    }

    return {
      success: true,
      status: response.status,
      response: parsedResponse ?? responseText,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown logging failure";
    return { success: false, error: reason };
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}