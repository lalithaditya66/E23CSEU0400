import { runVehicleScheduling } from "./vehicle_scheduling/scheduler";

runVehicleScheduling().catch((error) => {
  console.error("Unexpected vehicle scheduling crash:", error);
});