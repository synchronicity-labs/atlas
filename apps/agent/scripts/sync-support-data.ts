import "@crm/env/load";
import { syncSupportOperations } from "../agent/lib/support-sync";

const result = await syncSupportOperations();
process.stdout.write(`${JSON.stringify(result)}\n`);
