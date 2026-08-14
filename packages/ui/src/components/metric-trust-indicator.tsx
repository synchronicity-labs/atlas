"use client";

import CheckmarkFilled from "@carbon/icons-react/es/CheckmarkFilled";
import HelpFilled from "@carbon/icons-react/es/HelpFilled";
import Misuse from "@carbon/icons-react/es/Misuse";
import PendingFilled from "@carbon/icons-react/es/PendingFilled";
import WarningAltFilled from "@carbon/icons-react/es/WarningAltFilled";
import { Icon, type CarbonIcon } from "@crm/ui/components/icon";
import { RelativeTimestamp } from "@crm/ui/components/relative-timestamp";
import { IndicatorDot, type StatusTone } from "@crm/ui/components/status-indicator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";

type TrustStatus = "VERIFIED" | "PENDING" | "FAILED" | "STALE";
type CheckStatus = "PENDING" | "PASSED" | "FAILED" | "WAIVED";

export type MetricTrustSummary = {
	status: TrustStatus;
	reason: string;
	reportingPeriod: string | null;
	dataThrough: string | null;
	computedAt: string | null;
	checks: Array<{
		name: string;
		label: string;
		status: CheckStatus;
		detail: string | null;
		verifiedAt: string | null;
	}>;
	verifiedQuestions: number | null;
	totalQuestions: number | null;
};

const STATUS: Record<
	TrustStatus,
	{ label: string; tone: StatusTone; icon: CarbonIcon; iconClass: string }
> = {
	VERIFIED: {
		label: "Verified",
		tone: "success",
		icon: CheckmarkFilled,
		iconClass: "text-success",
	},
	PENDING: {
		label: "Verification pending",
		tone: "warning",
		icon: PendingFilled,
		iconClass: "text-warning",
	},
	FAILED: {
		label: "Verification failed",
		tone: "error",
		icon: Misuse,
		iconClass: "text-destructive",
	},
	STALE: {
		label: "Verification stale",
		tone: "warning",
		icon: WarningAltFilled,
		iconClass: "text-warning",
	},
};

export function MetricTrustIndicator({
	summary,
	compact = false,
}: {
	summary: MetricTrustSummary | null;
	compact?: boolean;
}) {
	const state = summary
		? STATUS[summary.status]
		: {
				label: "Not governed",
				tone: "neutral" as const,
				icon: HelpFilled,
				iconClass: "text-muted-foreground",
			};
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className="inline-flex cursor-help items-center"
					tabIndex={0}
					aria-label={state.label}
				>
					<Icon icon={state.icon} className={state.iconClass} size={compact ? 14 : 16} />
					{compact ? null : (
						<span className="ml-1.5 truncate text-muted-foreground text-xs">
							{state.label}
						</span>
					)}
				</span>
			</TooltipTrigger>
			<TooltipContent>
				<span className="flex max-w-xs flex-col gap-2">
					<span className="font-medium">{state.label}</span>
					<span className="opacity-80">
						{summary?.reason ??
							"This question does not have a governed metric snapshot yet."}
					</span>
					{summary?.checks.length ? (
						<span className="flex flex-col gap-1 border-t border-background/20 pt-2">
							{summary.checks.map((check) => (
								<span key={check.name} className="flex items-start gap-2">
									<IndicatorDot
										tone={checkTone(check.status)}
										className="mt-1"
									/>
									<span>
										<span className="block">{check.label}</span>
										{check.detail ? (
											<span className="block opacity-65">{check.detail}</span>
										) : null}
									</span>
								</span>
							))}
						</span>
					) : null}
					{summary?.dataThrough ? (
						<span className="border-t border-background/20 pt-2 opacity-65">
							Data through {new Date(summary.dataThrough).toLocaleString("en-US", {
								timeZone: "UTC",
								timeZoneName: "short",
							})}
						</span>
					) : null}
					{summary?.computedAt ? (
						<span className="opacity-65">
							Checked <RelativeTimestamp value={summary.computedAt} prefix="" />
						</span>
					) : null}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

function checkTone(status: CheckStatus): StatusTone {
	if (status === "PASSED" || status === "WAIVED") return "success";
	if (status === "FAILED") return "error";
	return "warning";
}
