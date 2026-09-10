import { defineSchedule } from "eve/schedules";
import { syncSupportOperations } from "../lib/support-sync";

export default defineSchedule({
	cron: "27 */3 * * *",
	run({ waitUntil }) {
		waitUntil(syncSupportOperations());
	},
});
