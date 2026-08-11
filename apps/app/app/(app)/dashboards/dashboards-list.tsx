"use client";

import ArrowRight from "@carbon/icons-react/es/ArrowRight";
import { Icon } from "@crm/ui/components/icon";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc/client";

export function DashboardsList() {
	const trpc = useTRPC();
	const dashboards = useQuery(trpc.atlasDashboards.list.queryOptions());

	if (!dashboards.data) {
		return <div className="h-48 animate-pulse rounded-lg bg-muted" />;
	}

	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			{dashboards.data.map((dashboard) => (
				<Link
					key={dashboard.id}
					href={`/dashboards/${dashboard.number}`}
					className="group grid gap-4 border-b p-5 transition-colors last:border-0 hover:bg-muted/45 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:items-center"
				>
					<span className="font-mono text-muted-foreground text-xs tabular-nums">
						D{String(dashboard.number).padStart(2, "0")}
					</span>
					<span className="min-w-0">
						<span className="block truncate font-medium">{dashboard.name}</span>
						<span className="mt-1 block truncate text-muted-foreground text-sm">
							{dashboard.description ?? "No description"}
						</span>
					</span>
					<span className="flex items-center gap-5 text-muted-foreground text-xs">
						<span className="whitespace-nowrap tabular-nums">
							{dashboard.questionCount} questions · {dashboard.tabCount} tabs
						</span>
						<span
							className="hidden whitespace-nowrap lg:inline"
							suppressHydrationWarning
						>
							{relativeTimeFromIso(dashboard.updatedAt)}
						</span>
						<span className="text-foreground transition-transform group-hover:translate-x-0.5">
							<Icon icon={ArrowRight} />
						</span>
					</span>
				</Link>
			))}
		</div>
	);
}
