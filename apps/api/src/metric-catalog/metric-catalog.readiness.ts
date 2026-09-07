import { MetricReadinessStatus, type Prisma } from "@crm/db";

export const catalogQuestionTrustSelect = {
	purpose: true,
	status: true,
	metricVersion: {
		select: {
			approvedAt: true,
			metric: { select: { status: true } },
			snapshots: {
				orderBy: { computedAt: "desc" },
				take: 1,
				select: { trustStatus: true },
			},
		},
	},
} satisfies Prisma.QuestionSelect;

type CanonicalQuestion = Prisma.QuestionGetPayload<{
	select: typeof catalogQuestionTrustSelect;
}>;

export function canonicalQuestionReadiness(
	stored: MetricReadinessStatus,
	question: CanonicalQuestion | null,
): MetricReadinessStatus {
	if (stored === "BLOCKED" || !question) return stored;
	const version = question.metricVersion;
	if (!version)
		return stored === "VERIFIED" ? MetricReadinessStatus.RECONCILING : stored;
	const snapshot = version.snapshots[0];
	if (
		question.status === "ACTIVE" &&
		question.purpose === "CERTIFIED" &&
		version.approvedAt &&
		version.metric.status === "CERTIFIED" &&
		snapshot?.trustStatus === "VERIFIED"
	) {
		return MetricReadinessStatus.VERIFIED;
	}
	return snapshot
		? MetricReadinessStatus.RECONCILING
		: MetricReadinessStatus.IMPLEMENTING;
}
