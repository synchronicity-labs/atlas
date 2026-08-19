export type MetricTrustStatus = "VERIFIED" | "PENDING" | "FAILED" | "STALE";
export type VerificationStatus = "PENDING" | "PASSED" | "FAILED" | "WAIVED";

export type VerificationCheckSummary = {
	name: string;
	label: string;
	status: VerificationStatus;
	detail: string | null;
	verifiedAt: string | null;
};

export type MetricVerificationSummary = {
	status: MetricTrustStatus;
	reason: string;
	reportingPeriod: string | null;
	dataThrough: string | null;
	computedAt: string | null;
	checks: VerificationCheckSummary[];
	verifiedQuestions: number | null;
	totalQuestions: number | null;
};

type SnapshotVerificationInput = {
	trustStatus: MetricTrustStatus;
	reportingPeriod: string;
	dataThrough: Date;
	computedAt: Date;
	metricRun: {
		verifications: Array<{
			name: string;
			status: VerificationStatus;
			evidence: unknown;
			verifiedAt: Date | null;
		}>;
	};
};

const CHECK_LABELS: Record<string, string> = {
	read_only_query: "Query is read-only",
	source_snapshot: "Immutable source snapshot stored",
	result_non_empty: "Result returned data",
	exclude_banned_anonymous_internal: "Clean-user filter",
	saved_question_equivalence: "Saved-question replacement matches",
	approved_cross_property_definition: "Cross-site visitor definition approved",
	cross_site_identity_bridge: "Same person deduplicated across Sync sites",
	approved_rating_definition: "Positive rating definition approved",
	approved_completed_status: "Completed-generation denominator approved",
};

export function summarizeMetricVerification(
	snapshot: SnapshotVerificationInput,
): MetricVerificationSummary {
	return {
		status: snapshot.trustStatus,
		reason: trustReason(snapshot.trustStatus),
		reportingPeriod: snapshot.reportingPeriod,
		dataThrough: snapshot.dataThrough.toISOString(),
		computedAt: snapshot.computedAt.toISOString(),
		checks: snapshot.metricRun.verifications.map((verification) => ({
			name: verification.name,
			label: CHECK_LABELS[verification.name] ?? humanize(verification.name),
			status: verification.status,
			detail: evidenceReason(verification.evidence),
			verifiedAt: verification.verifiedAt?.toISOString() ?? null,
		})),
		verifiedQuestions: null,
		totalQuestions: null,
	};
}

export function summarizePendingMetricVerification(): MetricVerificationSummary {
	return {
		status: "PENDING",
		reason:
			"This governed question does not have an immutable metric snapshot yet.",
		reportingPeriod: null,
		dataThrough: null,
		computedAt: null,
		checks: [],
		verifiedQuestions: null,
		totalQuestions: null,
	};
}

export function summarizeDashboardVerification(
	questions: Array<MetricVerificationSummary | null>,
): MetricVerificationSummary | null {
	if (questions.length === 0) return null;
	const governed = questions.filter(
		(summary): summary is MetricVerificationSummary => summary !== null,
	);
	const verified = governed.filter(
		(summary) => summary.status === "VERIFIED",
	).length;
	const status = dashboardStatus(governed, questions.length);
	const oldestDataThrough = governed
		.flatMap((summary) =>
			summary.dataThrough ? [new Date(summary.dataThrough)] : [],
		)
		.sort((left, right) => left.getTime() - right.getTime())[0];
	const newestComputation = governed
		.flatMap((summary) =>
			summary.computedAt ? [new Date(summary.computedAt)] : [],
		)
		.sort((left, right) => right.getTime() - left.getTime())[0];
	const coveragePassed = governed.length === questions.length;
	return {
		status,
		reason:
			status === "VERIFIED"
				? "Every question on this dashboard has a verified immutable snapshot."
				: `${verified} of ${questions.length} questions have verified immutable snapshots.`,
		reportingPeriod: null,
		dataThrough: oldestDataThrough?.toISOString() ?? null,
		computedAt: newestComputation?.toISOString() ?? null,
		checks: [
			{
				name: "governed_question_coverage",
				label: "Every dashboard question uses the governed metric layer",
				status: coveragePassed ? "PASSED" : "PENDING",
				detail: `${governed.length} of ${questions.length} questions have verification evidence.`,
				verifiedAt: null,
			},
			{
				name: "verified_question_snapshots",
				label: "Required checks passed",
				status:
					verified === questions.length
						? "PASSED"
						: governed.some((summary) => summary.status === "FAILED")
							? "FAILED"
							: "PENDING",
				detail: `${verified} of ${questions.length} questions are verified.`,
				verifiedAt: null,
			},
		],
		verifiedQuestions: verified,
		totalQuestions: questions.length,
	};
}

function dashboardStatus(
	governed: MetricVerificationSummary[],
	totalQuestions: number,
): MetricTrustStatus {
	if (governed.some((summary) => summary.status === "FAILED")) {
		return "FAILED";
	}
	if (governed.some((summary) => summary.status === "STALE")) {
		return "STALE";
	}
	if (
		governed.length === totalQuestions &&
		governed.every((summary) => summary.status === "VERIFIED")
	) {
		return "VERIFIED";
	}
	return "PENDING";
}

function trustReason(status: MetricTrustStatus): string {
	if (status === "VERIFIED") {
		return "All required checks passed for this immutable snapshot.";
	}
	if (status === "FAILED") {
		return "At least one required check failed. Do not use this result for reporting.";
	}
	if (status === "STALE") {
		return "The checks passed previously, but the source is outside its freshness window.";
	}
	return "The result is available, but at least one required check is still open.";
}

function evidenceReason(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const reason = "reason" in value ? value.reason : null;
	return typeof reason === "string" ? reason : null;
}

function humanize(value: string): string {
	return value
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
