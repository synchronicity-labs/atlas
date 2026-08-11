import "@crm/env/load";

import { runCustomerSync } from "../agent/lib/customer-sync";

const result = await runCustomerSync();
console.log(JSON.stringify(result));
