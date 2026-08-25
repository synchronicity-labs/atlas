import { reconcileContracts } from "../agent/lib/contracts-reconciliation";

const result = await reconcileContracts();
console.log(JSON.stringify(result));
