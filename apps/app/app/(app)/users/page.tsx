import type { Metadata } from "next";
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
import { usersSearchParams } from "./users-search-params";
import { UsersTable } from "./users-table";

export const metadata: Metadata = { title: "Product users" };

export default async function ProductUsersPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();
	const values = await usersSearchParams.load(searchParams);
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.productUsers.list.queryOptions(usersSearchParams.toInput(values)),
	);

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Product users</PageShellTitle>
					<PageShellDescription>
						People observed across the product, kept distinct by user ID even
						when emails or organizations overlap.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent className="min-h-0">
				<HydrateClient>
					<UsersTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
