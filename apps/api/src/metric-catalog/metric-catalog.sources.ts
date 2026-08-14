import type { SourceStatus } from "@crm/db";

export type CatalogSourceCandidate = {
	key: string;
	label: string;
	state: "CONNECTED" | "ATTENTION" | "MISSING";
	confidence: "EXPLICIT" | "INFERRED" | "TRACKING";
	reason: string;
};

export type CatalogSourceEntry = {
	title: string;
	description: string | null;
	ownerTeam: string | null;
	sourceTabName: string;
	sourceHint: string | null;
	kind: string;
};

export type CatalogSourceState = {
	key: string;
	state: SourceStatus;
};

type CandidateInput = Omit<CatalogSourceCandidate, "state">;

function stateFor(
	key: string,
	sources: Map<string, SourceStatus>,
): CatalogSourceCandidate["state"] {
	const state = sources.get(key);
	if (state === "HEALTHY") return "CONNECTED";
	if (state) return "ATTENTION";
	return "MISSING";
}

export function resolveCatalogSources(
	entry: CatalogSourceEntry,
	sourceStates: CatalogSourceState[],
): CatalogSourceCandidate[] {
	const sources = new Map(
		sourceStates.map((source) => [source.key, source.state]),
	);
	const value = [
		entry.title,
		entry.description,
		entry.ownerTeam,
		entry.sourceTabName,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	const hint = entry.sourceHint?.toLowerCase() ?? "";
	const candidates: CandidateInput[] = [];
	const add = (candidate: CandidateInput) => {
		if (!candidates.some((current) => current.key === candidate.key)) {
			candidates.push(candidate);
		}
	};
	const explicit = (
		pattern: RegExp,
		key: string,
		label: string,
		reason: string,
	) => {
		if (pattern.test(hint)) {
			add({ key, label, reason, confidence: "EXPLICIT" });
		}
	};

	explicit(
		/hubspot/,
		"hubspot:crm",
		"HubSpot CRM",
		"Named in the planning sheet.",
	);
	explicit(
		/ga4|google analytics|search console/,
		"atlas:marketing",
		"GA4 and Search Console",
		"Named in the planning sheet.",
	);
	explicit(
		/posthog/,
		entry.ownerTeam?.toLowerCase().includes("marketing")
			? "atlas:marketing"
			: "posthog:product",
		"PostHog",
		"Named in the planning sheet.",
	);
	explicit(
		/tinybird/,
		"tinybird:usage",
		"TinyBird product usage",
		"Named in the planning sheet.",
	);
	explicit(
		/metabase/,
		"metabase:sync",
		"Sync Metabase",
		"Named in the planning sheet.",
	);
	explicit(
		/manual/,
		"manual:tracker",
		"Manual tracker",
		"The current process is manual and still needs an automated system of record.",
	);
	explicit(
		/platform analytics/,
		"social:platforms",
		"Social platform analytics",
		"Named in the planning sheet.",
	);

	if (
		/\b(generation|upvote|feedback|frames?|model|inference|workflow)\b/.test(
			value,
		)
	) {
		add({
			key: "tinybird:usage",
			label: "TinyBird product usage",
			confidence: "INFERRED",
			reason: "The measure is based on generation or product-usage events.",
		});
		add({
			key: "metabase:sync",
			label: "Sync Metabase",
			confidence: "INFERRED",
			reason: "Atlas already has related read-only product questions here.",
		});
	}
	if (
		/\b(deal|pipeline|closed won|new logos?|partnership|sales cycle|outbound|advisor)\b/.test(
			value,
		)
	) {
		add({
			key: "hubspot:crm",
			label: "HubSpot CRM",
			confidence: "INFERRED",
			reason:
				"The measure is based on CRM companies, deals, stages, or activities.",
		});
	}
	if (/\benterprise inbound\b|sync\.so\/enterprise/.test(value)) {
		add({
			key: "hubspot:forms",
			label: "HubSpot form submissions",
			confidence: "INFERRED",
			reason:
				"The KPI needs enterprise-form submission history; the current HubSpot token does not have the forms read scope.",
		});
	}
	if (/\b(sow|msa|contract|signed|signature|docusign)\b/.test(value)) {
		add({
			key: "docusign:contracts",
			label: "Signed contract system",
			confidence: "INFERRED",
			reason:
				"A signed-document event is stronger evidence than a CRM stage alone.",
		});
	}
	if (
		/\b(website|seo|geo|search|pageviews?|acquisition|social|youtube|tiktok|instagram)\b/.test(
			value,
		)
	) {
		add({
			key: "atlas:marketing",
			label: "GA4, Search Console, and PostHog",
			confidence: "INFERRED",
			reason:
				"Atlas already combines the available web, search, and signup sources.",
		});
	}
	if (/\bsocial media growth\b|platform analytics/.test(value)) {
		add({
			key: "social:platforms",
			label: "Social platform analytics",
			confidence: "EXPLICIT",
			reason:
				"Follower, reach, impression, and engagement data needs read access to each social platform.",
		});
	}
	if (/\bnet burn\b|\brunway\b/.test(value)) {
		add({
			key: "finance:accounting",
			label: "Accounting and cash balances",
			confidence: "INFERRED",
			reason:
				"Burn and runway need governed cash balances and operating cash-flow data, not Stripe collections alone.",
		});
	}
	if (/\bmanual health|qualitative read|health check\b/.test(value)) {
		add({
			key: "customer-success:health",
			label: "Customer health system",
			confidence: "INFERRED",
			reason:
				"The current tracker is manual; Atlas needs a structured health score and evidence feed.",
		});
	}
	if (/\b(signup block|banned|abuse|spam)\b/.test(value)) {
		add({
			key: "atlas:abuse",
			label: "Product and protection events",
			confidence: "INFERRED",
			reason:
				"Atlas already combines product accounts with signup-protection events.",
		});
	}
	if (
		/\b(billing|churn|top-up|subscription|refund|credit|dunning|payment failure)\b/.test(
			value,
		)
	) {
		add({
			key: "tinybird:usage-billing",
			label: "Product usage and Stripe mirror",
			confidence: "INFERRED",
			reason: "The measure needs billing state joined to product usage.",
		});
	}
	if (/\b(hiring|hire|onboarded|butt in seat)\b/.test(value)) {
		add({
			key: "hris:people",
			label: "HRIS",
			confidence: "INFERRED",
			reason:
				"Hiring and onboarding status should come from the people system.",
		});
	}
	if (
		/\b(compliance|certification|certified|gdpr|soc ii|iso|tpn|eu ai act)\b/.test(
			value,
		)
	) {
		add({
			key: "compliance:controls",
			label: "Compliance system",
			confidence: "INFERRED",
			reason:
				"Certification and control evidence needs a compliance system of record.",
		});
	}
	if (
		entry.ownerTeam?.toLowerCase() === "productions" ||
		/\b(shots?|episodes?|delivery|production coordinator|project kickoff)\b/.test(
			value,
		)
	) {
		add({
			key: "production:workspaces",
			label: "Production workspaces",
			confidence: "INFERRED",
			reason:
				"Project, shot, runtime, and delivery evidence belongs in production workspaces.",
		});
	}
	if (entry.kind === "ROADMAP_MEASURE") {
		add({
			key: "linear:projects",
			label: "Linear project evidence",
			confidence: "TRACKING",
			reason:
				"Linear can prove milestone completion, but not the underlying KPI result by itself.",
		});
	}

	return candidates.map((candidate) => ({
		...candidate,
		state: stateFor(candidate.key, sources),
	}));
}
