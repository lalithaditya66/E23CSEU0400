import { getAuthToken, Log } from "../logging_middleware/src/index";

declare const process: {
  env: Record<string, string | undefined>;
};

type NotificationType = "Placement" | "Result" | "Event";

interface RawNotification {
  [key: string]: unknown;
}

interface NotificationItem {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: string;
  score: number;
}

interface ApiResponseItem {
  id?: unknown;
  ID?: unknown;
  type?: unknown;
  Type?: unknown;
  message?: unknown;
  Message?: unknown;
  timestamp?: unknown;
  Timestamp?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
}

const NOTIFICATION_API_URL = "http://4.224.186.213/evaluation-service/notifications";
const SCORE_SCALE = 1_000_000_000_000;
const TOP_LIMIT = 10;
const MAX_API_ATTEMPTS = 2;
const DEBUG = process.env.DEBUG === "true";

const typeWeights: Record<NotificationType, number> = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

class MinHeap<T> {
  private items: T[] = [];

  constructor(private readonly compare: (left: T, right: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(value: T): void {
    this.items.push(value);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) {
      return undefined;
    }

    const root = this.items[0];
    const last = this.items.pop();

    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      this.bubbleDown(0);
    }

    return root;
  }

  toArray(): T[] {
    return [...this.items];
  }

  private bubbleUp(index: number): void {
    let childIndex = index;

    while (childIndex > 0) {
      const parentIndex = Math.floor((childIndex - 1) / 2);
      if (this.compare(this.items[childIndex], this.items[parentIndex]) >= 0) {
        break;
      }

      [this.items[childIndex], this.items[parentIndex]] = [this.items[parentIndex], this.items[childIndex]];
      childIndex = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    let parentIndex = index;

    while (true) {
      const leftIndex = parentIndex * 2 + 1;
      const rightIndex = parentIndex * 2 + 2;
      let smallest = parentIndex;

      if (leftIndex < this.items.length && this.compare(this.items[leftIndex], this.items[smallest]) < 0) {
        smallest = leftIndex;
      }

      if (rightIndex < this.items.length && this.compare(this.items[rightIndex], this.items[smallest]) < 0) {
        smallest = rightIndex;
      }

      if (smallest === parentIndex) {
        break;
      }

      [this.items[parentIndex], this.items[smallest]] = [this.items[smallest], this.items[parentIndex]];
      parentIndex = smallest;
    }
  }
}

function normalizeNotificationType(value: unknown): NotificationType | null {
  if (value === "Placement" || value === "Result" || value === "Event") {
    return value;
  }

  return null;
}

function readStringField(item: ApiResponseItem, keys: Array<keyof ApiResponseItem>): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function toUnixTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  return 0;
}

function calculateScore(type: NotificationType, timestamp: string): number {
  return typeWeights[type] * SCORE_SCALE + toUnixTimestamp(timestamp);
}

function printDebugApiResponse(url: string, status: number, headers: Headers, payload: unknown): void {
  if (!DEBUG) {
    return;
  }

  const headerSnapshot = {
    contentType: headers.get("content-type"),
    cacheControl: headers.get("cache-control"),
    requestId: headers.get("x-request-id") ?? headers.get("x-correlation-id"),
  };

  console.log("\n[DEBUG] API Response");
  console.log(`URL: ${url}`);
  console.log(`STATUS: ${status}`);
  console.log("HEADERS:");
  console.log(JSON.stringify(headerSnapshot, null, 2));
  console.log("PAYLOAD:");
  console.log(JSON.stringify(payload, null, 2));
}

function readArrayByPath(payload: unknown, path: string[]): unknown[] | null {
  let current: unknown = payload;

  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return null;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return Array.isArray(current) ? current : null;
}

function extractNotificationCollection(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const candidatePaths: string[][] = [
    ["data"],
    ["data", "notifications"],
    ["notifications"],
    ["items"],
    ["result"],
    ["results"],
    ["payload"],
    ["payload", "notifications"],
  ];

  for (const path of candidatePaths) {
    const collection = readArrayByPath(payload, path);
    if (collection) {
      if (DEBUG) {
        console.log(`[DEBUG] notifications extracted from path: ${path.join(".")}`);
      }
      return collection;
    }
  }

  return [];
}

