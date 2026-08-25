import "@crm/env/load";

import { syncContractsDrive } from "../agent/lib/contracts-drive";

const result = await syncContractsDrive();
console.log(JSON.stringify(result));
