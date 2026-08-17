"use client";

import Renew from "@carbon/icons-react/es/Renew";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@crm/ui/components/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Entry = RouterOutputs["metricCatalog"]["list"][number];
type Summary = RouterOutputs["metricCatalog"]["summary"];
type SourceCandidate = Entry["sourceCandidates"][number];
type CatalogEvidence = Entry["evidence"][number];
type CatalogAttempt = {
	outcome:
		| "DATA_FOUND"
		| "NO_ROWS"
		| "QUERY_FAILED"
		| "QUERY_NOT_BUILT"
		| "SOURCE_MISSING"
		| "SOURCE_ERROR"
		| "SOURCE_UNKNOWN";
	trustStatus: "VERIFIED" | "PENDING" | "STALE" | "FAILED";
	detail: string;
	observations: unknown;
	attemptedAt: string;
};
type CatalogDecision = { key: string; label: string };
type CatalogScope = "METRICS" | "SUPPORTING";
type AccessGroup = { candidate: SourceCandidate; entries: Entry[] };
type SourceCounts = {
	connected: number;
	attention: number;
	missing: number;
	unclassified: number;
};
type CatalogActivity = {
	busy: boolean;
	syncing: boolean;
	checkingKpis: boolean;
};

const READINESS_LABELS: Record<Entry["readiness"], string> = {
	CATALOGED: "Cataloged",
	NEEDS_DEFINITION: "Needs definition",
	NEEDS_SOURCE: "Needs source",
	NEEDS_EVIDENCE: "Needs evidence",
	READY_TO_IMPLEMENT: "Ready to build",
	IMPLEMENTING: "Implementing",
	RECONCILING: "Reconciling",
	VERIFIED: "Verified",
	BLOCKED: "Blocked",
};

const READINESS_DESCRIPTIONS: Record<Entry["readiness"], string> = {
	CATALOGED:
		"The workbook row is saved in Atlas. Its definition and source have not been checked yet.",
	NEEDS_DEFINITION:
		"The business owner still needs to confirm exactly what this measure means.",
	NEEDS_SOURCE:
		"The intended measure is known, but Atlas does not yet have a usable source or access path.",
	NEEDS_EVIDENCE:
		"Atlas has a candidate source or result, but still needs repeatable evidence and checks before it can be trusted.",
	READY_TO_IMPLEMENT:
		"The definition and source are clear enough to build a deterministic Atlas metric.",
	IMPLEMENTING:
		"The Atlas question and metric contract are being wired into the governed data layer.",
	RECONCILING:
		"Atlas returns data, but it is still being compared with an approved source or report.",
	VERIFIED: "The definition, source, query, and required checks have passed.",
	BLOCKED:
		"A specific external decision or dependency currently prevents progress.",
};

const KIND_LABELS: Record<Entry["kind"], string> = {
	KPI: "KPI",
	VIEW: "View",
	DIAGNOSTIC: "Diagnostic",
	ROADMAP_MEASURE: "Project outcome",
	UNCLASSIFIED: "Review",
};

const ATTEMPT_LABELS: Record<CatalogAttempt["outcome"], string> = {
	DATA_FOUND: "Data returned",
	NO_ROWS: "No rows",
	QUERY_FAILED: "Query failed",
	QUERY_NOT_BUILT: "Query not built",
	SOURCE_MISSING: "Source missing",
	SOURCE_ERROR: "Source error",
	SOURCE_UNKNOWN: "Source unknown",
};

function percent(value: number, total: number): number {
	return total > 0 ? Math.round((value / total) * 100) : 0;
}

function inScope(entry: Entry, scope: CatalogScope): boolean {
	if (scope === "METRICS") return entry.kind === "KPI";
	return (
		entry.kind === "VIEW" ||
		entry.kind === "DIAGNOSTIC" ||
		entry.kind === "UNCLASSIFIED"
	);
}

