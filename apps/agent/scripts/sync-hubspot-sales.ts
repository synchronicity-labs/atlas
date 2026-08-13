import "@crm/env/load";

import { syncHubspotSales } from "../agent/lib/hubspot-sync";

const maxPages = Number(process.argv[2] ?? "10");
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
	throw new Error("Page limit must be an integer from 1 through 100.");
}

const result = await syncHubspotSales(maxPages);
console.log(JSON.stringify(result));
