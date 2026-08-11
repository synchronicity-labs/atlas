import { syncHubspot } from "./hubspot-sync";
import { syncPosthogLinkedUsers } from "./posthog-users";
import { syncSalesDashboard } from "./sales-dashboard";

export async function runCustomerSync() {
	const hubspot = await syncHubspot().catch((error) => ({
		configured: true,
		error: error instanceof Error ? error.message : String(error),
	}));
	const posthog = await syncPosthogLinkedUsers().catch((error) => ({
		configured: true,
		error: error instanceof Error ? error.message : String(error),
	}));
	const sales = await syncSalesDashboard().catch((error) => ({
		configured: true,
		error: error instanceof Error ? error.message : String(error),
	}));
	return { hubspot, posthog, sales };
}
