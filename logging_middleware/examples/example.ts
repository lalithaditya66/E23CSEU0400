import { Log } from "../src";

async function runExample(): Promise<void> {
  const result = await Log("backend", "info", "middleware", "Logger example ran successfully");

  if (result.success) {
    console.log("Log sent successfully.");
    console.log(result);
    return;
  }

  console.error("Log failed.");
  console.error(result);
}

runExample().catch((error) => {
  console.error("Unexpected example failure:", error);
});