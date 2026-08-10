import ArrowLeft from "@carbon/icons-react/es/ArrowLeft";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import type { Metadata } from "next";
import Link from "next/link";
import type { SearchParams } from "nuqs/server";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { domainSearchParams } from "./domain-search-params";
import { DomainUsersTable } from "./domain-users-table";

export const metadata: Metadata = { title: "Company domain" };

export default async function ProductUserDomainPage({
	params,
	searchParams,
}: {
	params: Promise<{ domain: string }>;
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();
	const domain = (await params).domain.toLowerCase();
	const values = await domainSearchParams.load(searchParams);
	const input = { ...domainSearchParams.toInput(values), domain };
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	const result = await queryClient.fetchQuery(
		trpc.productUsers.domain.queryOptions(input),
	);

	return (
		<PageShell className="min-h-0">
			<Button asChild variant="ghost" size="sm">
				<Link href="/users">
					<Icon icon={ArrowLeft} />
					Product users
				</Link>
			</Button>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>{result.domain}</PageShellTitle>
					<PageShellDescription>
						People and product organizations connected by a verified work-email
						domain.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-4">
					<div className="border-b p-4 sm:border-r xl:border-b-0">
						<p className="text-muted-foreground text-xs">People</p>
						<p className="mt-1 font-medium text-2xl tabular-nums">
							{result.stats.people.toLocaleString()}
						</p>
					</div>
					<div className="border-b p-4 xl:border-r xl:border-b-0">
						<p className="text-muted-foreground text-xs">Product workspaces</p>
						<p className="mt-1 font-medium text-2xl tabular-nums">
							{result.stats.organizations.toLocaleString()}
						</p>
					</div>
					<div className="border-b p-4 sm:border-r sm:border-b-0 xl:border-r">
						<p className="text-muted-foreground text-xs">
							Paid-plan workspaces
						</p>
						<p className="mt-1 font-medium text-2xl tabular-nums">
							{result.stats.paidOrganizations.toLocaleString()}
						</p>
					</div>
					<div className="p-4">
						<p className="text-muted-foreground text-xs">Last observed</p>
						<p className="mt-2 text-sm" suppressHydrationWarning>
							{result.stats.lastObservedAt
								? relativeTimeFromIso(result.stats.lastObservedAt)
								: "Never"}
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-3 text-xs">
					<span className="text-muted-foreground">Workspace plan mix</span>
					{result.stats.planCounts.map((plan) => (
						<span key={plan.plan} className="tabular-nums">
							{plan.plan} {plan.count.toLocaleString()}
						</span>
					))}
				</div>

				<HydrateClient>
					<DomainUsersTable domain={result.domain} />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