function scopeLabel(scope: CatalogScope): string {
	if (scope === "METRICS") return "company metrics";
	return "supporting measures";
}

function catalogDecisions(entry: { ambiguities: unknown }): CatalogDecision[] {
	if (!Array.isArray(entry.ambiguities)) return [];
	return entry.ambiguities.flatMap((value) => {
		if (!value || typeof value !== "object") return [];
		const key = "key" in value ? value.key : null;
		const label = "label" in value ? value.label : null;
		return typeof key === "string" && typeof label === "string"
			? [{ key, label }]
			: [];
	});
}

function readinessTone(readiness: Entry["readiness"]): string {
	if (readiness === "VERIFIED") return "text-success";
	if (readiness === "BLOCKED") return "text-destructive";
	if (readiness === "RECONCILING" || readiness === "IMPLEMENTING") {
		return "text-info";
	}
	return "text-warning";
}

function displayTeam(value: string | null): string {
	if (!value) return "—";
	const normalized = value.trim().toLowerCase();
	const labels: Record<string, string> = {
		cs: "Customer Success",
		css: "Customer Success",
		gtm: "GTM",
		gtme: "GTM",
		marketing: "Marketing",
		"marketing new": "Marketing",
		ops: "Operations",
		product: "Product",
		productions: "Productions",
		research: "Research",
		sales: "Sales",
		engineering: "Engineering",
		"sync.": "Sync",
	};
	return (
		labels[normalized] ??
		normalized.replace(/\b\w/g, (letter) => letter.toUpperCase())
	);
}
function ReadinessTooltip({
	readiness,
	candidates = [],
	children,
}: {
	readiness: Entry["readiness"];
	candidates?: SourceCandidate[];
	children: ReactNode;
}) {
	const next = nextSourceCandidate(readiness, candidates);
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				variant="surface"
				className="max-w-80 space-y-2 text-pretty"
			>
				<p>{READINESS_DESCRIPTIONS[readiness]}</p>
				{next ? (
					<div>
						<p className="font-medium">Next: {sourceAction(next)}</p>
						<p className="mt-0.5 text-muted-foreground text-xs">
							{next.reason}
						</p>
					</div>
				) : null}
			</TooltipContent>
		</Tooltip>
	);
}

function HeaderTooltip({
	label,
	description,
}: {
	label: string;
	description: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="cursor-help border-b border-dotted border-current"
				>
					{label}
				</button>
			</TooltipTrigger>
			<TooltipContent variant="surface" className="max-w-72 text-pretty">
				{description}
			</TooltipContent>
		</Tooltip>
	);
}

function DecisionTooltip({ decisions }: { decisions: CatalogDecision[] }) {
	const count = decisions.length;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="mt-1 cursor-help border-b border-dotted border-current text-warning text-xs"
				>
					{count} potential {count === 1 ? "decision" : "decisions"}
				</button>
			</TooltipTrigger>
			<TooltipContent
				variant="surface"
				className="max-w-96 space-y-2 text-pretty"
			>
				<p className="font-medium">Decisions to confirm</p>
				<ul className="space-y-2 text-muted-foreground text-xs">
					{decisions.map((decision) => (
						<li key={decision.key}>{decision.label}</li>
					))}
				</ul>
			</TooltipContent>
		</Tooltip>
	);
}

function sourceTone(state: SourceCandidate["state"]): string {
	if (state === "CONNECTED") return "text-success";
	if (state === "ATTENTION") return "text-warning";
	return "text-muted-foreground";
}

function sourceStateLabel(state: SourceCandidate["state"]): string {
	if (state === "CONNECTED") return "Connected";
	if (state === "ATTENTION") return "Needs attention";
	return "Not connected";
}

