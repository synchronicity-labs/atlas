import { defineSchedule } from "eve/schedules";
import { runCustomerSync } from "../lib/customer-sync";

export default defineSchedule({
	cron: "17 */6 * * *",
	run({ waitUntil }) {
		waitUntil(runCustomerSync());
	},
});