async function fetchJsonWithRetry(url: string): Promise<unknown> {
  let lastError: Error | null = null;
  let triedRefresh = false;

  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    const authToken = await getAuthToken(triedRefresh);

    if (!authToken) {
      throw new Error("AUTH_TOKEN is missing");
    }

    try {
      await Log("backend", "info", "service", `Calling notifications API (attempt ${attempt})`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        await Log("backend", "info", "service", `Notifications API succeeded on attempt ${attempt}`);
        const payload = (await response.json()) as unknown;
        printDebugApiResponse(url, response.status, response.headers, payload);
        return payload;
      }

      const errorText = await response.text();

      if (response.status === 401 && attempt < MAX_API_ATTEMPTS) {
        await Log("backend", "warn", "service", "Notifications API returned 401, retrying with the current token");
        lastError = new Error(`unauthorized: ${errorText || response.statusText}`);
        triedRefresh = true;
        continue;
      }

      throw new Error(`notification API failed with ${response.status}: ${errorText || response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("unknown notification API failure");

      if (attempt < MAX_API_ATTEMPTS) {
        await Log("backend", "warn", "service", `Notifications API attempt ${attempt} failed: ${lastError.message}`);
        triedRefresh = true;
        continue;
      }
    }
  }

  throw lastError ?? new Error("notification API failed after retries");
}

function toNotificationItem(raw: RawNotification): NotificationItem | null {
  const item = raw as ApiResponseItem;
  const type = normalizeNotificationType(item.type ?? item.Type);
  const id = readStringField(item, ["id", "ID"]);
  const message = readStringField(item, ["message", "Message"]) ?? "";
  const timestamp =
    readStringField(item, ["timestamp", "Timestamp", "createdAt", "created_at"]) ?? "";

  if (!type || !id || !message || !timestamp) {
    return null;
  }

  return {
    id,
    type,
    message,
    timestamp,
    score: calculateScore(type, timestamp),
  };
}

async function fetchNotifications(): Promise<RawNotification[]> {
  await Log("backend", "info", "service", "Priority inbox request started");

  const payload = await fetchJsonWithRetry(NOTIFICATION_API_URL);
  const list = extractNotificationCollection(payload);

  await Log("backend", "info", "service", `Fetched ${list.length} notifications for priority inbox`);

  if (DEBUG) {
    console.log(`[DEBUG] notifications array length: ${list.length}`);
  }

  return list.filter((value): value is RawNotification => typeof value === "object" && value !== null);
}

function printNotificationCard(item: NotificationItem, index: number): void {
  console.log(`${index + 1}. ${item.type}`);
  console.log(`   Message : ${item.message}`);
  console.log(`   Time    : ${item.timestamp}`);
  console.log(`   Score   : ${item.score}`);
}

function keepTopNotifications(items: NotificationItem[]): NotificationItem[] {
  const heap = new MinHeap<NotificationItem>((left, right) => left.score - right.score);

  for (const item of items) {
    if (heap.size < TOP_LIMIT) {
      heap.push(item);
      continue;
    }

    const weakest = heap.peek();
    if (weakest && item.score > weakest.score) {
      heap.pop();
      heap.push(item);
    }
  }

  const sorted: NotificationItem[] = [];
  while (heap.size > 0) {
    const nextItem = heap.pop();
    if (nextItem) {
      sorted.push(nextItem);
    }
  }

  return sorted.sort((left, right) => right.score - left.score);
}

export async function runPriorityInbox(): Promise<void> {
  try {
    const rawNotifications = await fetchNotifications();
    const parsedNotifications: NotificationItem[] = [];
    const rejectedNotifications: RawNotification[] = [];

    for (const rawNotification of rawNotifications) {
      const mapped = toNotificationItem(rawNotification);
      if (mapped) {
        parsedNotifications.push(mapped);
      } else {
        rejectedNotifications.push(rawNotification);
      }
    }

    if (DEBUG) {
      console.log("[DEBUG] parsing checkpoint");
      console.log(`Raw notifications: ${rawNotifications.length}`);
      console.log(`Mapped notifications: ${parsedNotifications.length}`);
      console.log(`Rejected notifications: ${rejectedNotifications.length}`);
      if (parsedNotifications.length > 0) {
        console.log("[DEBUG] sample mapped notification");
        console.log(JSON.stringify(parsedNotifications[0], null, 2));
      }
      if (rejectedNotifications.length > 0) {
        console.log("[DEBUG] sample rejected notification");
        console.log(JSON.stringify(rejectedNotifications[0], null, 2));
      }
    }

    const notifications = parsedNotifications;

    if (notifications.length === 0) {
      console.log("No valid notifications were returned by the API.");
      if (rawNotifications.length > 0) {
        console.log("Received data but required fields were missing for mapping.");
      }
      await Log("backend", "warn", "service", "Priority inbox received no valid notifications");
      return;
    }

    const topNotifications = keepTopNotifications(notifications);

    await Log("backend", "info", "service", "Preparing priority inbox output");

    console.log("");
    console.log("========================================");
    console.log("   Top 10 Priority Notifications");
    console.log("========================================");

    topNotifications.forEach((item, index) => {
      printNotificationCard(item, index);
      if (index < topNotifications.length - 1) {
        console.log("   ------------------------------------");
      }
    });

    console.log("========================================");
    console.log(`Total shown: ${topNotifications.length}`);
    console.log("========================================");

    await Log("backend", "info", "service", `Displayed ${topNotifications.length} priority notifications`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown priority inbox failure";
    console.error("Priority inbox failed:", reason);
    await Log("backend", "error", "service", `Priority inbox failed: ${reason}`);
  }
}