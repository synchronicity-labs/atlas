import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("support and PostHog have independent schedules instead of waiting behind customer sync", () => {
	const read = (path: string) =>
		readFileSync(new URL(`../agent/${path}`, import.meta.url), "utf8");
	const customer = read("lib/customer-sync.ts");
	expect(customer).not.toContain("syncPosthogLinkedUsers");
	expect(customer).not.toContain("syncSupportOperations");
	const support = read("schedules/support-sync.ts");
	expect(support).toContain('cron: "27 */3 * * *"');
	expect(support).toContain("waitUntil(syncSupportOperations())");
	const posthog = read("schedules/posthog-user-sync.ts");
	expect(posthog).toContain('cron: "47 * * * *"');
	expect(posthog).toContain("waitUntil(syncPosthogLinkedUsers(20))");
});
