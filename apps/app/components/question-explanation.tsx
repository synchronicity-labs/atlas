"use client";

import Information from "@carbon/icons-react/es/Information";
import { Button } from "@crm/ui/components/button";
import { CardContent } from "@crm/ui/components/card";
import { Icon } from "@crm/ui/components/icon";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";

function humanize(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeMetricLanguage(value: string): string {
	return value
		.replace(/\bat least\s+100\s+USD\b/gi, "$100+")
		.replace(/\b100\s+USD\b/gi, "$100+")
		.replace(
			/\bthree\s+completed\s+billable\s+generations\b/gi,
			"3+ billable generations",
		)
		.replace(/\bthree\s+billable\s+generations\b/gi, "3+ billable generations")
		.replace(
			/\bthree\s+completed\s+generations\b/gi,
			"3+ completed generations",
		)
		.replace(
			/\b(?:two|2\+)\s+active\s+days\b/gi,
			"generations on 2+ distinct UTC days",
		)
		.replace(/\bat least\s+two\s+distinct\s+days\b/gi, "2+ distinct UTC days")
		.replace(/\btwo\s+distinct\s+days\b/gi, "2+ distinct UTC days");
}

const VALUE_LABELS: Record<string, string> = {
	organization_month: "One organization per UTC month",
	same_cohort_month_three_accrued_value:
		"Accrued value from the same cohort two months later",
	starting_month_accrued_value:
		"Accrued value from the cohort in the starting month",
	starting_professional_organization_cohort:
		"Professional organizations in the starting month",
	v2_self_serve: "V2 self-serve plans",
};

const RULE_LABELS: Record<string, string> = {
	entity: "Counted unit",
	currentMonthOffset: "Measurement month",
	denominator: "Starting value",
	minimumActiveDays: "Day requirement",
	minimumCompletedBillableGenerations: "Generation requirement",
	minimumCompletedGenerations: "Generation requirement",
	numerator: "Comparison value",
	population: "Included group",
	professional: "Professional threshold",
	professionalDefinition: "Professional threshold",
	requalificationMonthOffset: "Measurement month",
};

const THRESHOLD_ORDER: Record<string, number> = {
	minimumAccruedValueUsd: 0,
	minimumCompletedBillableGenerations: 1,
	minimumActiveDays: 2,
};

function explainThreshold(key: string, value: unknown): string | null {
	if (typeof value !== "number") return null;
	switch (key) {
		case "minimumAccruedValueUsd":
			return `$${value.toLocaleString("en-US")}+ accrued value`;
		case "minimumCompletedBillableGenerations":
			return `${value}+ billable generations`;
		case "minimumCompletedGenerations":
			return `${value}+ billable generations`;
		case "minimumActiveDays":
			return `generations on ${value}+ distinct UTC days`;
		case "currentMonthOffset":
		case "requalificationMonthOffset":
			return `${value} months after the starting month (M+${value})`;
		default:
			return null;
	}
}

function explainValue(value: unknown, key = ""): string {
	if (value === null || value === undefined) return "Not set";
	if (typeof value === "boolean") return value ? "Yes" : "No";
	const threshold = explainThreshold(key, value);
	if (threshold) return threshold;
	if (Array.isArray(value))
		return value.map((item) => explainValue(item)).join(", ");
	if (typeof value === "object") {
		return Object.entries(value)
			.sort(
				([left], [right]) =>
					(THRESHOLD_ORDER[left] ?? 99) - (THRESHOLD_ORDER[right] ?? 99),
			)
			.map(([nestedKey, nested]) => explainValue(nested, nestedKey))
			.join(" · ");
	}
	const raw = String(value);
	const normalized = normalizeMetricLanguage(
		VALUE_LABELS[raw] ?? raw.replaceAll("_", " "),
	);
	if (key === "professionalDefinition") {
		return normalized.replace(/,\s*(?:and\s+)?/g, " · ");
	}
	return normalized;
}

function definitionRows(definition: unknown) {
	if (
		!definition ||
		typeof definition !== "object" ||
		Array.isArray(definition)
	) {
		return [];
	}
	return Object.entries(definition).map(([key, value]) => ({
		label: RULE_LABELS[key] ?? humanize(key),
		value: explainValue(value, key),
	}));
}

function explanationParts(explanation: string) {
	const [summary, why] = explanation.split(/\s+Why it matters:\s+/i, 2);
	return { summary, why: why ?? null };
}

export function QuestionExplanationPanel({
	explanation,
	definition,
}: {
	explanation: string;
	definition?: unknown;
}) {
	const rows = definitionRows(definition);
	const { summary, why } = explanationParts(explanation);

	return (
		<CardContent className="grid gap-5">
			<div className="max-w-3xl">
				<p className="font-medium text-sm">How this number is calculated</p>
				<p className="mt-1 text-muted-foreground text-sm leading-6">
					{summary}
				</p>
			</div>
			{rows.length > 0 ? (
				<div>
					<dl className="grid gap-3 sm:grid-cols-3">
						{rows.map((row) => (
							<div key={row.label}>
								<dt className="text-muted-foreground text-xs">{row.label}</dt>
								<dd className="mt-0.5 text-sm leading-5">{row.value}</dd>
							</div>
						))}
					</dl>
				</div>
			) : null}
			{why ? (
				<p className="max-w-3xl text-muted-foreground text-sm leading-6">
					<span className="font-medium text-foreground">Why it matters: </span>
					{why}
				</p>
			) : null}
		</CardContent>
	);
}

export function QuestionExplanationTooltip({
	explanation,
	definition,
}: {
	explanation: string;
	definition?: unknown;
}) {
	const rows = definitionRows(definition);
	const { summary, why } = explanationParts(explanation);

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Explain question"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => event.stopPropagation()}
					>
						<Icon icon={Information} />
					</Button>
				</TooltipTrigger>
				<TooltipContent variant="surface" side="bottom" align="end">
					<div className="grid w-80 max-w-[calc(100vw-2rem)] gap-3">
						<div>
							<p className="font-medium text-sm">
								How this number is calculated
							</p>
							<p className="mt-1 text-muted-foreground text-sm leading-5">
								{summary}
							</p>
						</div>
						{rows.length > 0 ? (
							<dl className="grid gap-2 border-t pt-3">
								{rows.map((row) => (
									<div
										key={row.label}
										className="grid grid-cols-[7rem_1fr] gap-3 text-sm"
									>
										<dt className="text-muted-foreground">{row.label}</dt>
										<dd className="leading-5">{row.value}</dd>
									</div>
								))}
							</dl>
						) : null}
						{why ? (
							<p className="border-t pt-3 text-muted-foreground text-sm leading-5">
								<span className="font-medium text-foreground">
									Why it matters:{" "}
								</span>
								{why}
							</p>
						) : null}
					</div>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
