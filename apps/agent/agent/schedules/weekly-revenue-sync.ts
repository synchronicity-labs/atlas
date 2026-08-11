import { defineSchedule } from "eve/schedules";
import { syncWeeklyRevenueDashboard } from "../lib/weekly-revenue-sync";

export default defineSchedule({
	cron: "7 */8 * * *",
	run({ waitUntil }) {
		waitUntil(syncWeeklyRevenueDashboard());
	},
});
