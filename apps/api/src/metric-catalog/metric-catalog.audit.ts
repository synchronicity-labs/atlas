import {
	MetricCatalogAttemptOutcome,
	MetricReadinessStatus,
	MetricTrustStatus,
} from "@crm/db";

export type MetricAuditObservation = {
	questionNumber: number;
	questionName: string;
	outcome: "DATA_FOUND" | "NO_ROWS" | "QUERY_FAILED";
	rowCount: number | null;
	durationMs: number | null;
	error: string | null;
	dataThrough: string | null;
	questionTrust: MetricTrustStatus | null;
};

export type MetricAuditSource = {
	label: string;
	state: "CONNECTED" | "ATTENTION" | "MISSING";
	reason: string;
};

export type MetricAuditResult = {
	outcome: MetricCatalogAttemptOutcome;
	trustStatus: MetricTrustStatus;
	detail: string;
};

export type MetricAuditSubject = "KPI" | "PROJECT_OUTCOME";

export function classifyMetricAudit(input: {
	subject?: MetricAuditSubject;
	readiness: MetricReadinessStatus;
	decisionCount: number;
	observations: MetricAuditObservation[];
	sources: MetricAuditSource[];
}): MetricAuditResult {
	const subject = input.subject ?? "KPI";
	const checkLabel =
		subject === "PROJECT_OUTCOME" ? "evidence check" : "saved query";
	const checkArticle = subject === "PROJECT_OUTCOME" ? "an" : "a";
	const projectOutcome = subject === "PROJECT_OUTCOME";
	const data = input.observations.filter(
		(observation) => observation.outcome === "DATA_FOUND",
	);
	if (data.length > 0) {
		const failedTrust = data.find(
			(observation) => observation.questionTrust === MetricTrustStatus.FAILED,
		);
		if (failedTrust) {
			return {
				outcome: MetricCatalogAttemptOutcome.DATA_FOUND,
				trustStatus: MetricTrustStatus.FAILED,
				detail: projectOutcome
					? "Project evidence was found, but the canonical check failed a required verification."
					: "Data returned, but the canonical question has failed a required check.",
			};
		}
		const staleTrust = data.find(
			(observation) => observation.questionTrust === MetricTrustStatus.STALE,
		);
		if (staleTrust) {
			return {
				outcome: MetricCatalogAttemptOutcome.DATA_FOUND,
				trustStatus: MetricTrustStatus.STALE,
				detail: projectOutcome
					? "Project evidence was found, but the canonical check is stale and must be refreshed."
					: "Data returned, but the canonical question is stale and must be refreshed.",
			};
		}
		if (input.readiness === MetricReadinessStatus.VERIFIED) {
			return {
				outcome: MetricCatalogAttemptOutcome.DATA_FOUND,
				trustStatus: MetricTrustStatus.VERIFIED,
				detail:
					subject === "PROJECT_OUTCOME"
						? "Project evidence was found and the required checks passed."
						: "Data returned and the required KPI checks passed.",
			};
		}
		if (input.decisionCount > 0) {
			return {
				outcome: MetricCatalogAttemptOutcome.DATA_FOUND,
				trustStatus: MetricTrustStatus.PENDING,
				detail: `${projectOutcome ? "Project evidence was found" : "Data returned"}, but ${input.decisionCount} definition ${input.decisionCount === 1 ? "decision remains" : "decisions remain"}.`,
			};
		}
		return {
			outcome: MetricCatalogAttemptOutcome.DATA_FOUND,
			trustStatus: MetricTrustStatus.PENDING,
			detail: projectOutcome
				? "Project evidence was found, but Atlas still needs to reconcile it with the approved source or report."
				: "Data returned, but Atlas still needs to reconcile it with the approved source or report.",
		};
	}

	if (
		input.observations.some((observation) => observation.outcome === "NO_ROWS")
	) {
		return {
			outcome: MetricCatalogAttemptOutcome.NO_ROWS,
			trustStatus: MetricTrustStatus.PENDING,
			detail:
				"The saved query ran, but it returned no rows. The period and population need review.",
		};
	}

	const failed = input.observations.find(
		(observation) => observation.outcome === "QUERY_FAILED",
	);
	if (failed) {
		return {
			outcome: MetricCatalogAttemptOutcome.QUERY_FAILED,
			trustStatus: MetricTrustStatus.FAILED,
			detail: failed.error
				? `The saved query failed: ${failed.error}`
				: "The saved query failed.",
		};
	}

	const primary = input.sources[0];
	if (primary?.state === "CONNECTED") {
		return {
			outcome: MetricCatalogAttemptOutcome.QUERY_NOT_BUILT,
			trustStatus: MetricTrustStatus.PENDING,
			detail: `${primary.label} is connected, but this ${subject === "PROJECT_OUTCOME" ? "project outcome" : "KPI"} does not have ${checkArticle} ${checkLabel} yet.`,
		};
	}

	if (primary?.state === "ATTENTION") {
		return {
			outcome: MetricCatalogAttemptOutcome.SOURCE_ERROR,
			trustStatus: MetricTrustStatus.FAILED,
			detail: `${primary.label} needs attention: ${primary.reason}`,
		};
	}

	if (primary) {
		return {
			outcome: MetricCatalogAttemptOutcome.SOURCE_MISSING,
			trustStatus: MetricTrustStatus.PENDING,
			detail: `${primary.label} is not connected: ${primary.reason}`,
		};
	}

	return {
		outcome: MetricCatalogAttemptOutcome.SOURCE_UNKNOWN,
		trustStatus: MetricTrustStatus.PENDING,
		detail: `Atlas could not identify a source or a runnable ${checkLabel} for this ${subject === "PROJECT_OUTCOME" ? "project outcome" : "KPI"}.`,
	};
}
