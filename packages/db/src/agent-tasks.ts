export const TASK_KINDS = [
	"brand",
	"portrait",
	"posthog-profile",
	"meeting-prep",
	"identify",
	"profile",
	"recheck",
	"company-profile",
	"workspace-profile",
	"contract-parse",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export const DIRECT_KINDS = ["brand", "portrait", "posthog-profile"] as const;

export type DirectKind = (typeof DIRECT_KINDS)[number];

export function isDirectKind(kind: string): kind is DirectKind {
	return (DIRECT_KINDS as readonly string[]).includes(kind);
}

export const PRIORITY = {
	brand: 900,
	portrait: 800,
	posthog: 700,
	workspace: 500,
	contract: 250,
	requested: 300,
	meeting: 200,
	identify: 100,
	sweep: 50,
	companyProfile: 40,
	recheck: 0,
} as const;
