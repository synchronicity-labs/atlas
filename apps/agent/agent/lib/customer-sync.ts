import { syncHubspotSales } from "./hubspot-sync";
import { syncSalesDashboard } from "./sales-dashboard";

export async function runCustomerSync() {
	const hubspot = await syncHubspotSales().catch((error) => ({
		configured: true,
		error: error instanceof Error ? error.message : String(error),
	}));
	const sales = await syncSalesDashboard().catch((error) => ({
		configured: true,
		error: error instanceof Error ? error.message : String(error),
	}));
	return { hubspot, sales };
}
