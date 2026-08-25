import { defineSchedule } from "eve/schedules";
import { syncPosthogLinkedUsers } from "../lib/posthog-users";

export default defineSchedule({
	cron: "47 * * * *",
	run({ waitUntil }) {
		waitUntil(syncPosthogLinkedUsers(20));
	},
});
