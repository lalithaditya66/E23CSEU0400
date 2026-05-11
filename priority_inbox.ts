import { runPriorityInbox } from "./notification_app_be/priority_inbox";

runPriorityInbox().catch((error) => {
  console.error("Unexpected priority inbox crash:", error);
});