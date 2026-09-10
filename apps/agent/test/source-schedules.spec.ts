import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("support runs independently without reducing existing PostHog coverage", () => {
	const read = (path: string) =>
		readFileSync(new URL(`../agent/${path}`, import.meta.url), "utf8");
	const customer = read("lib/customer-sync.ts");
	expect(customer).toContain("await syncPosthogLinkedUsers()");
	expect(customer).not.toContain("syncSupportOperations");
	const support = read("schedules/support-sync.ts");
	expect(support).toContain('cron: "27 */3 * * *"');
	expect(support).toContain("waitUntil(syncSupportOperations())");
	const posthog = read("schedules/posthog-user-sync.ts");
	expect(posthog).toContain('cron: "47 * * * *"');
	expect(posthog).toContain("waitUntil(syncPosthogLinkedUsers(20))");
});