function nextSourceCandidate(
	readiness: Entry["readiness"],
	candidates: SourceCandidate[],
): SourceCandidate | null {
	if (readiness === "NEEDS_EVIDENCE") {
		return (
			candidates.find((candidate) => candidate.key === "linear:projects") ??
			candidates.find((candidate) => candidate.state !== "CONNECTED") ??
			null
		);
	}

	const unresolved = candidates.filter(
		(candidate) => candidate.state !== "CONNECTED",
	);
	return (
		unresolved.find((candidate) => candidate.confidence === "EXPLICIT") ??
		unresolved[0] ??
		null
	);
}

function sourceAction(candidate: SourceCandidate): string {
	if (candidate.state === "ATTENTION") {
		return `Fix access to ${candidate.label}`;
	}
	if (candidate.state === "MISSING") return `Connect ${candidate.label}`;
	return `Use ${candidate.label}`;
}

function SourcePath({ candidates }: { candidates: SourceCandidate[] }) {
	const primary = candidates[0];
	if (!primary) return <span className="text-muted-foreground">—</span>;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="flex max-w-52 cursor-help items-start gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
				>
					<span className={`${sourceTone(primary.state)} mt-0.5`}>●</span>
					<span>
						<span className="line-clamp-2 text-foreground text-xs">
							{primary.label}
						</span>
						{candidates.length > 1 ? (
							<span className="text-muted-foreground text-xs">
								+{candidates.length - 1} candidate
								{candidates.length === 2 ? "" : "s"}
							</span>
						) : null}
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent
				variant="surface"
				className="max-w-80 space-y-3 text-pretty"
			>
				{candidates.slice(0, 4).map((candidate) => (
					<div key={candidate.key}>
						<p className="font-medium">
							<span className={sourceTone(candidate.state)}>●</span>{" "}
							{candidate.label} · {sourceStateLabel(candidate.state)}
						</p>
						<p className="mt-0.5 text-muted-foreground text-xs">
							{candidate.reason}
						</p>
					</div>
				))}
			</TooltipContent>
		</Tooltip>
	);
}

function evidenceTone(state: CatalogEvidence["state"]): string {
	if (state === "VERIFIED") return "text-success";
	if (state === "FAILED") return "text-destructive";
	if (state === "PENDING") return "text-warning";
	return "text-info";
}

function evidenceLabel(state: CatalogEvidence["state"]): string {
	if (state === "VERIFIED") return "Verified result";
	if (state === "FAILED") return "Failed checks";
	if (state === "PENDING") return "Checks pending";
	return "Candidate result";
}

function attemptTone(attempt: CatalogAttempt): string {
	if (attempt.trustStatus === "VERIFIED") return "text-success";
	if (attempt.trustStatus === "FAILED") return "text-destructive";
	if (attempt.trustStatus === "STALE") return "text-warning";
	return attempt.outcome === "DATA_FOUND" ? "text-info" : "text-warning";
}

function attemptObservations(value: unknown): Array<{
	questionNumber: number;
	questionName: string;
	rowCount: number | null;
	durationMs: number | null;
	error: string | null;
}> {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const questionNumber =
			"questionNumber" in item ? item.questionNumber : null;
		const questionName = "questionName" in item ? item.questionName : null;
		if (
			typeof questionNumber !== "number" ||
			typeof questionName !== "string"
		) {
			return [];
		}
		return [
			{
				questionNumber,
				questionName,
				rowCount:
					"rowCount" in item && typeof item.rowCount === "number"
						? item.rowCount
						: null,
				durationMs:
					"durationMs" in item && typeof item.durationMs === "number"
						? item.durationMs
						: null,
				error:
					"error" in item && typeof item.error === "string" ? item.error : null,
			},
		];
	});
}

