import type { MetabaseResult } from "../metabase/metabase.client";

type Arm = "v2_control" | "v3_treatment";

type Assignment = {
	organizationId: string;
	arm: Arm;
	assignmentAt: number;
	firstSubscribedAt: number | null;
	currentPlan: string | null;
};

type Invoice = {
	id: string;
	organizationId: string;
	billingReason: string;
	amountUsd: number;
	amountRemainingUsd: number;
	createdAt: number;
	plan: string | null;
	status: string;
};

type Payment = {
	id: string;
	organizationId: string;
	amountUsd: number;
	createdAt: number;
	status: string;
};

type Cancellation = {
	id: string;
	organizationId: string;
	canceledAt: number;
	reason: string | null;
};

type Subscription = {
	organizationId: string;
	status: string;
	cancelAt: number | null;
	canceledAt: number | null;
};

type Input = {
	asOf: Date;
	assignments: Assignment[];
	invoices: Invoice[];
	payments: Payment[];
	cancellations: Cancellation[];
	subscriptions: Subscription[];
};

const DAY_MS = 86_400_000;

function column(name: string, displayName: string, baseType = "type/Decimal") {
	return { name, displayName, baseType };
}

function armLabel(arm: Arm): string {
	return arm === "v2_control" ? "v2 control" : "v3 treatment";
}

function tier(value: string | null | undefined): string {
	const normalized = value?.trim().toLowerCase();
	return normalized || "unknown";
}

function round(value: number, decimals = 2): number {
	const scale = 10 ** decimals;
	return Math.round(value * scale) / scale;
}

