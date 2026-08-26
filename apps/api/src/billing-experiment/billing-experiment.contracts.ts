import { z } from "zod";

export const billingExperimentReport = z.enum([
	"published-cash",
	"published-churn",
	"published-ltv",
	"published-summary",
	"live-cash",
	"live-churn",
	"live-ltv",
	"live-summary",
	"live-funnel",
	"live-readout",
	"live-diagnostics",
	"milestones",
]);

export const billingExperimentQuery = z.object({
	source: z.literal("billing_experiment"),
	report: billingExperimentReport,
});

export type BillingExperimentQuery = z.infer<typeof billingExperimentQuery>;
