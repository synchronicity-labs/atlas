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

import { definitionRows } from "../lib/question-explanation-language";

function explanationParts(explanation: string) {
	const [summary, why] = explanation.split(/\s+Why it matters:\s+/i, 2);
	return { summary, why: why ?? null };
}

const TERM_DEFINITIONS = [
	{
		term: "NDR",
		pattern: /\bNDR\b/i,
		definition:
			"Net dollar retention. It compares value from the same starting customer group. Above 100% means the group grew; below 100% means it shrank.",
	},
	{
		term: "M3",
		pattern: /\bM3\b/i,
		definition:
			"Month 3 of a cohort. Atlas measures it two calendar months after the starting month, also called M+2.",
	},
	{
		term: "MSA",
		pattern: /\bMSA\b/i,
		definition:
			"Master services agreement. This is the main contract that sets the general terms for work with a customer.",
	},
	{
		term: "SOW",
		pattern: /\bSOW\b/i,
		definition:
			"Statement of work. This defines the scope, price, and delivery terms for a specific project.",
	},
	{
		term: "MTD",
		pattern: /\bMTD\b/i,
		definition:
			"Month to date. This starts at 00:00 UTC on the first day of the current month and ends at the shown data-through time.",
	},
	{
		term: "YTD",
		pattern: /\bYTD\b/i,
		definition:
			"Year to date. This starts at 00:00 UTC on January 1 and ends at the shown data-through time.",
	},
	{
		term: "MoM",
		pattern: /\bMoM\b/i,
		definition:
			"Month over month. This compares one calendar month with the previous calendar month.",
	},
	{
		term: "ARR",
		pattern: /\bARR\b/i,
		definition:
			"Annual recurring revenue. Atlas must state the monthly value and the annualization rule used to produce it.",
	},
	{
		term: "MRR",
		pattern: /\bMRR\b/i,
		definition:
			"Monthly recurring revenue. This is recurring subscription value for one month, not usage, bookings, or cash collected.",
	},
	{
		term: "LTV",
		pattern: /\bLTV\b/i,
		definition:
			"Lifetime value. This estimates how much value one customer produces during the full customer relationship.",
	},
	{
		term: "GLR",
		pattern: /\bGLR\b/i,
		definition:
			"Gross logo retention. This is the share of starting customer organizations that remain customers, without counting expansion.",
	},
	{
		term: "COGS",
		pattern: /\bCOGS\b/i,
		definition:
			"Cost of goods sold. These are the direct costs required to deliver the product or service.",
	},
	{
		term: "GA4",
		pattern: /\bGA4\b/i,
		definition:
			"Google Analytics 4. This is Google’s web and app analytics product.",
	},
	{
		term: "CRM",
		pattern: /\bCRM\b/i,
		definition:
			"Customer relationship management system. In Atlas, this usually means HubSpot customer and sales records.",
	},
	{
		term: "PLG",
		pattern: /\bPLG\b/i,
		definition:
			"Product-led growth. This means customers adopt or buy through the product rather than a sales-led contract.",
	},
	{
		term: "V2",
		pattern: /\bV2\b/i,
		definition:
			"Billing version 2. Customers pay a subscription and are billed for postpaid usage.",
	},
	{
		term: "V3",
		pattern: /\bV3\b/i,
		definition:
			"Billing version 3. Customers prepay with top-ups, then spend credits as they use the product.",
	},
] as const;

function termsUsed(questionName: string, explanation: string) {
	const source = `${questionName} ${explanation}`;
	return TERM_DEFINITIONS.filter(({ pattern }) => pattern.test(source));
}

function TermsUsed({
	questionName,
	explanation,
	compact = false,
}: {
	questionName: string;
	explanation: string;
	compact?: boolean;
}) {
	const terms = termsUsed(questionName, explanation);
	if (terms.length === 0) return null;
	return (
		<div className="border-t pt-3">
			<p className="mb-2 font-medium text-xs">Terms used</p>
			<dl className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-2"}>
				{terms.map(({ term, definition }) => (
					<div key={term} className="text-sm leading-5">
						<dt className="font-medium">{term}</dt>
						<dd className="text-muted-foreground">{definition}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

export function QuestionExplanationPanel({
	questionName,
	explanation,
	definition,
}: {
	questionName: string;
	explanation: string;
	definition?: unknown;
}) {
	const rows = definitionRows(definition);
	const { summary, why } = explanationParts(explanation);

	return (
		<CardContent className="grid gap-5">
			<div className="max-w-3xl">
				<p className="font-medium text-sm">What this question answers</p>
				<p className="mt-1 text-muted-foreground text-sm leading-6">
					{summary}
				</p>
			</div>
			{rows.length > 0 ? (
				<div className="border-t pt-4">
					<p className="mb-3 font-medium text-sm">How Atlas counts it</p>
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
			<TermsUsed questionName={questionName} explanation={explanation} />
		</CardContent>
	);
}

export function QuestionExplanationTooltip({
	questionName,
	explanation,
	definition,
}: {
	questionName: string;
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
					<div className="grid max-h-[min(36rem,calc(100vh-4rem))] w-96 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto">
						<div>
							<p className="font-medium text-sm">What this question answers</p>
							<p className="mt-1 text-muted-foreground text-sm leading-5">
								{summary}
							</p>
						</div>
						{rows.length > 0 ? (
							<dl className="grid gap-2 border-t pt-3">
								<p className="font-medium text-xs">How Atlas counts it</p>
								{rows.map((row) => (
									<div
										key={row.label}
										className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)] gap-3 text-sm"
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
						<TermsUsed
							questionName={questionName}
							explanation={explanation}
							compact
						/>
					</div>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