export function buildBillingDiagnostics(input: Input): MetabaseResult {
	const asOf = input.asOf.getTime();
	const assignmentByOrg = new Map(
		input.assignments.map((assignment) => [
			assignment.organizationId,
			assignment,
		]),
	);
	const conversionPlanByOrg = new Map<string, string>();
	for (const invoice of [...input.invoices].sort(
		(a, b) => a.createdAt - b.createdAt,
	)) {
		const assignment = assignmentByOrg.get(invoice.organizationId);
		if (
			assignment &&
			invoice.billingReason === "subscription_create" &&
			invoice.createdAt >= assignment.assignmentAt &&
			invoice.status === "paid" &&
			!conversionPlanByOrg.has(invoice.organizationId)
		) {
			conversionPlanByOrg.set(invoice.organizationId, tier(invoice.plan));
		}
	}
	const cancellationByOrg = new Map<string, Cancellation>();
	for (const cancellation of [...input.cancellations].sort(
		(a, b) => a.canceledAt - b.canceledAt,
	)) {
		if (!cancellationByOrg.has(cancellation.organizationId)) {
			cancellationByOrg.set(cancellation.organizationId, cancellation);
		}
	}
	const paymentById = new Map<string, Payment>();
	for (const payment of input.payments) {
		const current = paymentById.get(payment.id);
		if (
			!current ||
			payment.status === "succeeded" ||
			payment.createdAt > current.createdAt
		) {
			paymentById.set(payment.id, payment);
		}
	}
	const rows: unknown[][] = [];
	for (const arm of ["v2_control", "v3_treatment"] as const) {
		const assignments = input.assignments.filter(
			(assignment) => assignment.arm === arm,
		);
		if (assignments.length === 0) continue;
		const converted = assignments.filter(
			(assignment) =>
				assignment.firstSubscribedAt !== null &&
				assignment.firstSubscribedAt >= assignment.assignmentAt &&
				assignment.firstSubscribedAt <= asOf,
		);
		const convertedIds = new Set(
			converted.map((assignment) => assignment.organizationId),
		);
		const topupsByOrg = new Map<string, { count: number; amount: number }>();
		if (arm === "v3_treatment") {
			for (const payment of paymentById.values()) {
				const assignment = assignmentByOrg.get(payment.organizationId);
				const subscribedAt = assignment?.firstSubscribedAt;
				if (
					assignment?.arm !== arm ||
					typeof subscribedAt !== "number" ||
					payment.status !== "succeeded" ||
					payment.createdAt < subscribedAt ||
					payment.createdAt > asOf
				) {
					continue;
				}
				const current = topupsByOrg.get(payment.organizationId) ?? {
					count: 0,
					amount: 0,
				};
				current.count += 1;
				current.amount += payment.amountUsd;
				topupsByOrg.set(payment.organizationId, current);
			}
		}
		const canceled = converted.filter((assignment) => {
			const cancellation = cancellationByOrg.get(assignment.organizationId);
			return (
				cancellation !== undefined &&
				cancellation.canceledAt >= (assignment.firstSubscribedAt ?? asOf) &&
				cancellation.canceledAt <= asOf
			);
		});
		const pendingCancel = new Set(
			input.subscriptions
				.filter(
					(subscription) =>
						convertedIds.has(subscription.organizationId) &&
						subscription.canceledAt === null &&
						subscription.cancelAt !== null &&
						subscription.cancelAt > asOf,
				)
				.map((subscription) => subscription.organizationId),
		);
		const renewalEligible = converted.filter(
			(assignment) =>
				asOf - (assignment.firstSubscribedAt ?? asOf) >= 30 * DAY_MS,
		);
		const renewed = new Set(
			input.invoices
				.filter((invoice) => {
					const assignment = assignmentByOrg.get(invoice.organizationId);
					return (
						assignment?.arm === arm &&
						assignment.firstSubscribedAt !== null &&
						invoice.billingReason === "subscription_cycle" &&
						invoice.status === "paid" &&
						invoice.createdAt >= assignment.firstSubscribedAt &&
						invoice.createdAt <= asOf
					);
				})
				.map((invoice) => invoice.organizationId),
		);
		const failedInvoices = input.invoices.filter((invoice) => {
			const assignment = assignmentByOrg.get(invoice.organizationId);
			return (
				assignment?.arm === arm &&
				assignment.firstSubscribedAt !== null &&
				invoice.createdAt >= assignment.firstSubscribedAt &&
				invoice.createdAt <= asOf &&
				invoice.status !== "paid" &&
				invoice.amountRemainingUsd > 0
			);
		});
		rows.push([
			"summary",
			armLabel(arm),
			null,
			assignments.length,
			converted.length,
			topupsByOrg.size,
			round(
				[...topupsByOrg.values()].reduce(
					(total, value) => total + value.amount,
					0,
				),
			),
			[...topupsByOrg.values()].filter((value) => value.count > 1).length,
			canceled.length,
			pendingCancel.size,
			renewalEligible.length,
			[...renewed].filter((organizationId) => convertedIds.has(organizationId))
				.length,
			failedInvoices.length,
			round(
				failedInvoices.reduce(
					(total, invoice) => total + invoice.amountRemainingUsd,
					0,
				),
			),
			null,
			null,
			input.asOf.toISOString(),
		]);
		const tierNames = new Set(
			assignments.map(
				(assignment) =>
					conversionPlanByOrg.get(assignment.organizationId) ??
					tier(assignment.currentPlan),
			),
		);
		for (const tierName of [...tierNames].sort()) {
			const tierAssignments = assignments.filter(
				(assignment) =>
					(conversionPlanByOrg.get(assignment.organizationId) ??
						tier(assignment.currentPlan)) === tierName,
			);
			rows.push([
				"tier",
				armLabel(arm),
				tierName,
				tierAssignments.length,
				tierAssignments.filter((assignment) =>
					convertedIds.has(assignment.organizationId),
				).length,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				input.asOf.toISOString(),
			]);
		}
		const reasonCounts = new Map<string, number>();
		for (const assignment of canceled) {
			const reason = tier(
				cancellationByOrg.get(assignment.organizationId)?.reason ?? "unknown",
			);
			reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
		}
		for (const [reason, count] of [...reasonCounts].sort((a, b) =>
			b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
		)) {
			rows.push([
				"reason",
				armLabel(arm),
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				reason,
				count,
				input.asOf.toISOString(),
			]);
		}
	}
	return {
		columns: [
			column("section", "Section", "type/Text"),
			column("arm", "Experiment arm", "type/Text"),
			column("tier", "Paid tier", "type/Text"),
			column("assigned", "Assigned organizations", "type/Integer"),
			column("paid_converters", "Paid converters", "type/Integer"),
			column("topup_users", "Top-up organizations", "type/Integer"),
			column("topup_revenue_usd", "Top-up revenue"),
			column(
				"repeat_topup_orgs",
				"Repeat top-up organizations",
				"type/Integer",
			),
			column("canceled", "Canceled paid converters", "type/Integer"),
			column("pending_cancel", "Pending cancellation", "type/Integer"),
			column("renewal_eligible", "Renewal eligible", "type/Integer"),
			column("renewed", "Renewed organizations", "type/Integer"),
			column(
				"failed_invoice_count",
				"Failed or unpaid invoices",
				"type/Integer",
			),
			column("failed_invoice_amount_usd", "Failed or unpaid amount"),
			column("cancellation_reason", "Cancellation reason", "type/Text"),
			column(
				"cancellation_reason_count",
				"Cancellation reason count",
				"type/Integer",
			),
			column("data_through", "Data through", "type/DateTime"),
		],
		rows,
	};
}
