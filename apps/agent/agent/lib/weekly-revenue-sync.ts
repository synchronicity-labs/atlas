export async function syncWeeklyRevenueDashboard() {
	const baseUrl = process.env.API_URL?.trim().replace(/\/$/, "");
	const secret = process.env.CRON_SECRET?.trim();
	if (!baseUrl || !secret) return { configured: false };

	const response = await fetch(`${baseUrl}/internal/sync/atlas/7`, {
		method: "POST",
		headers: { authorization: `Bearer ${secret}` },
	});
	if (!response.ok) {
		throw new Error(`Weekly Revenue Lite sync failed with ${response.status}.`);
	}
	return { configured: true, result: await response.json() };
}
