import { syncContractsDrive } from "./contracts-drive";
import { reconcileContracts } from "./contracts-reconciliation";
import { syncHubspot } from "./hubspot-sync";
import { syncPosthogLinkedUsers } from "./posthog-users";
import { syncSalesDashboard } from "./sales-dashboard";
import { syncSupportOperations } from "./support-sync";

export async function runCustomerSync() {
	const contracts = await syncContractsDrive().catch((error) => ({
		configured: true,
		error: error instanceof Error ? error.message : String(error),
	}));
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
	const support = await syncSupportOperations().catch((error) => ({
		configured: true,
		error: error instanceof Error ? error.message : String(error),
	}));
	const contractReconciliation = await reconcileContracts().catch((error) => ({
		configured: true,
		error: error instanceof Error ? error.message : String(error),
	}));
	return {
		contracts,
		contractReconciliation,
		hubspot,
		posthog,
		sales,
		support,
	};
}