function AttemptPath({
	attempt,
	kind,
}: {
	attempt: CatalogAttempt | null;
	kind: Entry["kind"];
}) {
	if (!attempt)
		return <span className="text-muted-foreground">Not checked</span>;
	const observations = attemptObservations(attempt.observations);
	const label =
		kind === "ROADMAP_MEASURE" && attempt.outcome === "QUERY_NOT_BUILT"
			? "Evidence check not built"
			: ATTEMPT_LABELS[attempt.outcome];
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className={`${attemptTone(attempt)} cursor-help border-b border-dotted border-current text-left text-xs`}
				>
					{label}
				</button>
			</TooltipTrigger>
			<TooltipContent
				variant="surface"
				className="max-w-96 space-y-2 text-pretty"
			>
				<p className="font-medium">{label}</p>
				<p className="text-muted-foreground text-xs">{attempt.detail}</p>
				{observations.map((observation) => (
					<div key={observation.questionNumber} className="text-xs">
						<p>
							Question {observation.questionNumber}: {observation.questionName}
						</p>
						<p className="text-muted-foreground">
							{observation.error ??
								`${observation.rowCount ?? 0} rows${observation.durationMs ? ` in ${observation.durationMs} ms` : ""}`}
						</p>
					</div>
				))}
				<p className="text-muted-foreground text-xs" suppressHydrationWarning>
					Checked {relativeTimeFromIso(attempt.attemptedAt)}
				</p>
			</TooltipContent>
		</Tooltip>
	);
}

function CanonicalQuestion({ entry }: { entry: Entry }) {
	if (!entry.canonicalQuestion) {
		return (
			<span className="text-muted-foreground">
				{entry.kind === "ROADMAP_MEASURE" ? "No evidence check" : "Not created"}
			</span>
		);
	}
	const isDraft = entry.canonicalQuestion.status === "DRAFT";
	return (
		<div className="max-w-56">
			<Link
				href={`/questions/${entry.canonicalQuestion.number}`}
				className="line-clamp-2 text-foreground text-xs underline decoration-border underline-offset-4 hover:decoration-foreground"
			>
				{entry.canonicalQuestion.name}
			</Link>
			<span
				className={`${isDraft ? "text-warning" : "text-success"} mt-1 block text-xs`}
			>
				{isDraft
					? entry.kind === "ROADMAP_MEASURE"
						? "Draft evidence check"
						: "Draft query"
					: "Runnable question"}
			</span>
		</div>
	);
}

function EvidencePath({ evidence }: { evidence: CatalogEvidence[] }) {
	if (evidence.length === 0) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<div className="flex max-w-56 flex-col items-start gap-1.5">
			{evidence.slice(0, 3).map((item) => (
				<Tooltip key={item.id}>
					<TooltipTrigger asChild>
						<Link
							href={`/questions/${item.questionNumber}`}
							className="line-clamp-1 text-left text-xs underline decoration-border underline-offset-4 hover:decoration-foreground"
						>
							<span className={evidenceTone(item.state)}>●</span>{" "}
							{item.questionName}
						</Link>
					</TooltipTrigger>
					<TooltipContent
						variant="surface"
						className="max-w-96 space-y-2 text-pretty"
					>
						<p className="font-medium">{evidenceLabel(item.state)}</p>
						<p className="text-muted-foreground text-xs">{item.rationale}</p>
						{item.computedAt ? (
							<p className="text-muted-foreground text-xs">
								{item.rowCount ?? 0} result rows · updated{" "}
								<span suppressHydrationWarning>
									{relativeTimeFromIso(item.computedAt)}
								</span>
							</p>
						) : (
							<p className="text-muted-foreground text-xs">
								No saved result yet.
							</p>
						)}
					</TooltipContent>
				</Tooltip>
			))}
			{evidence.length > 3 ? (
				<span className="text-muted-foreground text-xs">
					+{evidence.length - 3} more
				</span>
			) : null}
		</div>
	);
}

function Stat({
	label,
	value,
	detail,
}: {
	label: string;
	value: number;
	detail: string;
}) {
	return (
		<div className="rounded-lg border bg-card p-4">
			<p className="text-muted-foreground text-xs uppercase tracking-[0.12em]">
				{label}
			</p>
			<p className="mt-2 font-medium text-3xl tabular-nums">{value}</p>
			<p className="mt-1 text-muted-foreground text-xs">{detail}</p>
		</div>
	);
}

