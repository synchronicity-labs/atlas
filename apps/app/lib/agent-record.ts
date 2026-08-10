import type { CarbonIcon } from "@crm/ui/components/icon";

export type AgentRecordKind =
	| "contact"
	| "company"
	| "deal"
	| "workspace"
	| "dashboard"
	| "question";

export type AgentRecord = {
	[K in AgentRecordKind]: { kind: K; id: string };
}[AgentRecordKind];

export type AtlasAgentRecord = Extract<
	AgentRecord,
	{ kind: "workspace" | "dashboard" | "question" }
>;

type RecordCopy = {
	header: string;
	field: "contactId" | "companyId" | "dealId" | "atlasContextId";
	title: string;
	blurb: string;
	placeholder: string;
	suggestions: string[];
};

const COPY: Record<AgentRecordKind, RecordCopy> = {
	contact: {
		header: "x-crm-contact",
		field: "contactId",
		title: "Ask about this person",
		blurb:
			"Every step is shown as it happens — including the leads it throws away.",
		placeholder: "Are they still there?",
		suggestions: [
			"Who is this person?",
			"Are they still there?",
			"What should I know before a call?",
		],
	},
	company: {
		header: "x-crm-company",
		field: "companyId",
		title: "Ask about this company",
		blurb:
			"It reads their site and our own history with them, and shows its working.",
		placeholder: "What do they sell?",
		suggestions: [
			"What do they do?",
			"Who do we know here?",
			"What has changed recently?",
		],
	},
	deal: {
		header: "x-crm-deal",
		field: "dealId",
		title: "Ask about this deal",
		blurb:
			"It can read the thread, the meetings and the people on both sides of it.",
		placeholder: "Where has this stalled?",
		suggestions: [
			"Where does this stand?",
			"Who else should be involved?",
			"What is the risk here?",
		],
	},
	workspace: {
		header: "x-atlas-workspace",
		field: "atlasContextId",
		title: "Ask Rudy about Atlas",
		blurb:
			"Rudy starts with Atlas, then follows the sources behind a signal when the answer needs more detail.",
		placeholder: "Ask about a KPI, user, or client…",
		suggestions: [
			"What changed most recently?",
			"Which data is stale?",
			"Find the right dashboard for me",
		],
	},
	dashboard: {
		header: "x-atlas-dashboard",
		field: "atlasContextId",
		title: "Ask Rudy about this dashboard",
		blurb:
			"The dashboard, its questions, current snapshots, timeframes, and provenance are already in context.",
		placeholder: "What explains this change?",
		suggestions: [
			"What changed in this dashboard?",
			"Which number needs attention?",
			"Propose a clearer question",
		],
	},
	question: {
		header: "x-atlas-question",
		field: "atlasContextId",
		title: "Ask Rudy about this question",
		blurb:
			"Rudy can see the real query, latest result, source, reporting period, and saved versions.",
		placeholder: "Explain or improve this query…",
		suggestions: [
			"Explain this query in plain English",
			"Check this metric definition",
			"Propose an edit to this question",
		],
	},
};

export function recordCopy(kind: AgentRecordKind): RecordCopy {
	return COPY[kind];
}

export function recordHeader(record: AgentRecord): Record<string, string> {
	return { [COPY[record.kind].header]: record.id };
}

export function recordFilter(record: AgentRecord): {
	contactId?: string;
	companyId?: string;
	dealId?: string;
	atlasContextKind?: "workspace" | "dashboard" | "question";
	atlasContextId?: string;
} {
	if (
		record.kind === "workspace" ||
		record.kind === "dashboard" ||
		record.kind === "question"
	) {
		return { atlasContextKind: record.kind, atlasContextId: record.id };
	}
	return { [COPY[record.kind].field]: record.id };
}

export type { CarbonIcon };
