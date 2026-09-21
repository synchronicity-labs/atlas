export type QbrReadiness = "READY" | "BLOCKED";

export type QbrReadinessSummary = {
	status: QbrReadiness;
	verifiedCards: number;
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

function hasRows(snapshot: unknown): boolean {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
		return false;
	}
	const snapshotRows = (snapshot as { rows?: unknown }).rows;
	return !Array.isArray(snapshotRows) || snapshotRows.length > 0;
}

export function summarizeQbrReadiness(
	cards: QbrCard[],
	sources: QbrSource[],
): QbrReadinessSummary {
	const verifiedCards = cards.filter(
		(card) =>
			hasRows(card.snapshot) && card.verification?.status === "VERIFIED",
	).length;
	const blockedCards = cards.length - verifiedCards;
	const attentionSources = sources
		.filter((source) =>
			["ERROR", "STALE", "UNCONFIGURED"].includes(source.state),
		)
		.map((source) => source.label);

	return {
		status:
			blockedCards > 0 || attentionSources.length > 0 ? "BLOCKED" : "READY",
		verifiedCards,
		blockedCards,
		attentionSources,
	};
}