function CatalogOverview({
	summary,
	scope,
	onScopeChange,
	supportingTotal,
	activity,
	onSync,
	onCheckKpis,
	lastCheckAt,
	sourceCounts,
	accessNeeded,
	readinessCounts,
	query,
	onQueryChange,
}: {
	summary: Summary;
	scope: CatalogScope;
	onScopeChange: (scope: CatalogScope) => void;
	supportingTotal: number;
	activity: CatalogActivity;
	onSync: () => void;
	onCheckKpis: () => void;
	lastCheckAt: string | null;
	sourceCounts: SourceCounts;
	accessNeeded: AccessGroup[];
	readinessCounts: Partial<Record<Entry["readiness"], number>>;
	query: string;
	onQueryChange: (value: string) => void;
}) {
	return (
		<>
			<div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="font-medium">Metric catalog</p>
					<p className="mt-1 text-muted-foreground text-sm">
						{summary.source?.lastSyncAt ? (
							<>
								Company metrics and supporting measures imported{" "}
								<span suppressHydrationWarning>
									{relativeTimeFromIso(summary.source.lastSyncAt)}
								</span>
							</>
						) : (
							"The workbook has not been imported yet."
						)}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" disabled={activity.busy} onClick={onSync}>
						<Icon icon={Renew} />
						{activity.syncing ? "Importing" : "Refresh catalog"}
					</Button>
					{scope === "METRICS" ? (
						<Button disabled={activity.busy} onClick={onCheckKpis}>
							<Icon icon={Renew} />
							{activity.checkingKpis ? "Checking KPIs" : "Check all KPIs"}
						</Button>
					) : null}
				</div>
			</div>

			<Tabs
				value={scope}
				onValueChange={(value) => onScopeChange(value as CatalogScope)}
			>
				<TabsList>
					<TabsTrigger value="METRICS">
						Company metrics {summary.kpiTotal}
					</TabsTrigger>
					<TabsTrigger value="SUPPORTING">
						Supporting {supportingTotal}
					</TabsTrigger>
				</TabsList>
			</Tabs>

			{scope === "METRICS" ? (
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
					<Stat
						label="KPI questions"
						value={summary.kpiQuestions}
						detail={`${percent(summary.kpiQuestions, summary.kpiTotal)}% of ${summary.kpiTotal} KPIs have one canonical question`}
					/>
					<Stat
						label="KPIs checked"
						value={summary.kpiAttempted}
						detail={`${percent(summary.kpiAttempted, summary.kpiTotal)}% have a recorded attempt`}
					/>
					<Stat
						label="Data returned"
						value={summary.kpiDataFound}
						detail="The canonical question ran and returned rows"
					/>
					<Stat
						label="KPIs verified"
						value={summary.kpiVerified}
						detail={`${percent(summary.kpiVerified, summary.kpiTotal)}% fully trusted`}
					/>
					<Stat
						label="Query gaps"
						value={summary.kpiQueryNotBuilt + summary.kpiQueryFailed}
						detail={`${summary.kpiQueryNotBuilt} not built · ${summary.kpiQueryFailed} failed`}
					/>
					<Stat
						label="Source blocked"
						value={summary.kpiSourceBlocked}
						detail="Missing, broken, or unknown source access"
					/>
				</div>
			) : null}

			{scope === "SUPPORTING" ? (
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					<Stat
						label="Supporting measures"
						value={supportingTotal}
						detail="Views and diagnostics used to explain company metrics"
					/>
					<Stat
						label="Views"
						value={summary.byKind.VIEW ?? 0}
						detail="Breakdowns that add context to a KPI"
					/>
					<Stat
						label="Diagnostics"
						value={summary.byKind.DIAGNOSTIC ?? 0}
						detail="Checks used to explain changes or find problems"
					/>
				</div>
			) : null}

			<p className="text-muted-foreground text-xs">
				{lastCheckAt ? (
					<>
						Last {scopeLabel(scope)} check{" "}
						<span suppressHydrationWarning>
							{relativeTimeFromIso(lastCheckAt)}
						</span>
						{" · "}
					</>
				) : null}
				Source map for {scopeLabel(scope)}: {sourceCounts.connected} connected ·{" "}
				{sourceCounts.attention} need connector attention ·{" "}
				{sourceCounts.missing} need a new connection ·{" "}
				{sourceCounts.unclassified} still unclassified
			</p>

			{accessNeeded.length > 0 ? (
				<div className="rounded-lg border bg-card p-4">
					<p className="font-medium">Data access needed</p>
					<p className="mt-1 text-muted-foreground text-sm">
						These are the permissions or connections needed to unblock the
						selected {scopeLabel(scope)}.
					</p>
					<div className="mt-3 divide-y">
						{accessNeeded.map(({ entries, candidate }) => (
							<div
								key={candidate.key}
								className="grid gap-1 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-4"
							>
								<div>
									<p className="font-medium text-sm">
										{sourceAction(candidate)}
									</p>
									<p className="mt-0.5 text-muted-foreground text-xs">
										Unblocks {entries.length} {scopeLabel(scope)}
									</p>
								</div>
								<div>
									<p className="text-sm">{candidate.reason}</p>
									<p className="mt-1 text-muted-foreground text-xs">
										Examples:{" "}
										{entries
											.slice(0, 3)
											.map((entry) => entry.title)
											.join(" · ")}
										{entries.length > 3 ? ` · +${entries.length - 3} more` : ""}
									</p>
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}

			<div className="flex flex-wrap gap-2">
				{Object.entries(READINESS_LABELS).map(([key, label]) => {
					const readiness = key as Entry["readiness"];
					return (
						<ReadinessTooltip key={key} readiness={readiness}>
							<button
								type="button"
								className="inline-flex cursor-help items-center gap-1.5 rounded-full border bg-muted/25 px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
							>
								<span className={readinessTone(readiness)}>●</span>
								{label}
								<span className="text-muted-foreground tabular-nums">
									{readinessCounts[readiness] ?? 0}
								</span>
							</button>
						</ReadinessTooltip>
					);
				})}
			</div>

			<Input
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				placeholder={`Search ${scopeLabel(scope)}, teams, sources, or evidence`}
				aria-label="Search metric catalog"
			/>
		</>
	);
}

function CatalogTable({
	entries,
	scope,
}: {
	entries: Entry[];
	scope: CatalogScope;
}) {
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<div className="overflow-x-auto">
				<table className="w-full min-w-[1560px] text-sm">
					<thead className="border-b bg-muted/30 text-left text-muted-foreground text-xs">
						<tr>
							<th className="px-4 py-3 font-medium">Workbook row</th>
							<th className="px-4 py-3 font-medium">Measure</th>
							<th className="px-4 py-3 font-medium">Kind</th>
							<th className="px-4 py-3 font-medium">Team</th>
							<th className="px-4 py-3 font-medium">
								<HeaderTooltip
									label="Likely data source"
									description="The strongest source Atlas can identify from the metric text and existing connectors. Hover a row to see alternatives and connection status."
								/>
							</th>
							<th className="px-4 py-3 font-medium">
								<HeaderTooltip
									label="Available data evidence"
									description="Questions Atlas can already run to test an interpretation. Candidate results are useful for review but are not approved KPIs until their open decisions and checks pass."
								/>
							</th>
							<th className="px-4 py-3 font-medium">
								<HeaderTooltip
									label="Canonical question"
									description="The one Atlas question that owns this KPI. Draft means the question exists but still needs an executable query."
								/>
							</th>
							<th className="px-4 py-3 font-medium">
								<HeaderTooltip
									label="Latest check"
									description="What happened the last time Atlas tried to get data for this measure. Hover for the result or failure reason."
								/>
							</th>
							<th className="px-4 py-3 font-medium">
								<HeaderTooltip
									label="Readiness"
									description="How far this workbook measure has moved from an idea to trusted, repeatable evidence."
								/>
							</th>
						</tr>
					</thead>
					<tbody>
						{entries.map((entry) => {
							const decisions = catalogDecisions(entry);
							return (
								<tr key={entry.id} className="border-b last:border-0">
									<td className="whitespace-nowrap px-4 py-3 align-top font-mono text-muted-foreground text-xs">
										<Link
											href={`https://docs.google.com/spreadsheets/d/17oWmJqYGxWwHEbdVhvo1OCHLAUEv03bljDuPHaqGHwU/edit#gid=${entry.sourceTabId}&range=${entry.sourceRange}`}
											target="_blank"
											rel="noreferrer"
											className="underline decoration-border underline-offset-4 hover:text-foreground"
										>
											{entry.sourceTabName} · {entry.sourceRow}
										</Link>
										{entry.sourceHint ? (
											<p className="mt-1 max-w-40 whitespace-normal text-foreground/75">
												{entry.sourceHint}
											</p>
										) : null}
									</td>
									<td className="max-w-xl px-4 py-3 align-top">
										<p className="font-medium">{entry.title}</p>
										{entry.description ? (
											<p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
												{entry.description}
											</p>
										) : null}
										{decisions.length > 0 ? (
											<DecisionTooltip decisions={decisions} />
										) : null}
									</td>
									<td className="px-4 py-3 align-top">
										<span className="inline-flex rounded-md border px-2 py-0.5 text-xs">
											{KIND_LABELS[entry.kind]}
										</span>
									</td>
									<td className="px-4 py-3 align-top text-muted-foreground">
										{displayTeam(entry.ownerTeam)}
									</td>
									<td className="px-4 py-3 align-top">
										<SourcePath candidates={entry.sourceCandidates} />
									</td>
									<td className="px-4 py-3 align-top">
										<EvidencePath evidence={entry.evidence} />
									</td>
									<td className="px-4 py-3 align-top">
										<CanonicalQuestion entry={entry} />
									</td>
									<td className="px-4 py-3 align-top">
										<AttemptPath
											attempt={entry.latestAttempt}
											kind={entry.kind}
										/>
									</td>
									<td className="px-4 py-3 align-top">
										<ReadinessTooltip
											readiness={entry.readiness}
											candidates={entry.sourceCandidates}
										>
											<button
												type="button"
												className={`${readinessTone(entry.readiness)} cursor-help border-b border-dotted border-current`}
											>
												{READINESS_LABELS[entry.readiness]}
											</button>
										</ReadinessTooltip>
									</td>
								</tr>
							);
						})}
						{entries.length === 0 ? (
							<tr>
								<td
									colSpan={9}
									className="px-4 py-10 text-center text-muted-foreground"
								>
									No {scopeLabel(scope)} match this search.
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export function MetricCatalog() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const summary = useQuery(trpc.metricCatalog.summary.queryOptions());
	const entries = useQuery(trpc.metricCatalog.list.queryOptions());
	const [query, setQuery] = useState("");
	const [scope, setScope] = useState<CatalogScope>("METRICS");
	const sync = useMutation(
		trpc.metricCatalog.sync.mutationOptions({
			onSuccess: async (result) => {
				await Promise.all([
					queryClient.invalidateQueries(
						trpc.metricCatalog.summary.queryFilter(),
					),
					queryClient.invalidateQueries(trpc.metricCatalog.list.queryFilter()),
				]);
				toast.success(
					`Cataloged ${result.entries} measurements from ${result.tabs} tabs.`,
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const audit = useMutation(
		trpc.metricCatalog.auditKpis.mutationOptions({
			onSuccess: async (result) => {
				await Promise.all([
					queryClient.invalidateQueries(
						trpc.metricCatalog.summary.queryFilter(),
					),
					queryClient.invalidateQueries(trpc.metricCatalog.list.queryFilter()),
				]);
				const dataFound = result.byOutcome.DATA_FOUND ?? 0;
				toast.success(
					`Checked ${result.total} KPIs. ${dataFound} returned data.`,
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const scopedEntries = useMemo(
		() => (entries.data ?? []).filter((entry) => inScope(entry, scope)),
		[entries.data, scope],
	);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return scopedEntries;
		return scopedEntries.filter((entry) =>
			[
				entry.title,
				entry.description,
				entry.ownerTeam,
				entry.sourceTabName,
				entry.metric?.name,
				entry.canonicalQuestion?.name,
				entry.latestAttempt?.detail,
				...entry.sourceCandidates.map((candidate) => candidate.label),
				...entry.evidence.map((evidence) => evidence.questionName),
			]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(needle)),
		);
	}, [query, scopedEntries]);
	const accessNeeded = useMemo(() => {
		const groups = new Map<
			string,
			{ candidate: SourceCandidate; entries: Entry[] }
		>();
		for (const entry of scopedEntries) {
			if (
				entry.readiness !== "NEEDS_SOURCE" &&
				entry.readiness !== "NEEDS_EVIDENCE"
			) {
				continue;
			}
			const candidate = nextSourceCandidate(
				entry.readiness,
				entry.sourceCandidates,
			);
			if (!candidate) continue;
			const current = groups.get(candidate.key);
			if (current) current.entries.push(entry);
			else groups.set(candidate.key, { candidate, entries: [entry] });
		}
		return [...groups.values()].sort(
			(left, right) => right.entries.length - left.entries.length,
		);
	}, [scopedEntries]);
	const scopedReadiness = useMemo(() => {
		const counts = {} as Partial<Record<Entry["readiness"], number>>;
		for (const entry of scopedEntries) {
			counts[entry.readiness] = (counts[entry.readiness] ?? 0) + 1;
		}
		return counts;
	}, [scopedEntries]);
	const scopedSources = useMemo(() => {
		let connected = 0;
		let attention = 0;
		let missing = 0;
		let unclassified = 0;
		for (const entry of scopedEntries) {
			if (
				entry.sourceCandidates.some(
					(candidate) => candidate.state === "CONNECTED",
				)
			) {
				connected += 1;
			} else if (
				entry.sourceCandidates.some(
					(candidate) => candidate.state === "ATTENTION",
				)
			) {
				attention += 1;
			} else if (entry.sourceCandidates.length > 0) {
				missing += 1;
			} else {
				unclassified += 1;
			}
		}
		return { connected, attention, missing, unclassified };
	}, [scopedEntries]);
	const supportingTotal =
		summary.data?.total !== undefined
			? summary.data.total - summary.data.kpiTotal
			: 0;
	const isBusy = sync.isPending || audit.isPending;
	const lastCheckAt =
		scope === "METRICS" ? (summary.data?.lastAuditAt ?? null) : null;

	if (!summary.data || !entries.data) {
		return <div className="h-72 animate-pulse rounded-lg bg-muted" />;
	}

	return (
		<div className="space-y-5">
			<CatalogOverview
				summary={summary.data}
				scope={scope}
				onScopeChange={setScope}
				supportingTotal={supportingTotal}
				activity={{
					busy: isBusy,
					syncing: sync.isPending,
					checkingKpis: audit.isPending,
				}}
				onSync={() => sync.mutate()}
				onCheckKpis={() => audit.mutate()}
				lastCheckAt={lastCheckAt}
				sourceCounts={scopedSources}
				accessNeeded={accessNeeded}
				readinessCounts={scopedReadiness}
				query={query}
				onQueryChange={setQuery}
			/>
			<CatalogTable entries={filtered} scope={scope} />
		</div>
	);
}
