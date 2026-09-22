export type QbrReadiness = "READY" | "BLOCKED";

export type QbrReadinessSummary = {
	status: QbrReadiness;
	verifiedCards: number;
	applicableCards: number;
	excludedCards: number;
	blockedCards: number;
	attentionSources: string[];
};

type QbrCard = {
	snapshot: unknown;
	verification: { status: string } | null;
};

type QbrSource = {
	label: string;
	state: string;
};

function reportingPeriod(snapshot: unknown): string | null {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
		return null;
	}
	const value = (snapshot as { reportingPeriod?: unknown }).reportingPeriod;
	return typeof value === "string" ? value : null;
}

function hasRows(snapshot: unknown): boolean {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
		return false;
	}
	const snapshotRows = (snapshot as { rows?: unknown }).rows;
	return !Array.isArray(snapshotRows) || snapshotRows.length > 0;
}

export function isCurrentPeriodOnlySnapshot(snapshot: unknown): boolean {
	return (
		!hasRows(snapshot) &&
		reportingPeriod(snapshot)?.startsWith(
			new Date().toISOString().slice(0, 7),
		) === true
	);
}

export function summarizeQbrReadiness(
	cards: QbrCard[],
	sources: QbrSource[],
): QbrReadinessSummary {
	const applicableCards = cards.filter(
		(card) => !isCurrentPeriodOnlySnapshot(card.snapshot),
	);
	const verifiedCards = applicableCards.filter(
		(card) =>
			hasRows(card.snapshot) && card.verification?.status === "VERIFIED",
	).length;
	const excludedCards = cards.length - applicableCards.length;
	const blockedCards = applicableCards.length - verifiedCards;
	const attentionSources = sources
		.filter((source) =>
			["ERROR", "STALE", "UNCONFIGURED"].includes(source.state),
		)
		.map((source) => source.label);

	return {
		status:
			blockedCards > 0 || attentionSources.length > 0 ? "BLOCKED" : "READY",
		verifiedCards,
		applicableCards: applicableCards.length,
		excludedCards,
		blockedCards,
		attentionSources,
	};
}
