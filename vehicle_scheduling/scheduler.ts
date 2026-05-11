import { getAuthToken, Log } from "../logging_middleware/src/index";

declare const process: {
  env: Record<string, string | undefined>;
};

interface DepotItem {
  id: number;
  mechanicHours: number;
}

interface VehicleTask {
  taskId: string;
  duration: number;
  impact: number;
}

interface ApiDepotItem {
  id?: unknown;
  ID?: unknown;
  mechanicHours?: unknown;
  MechanicHours?: unknown;
}

interface ApiVehicleItem {
  taskId?: unknown;
  TaskID?: unknown;
  duration?: unknown;
  Duration?: unknown;
  impact?: unknown;
  Impact?: unknown;
}

interface KnapsackResult {
  selectedTasks: VehicleTask[];
  hoursUsed: number;
  totalImpact: number;
}

const DEPOTS_API_URL = "http://4.224.186.213/evaluation-service/depots";
const VEHICLES_API_URL = "http://4.224.186.213/evaluation-service/vehicles";
const MAX_API_ATTEMPTS = 2;
const DEBUG = process.env.DEBUG === "true";

function readNumberField(item: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }

  return null;
}

function readStringField(item: Record<string, unknown>, keys: string[]): string | null {
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

function parseDepotItem(item: Record<string, unknown>): DepotItem | null {
  const id = readNumberField(item, ["id", "ID"]);
  const mechanicHours = readNumberField(item, ["mechanicHours", "MechanicHours"]);

  if (id === null || mechanicHours === null) {
    return null;
  }

  return { id, mechanicHours };
}

function parseVehicleItem(item: Record<string, unknown>): VehicleTask | null {
  const taskId = readStringField(item, ["taskId", "TaskID"]);
  const duration = readNumberField(item, ["duration", "Duration"]);
  const impact = readNumberField(item, ["impact", "Impact"]);

  if (!taskId || duration === null || impact === null) {
    return null;
  }

  return { taskId, duration, impact };
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

function extractCollection(payload: unknown, label: string): Record<string, unknown>[] {
  const candidatePaths: string[][] = [
    [],
    [label],
    ["data"],
    ["items"],
    ["result"],
    ["results"],
    ["payload"],
    ["data", label],
    ["payload", label],
  ];

  for (const path of candidatePaths) {
    let candidate: unknown[] | null = null;

    if (path.length === 0) {
      candidate = Array.isArray(payload) ? payload : null;
    } else {
      candidate = readArrayByPath(payload, path);
    }

    if (candidate) {
      if (DEBUG) {
        console.log(`[DEBUG] ${label} extracted from path: ${path.length ? path.join(".") : "root"}`);
      }
      return candidate.filter(
        (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
      );
    }
  }

  return [];
}

async function fetchJson(url: string): Promise<unknown> {
  let lastError: Error | null = null;
  let triedRefresh = false;

  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    const authToken = await getAuthToken(triedRefresh);

    if (!authToken) {
      throw new Error("AUTH_TOKEN is missing");
    }

    try {
      await Log("backend", "info", "service", `Calling ${url} (attempt ${attempt})`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        await Log("backend", "info", "service", `Request succeeded for ${url} on attempt ${attempt}`);
        const payload = (await response.json()) as unknown;
        printDebugApiResponse(url, response.status, response.headers, payload);
        return payload;
      }

      const errorText = await response.text();

      if (response.status === 401 && attempt < MAX_API_ATTEMPTS) {
        await Log("backend", "warn", "service", `Unauthorized response from ${url}, retrying once`);
        lastError = new Error(`unauthorized: ${errorText || response.statusText}`);
        triedRefresh = true;
        continue;
      }

      throw new Error(`request failed for ${url} with ${response.status}: ${errorText || response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("unknown API failure");

      if (attempt < MAX_API_ATTEMPTS) {
        await Log("backend", "warn", "service", `Attempt ${attempt} failed for ${url}: ${lastError.message}`);
        triedRefresh = true;
        continue;
      }
    }
  }

  throw lastError ?? new Error(`request failed for ${url}`);
}

function toArray(payload: unknown): Record<string, unknown>[] {
  return extractCollection(payload, "items");
}

function solveKnapsack(capacity: number, tasks: VehicleTask[]): KnapsackResult {
  const count = tasks.length;
  const dp: number[][] = Array.from({ length: count + 1 }, () => Array(capacity + 1).fill(0));

  for (let index = 1; index <= count; index++) {
    const task = tasks[index - 1];

    for (let hours = 0; hours <= capacity; hours++) {
      if (task.duration > hours) {
        dp[index][hours] = dp[index - 1][hours];
        continue;
      }

      const includeTask = task.impact + dp[index - 1][hours - task.duration];
      const excludeTask = dp[index - 1][hours];
      dp[index][hours] = Math.max(includeTask, excludeTask);
    }
  }

  const selectedTasks: VehicleTask[] = [];
  let remainingHours = capacity;

  for (let index = count; index > 0; index--) {
    if (dp[index][remainingHours] !== dp[index - 1][remainingHours]) {
      const task = tasks[index - 1];
      selectedTasks.push(task);
      remainingHours -= task.duration;
    }
  }

  selectedTasks.reverse();

  const hoursUsed = selectedTasks.reduce((sum, task) => sum + task.duration, 0);
  const totalImpact = selectedTasks.reduce((sum, task) => sum + task.impact, 0);

  return { selectedTasks, hoursUsed, totalImpact };
}

function printDepotResult(depot: DepotItem, result: KnapsackResult): void {
  console.log("");
  console.log(`Depot ID: ${depot.id}`);
  console.log(`Budget: ${depot.mechanicHours} hours`);
  console.log(`Selected Tasks: [${result.selectedTasks.map((task) => task.taskId).join(", ")}]`);
  console.log(`Hours Used: ${result.hoursUsed} / ${depot.mechanicHours}`);
  console.log(`Total Impact: ${result.totalImpact}`);
  console.log("----------------------------------------");
}

export async function runVehicleScheduling(): Promise<void> {
  try {
    await Log("backend", "info", "service", "Vehicle scheduling run started");

    const [depotsPayload, vehiclesPayload] = await Promise.all([
      fetchJson(DEPOTS_API_URL),
      fetchJson(VEHICLES_API_URL),
    ]);

    const depotCandidates = extractCollection(depotsPayload, "depots");
    const taskCandidates = extractCollection(vehiclesPayload, "vehicles");

    const depots: DepotItem[] = [];
    const rejectedDepots: Record<string, unknown>[] = [];

    for (const depotCandidate of depotCandidates) {
      const mappedDepot = parseDepotItem(depotCandidate);
      if (mappedDepot) {
        depots.push(mappedDepot);
      } else {
        rejectedDepots.push(depotCandidate);
      }
    }

    const tasks: VehicleTask[] = [];
    const rejectedTasks: Record<string, unknown>[] = [];

    for (const taskCandidate of taskCandidates) {
      const mappedTask = parseVehicleItem(taskCandidate);
      if (mappedTask) {
        tasks.push(mappedTask);
      } else {
        rejectedTasks.push(taskCandidate);
      }
    }

    if (DEBUG) {
      console.log("\n[DEBUG] parsing checkpoint");
      console.log(`Depot candidates: ${depotCandidates.length}, mapped: ${depots.length}, rejected: ${rejectedDepots.length}`);
      console.log(`Task candidates: ${taskCandidates.length}, mapped: ${tasks.length}, rejected: ${rejectedTasks.length}`);

      if (depots.length > 0) {
        console.log("[DEBUG] sample mapped depot");
        console.log(JSON.stringify(depots[0], null, 2));
      }
      if (tasks.length > 0) {
        console.log("[DEBUG] sample mapped task");
        console.log(JSON.stringify(tasks[0], null, 2));
      }
      if (rejectedDepots.length > 0) {
        console.log("[DEBUG] sample rejected depot");
        console.log(JSON.stringify(rejectedDepots[0], null, 2));
      }
      if (rejectedTasks.length > 0) {
        console.log("[DEBUG] sample rejected task");
        console.log(JSON.stringify(rejectedTasks[0], null, 2));
      }
    }

    if (depots.length === 0 || tasks.length === 0) {
      throw new Error("invalid depot or vehicle data returned by the API");
    }

    await Log("backend", "info", "service", `Loaded ${depots.length} depots and ${tasks.length} tasks`);

    for (const depot of depots) {
      await Log("backend", "debug", "service", `Starting DP processing for depot ${depot.id}`);
      const result = solveKnapsack(depot.mechanicHours, tasks);

      printDepotResult(depot, result);

      await Log(
        "backend",
        "info",
        "service",
        `Depot ${depot.id} scheduled with ${result.selectedTasks.length} tasks and impact ${result.totalImpact}`,
      );
    }

    console.log("");
    console.log(`Processed ${depots.length} depots in total.`);
    console.log("========================================");

    await Log("backend", "info", "service", "Vehicle scheduling output generated successfully");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown vehicle scheduling failure";
    console.error("Vehicle scheduling failed:", reason);
    await Log("backend", "error", "service", `Vehicle scheduling failed: ${reason}`);
  }
}