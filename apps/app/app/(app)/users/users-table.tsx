"use client";

import { DataTable, type DataTableColumn } from "@crm/ui/components/data-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ListSearch } from "@/components/data-table/list-search";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { usersSearchParams } from "./users-search-params";

type ProductUserRow = RouterOutputs["productUsers"]["list"]["rows"][number];

function userName(user: ProductUserRow): string {
	return user.displayName ?? user.email ?? user.externalId;
}

function organizationNames(user: ProductUserRow): string {
	const names = user.organizations.map((organization) => {
		const name = organization.name?.trim();
		if (!name) return "Unnamed workspace";
		return /^personal$/i.test(name) ? "Personal workspace" : name;
	});
	return names.join(" · ");
}

const COLUMNS: DataTableColumn<ProductUserRow>[] = [
	{
		id: "name",
		header: "User",
		sortable: true,
		hideable: false,
		width: "w-[23%]",
		cell: (user) => (
			<span className="flex min-w-0 items-center gap-2">
				<PersonAvatar
					src={user.avatarUrl}
					name={userName(user)}
					email={user.email}
					size="sm"
				/>
				<span className="truncate font-medium">{userName(user)}</span>
			</span>
		),
	},
	{
		id: "email",
		header: "Email",
		sortable: true,
		width: "w-[24%]",
		cell: (user) =>
			user.email ? (
				<span className="truncate text-muted-foreground">{user.email}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "id",
		header: "User ID",
		sortable: true,
		width: "w-[22%]",
		hideBelow: "lg",
		cell: (user) => (
			<span className="truncate font-mono text-muted-foreground text-xs">
				{user.externalId}
			</span>
		),
	},
	{
		id: "organizations",
		header: "Organizations",
		width: "w-[24%]",
		hideBelow: "md",
		cell: (user) =>
			user.organizations.length > 0 ? (
				<span className="flex min-w-0 items-center gap-2">
					<span className="truncate">{organizationNames(user)}</span>
					{user.organizations.length > 1 ? (
						<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
							{user.organizations.length}
						</span>
					) : null}
				</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "syncedAt",
		header: "Observed",
		sortable: true,
		align: "right",
		width: "w-[12%]",
		hideBelow: "sm",
		cell: (user) => (
			<span className="text-muted-foreground" suppressHydrationWarning>
				{relativeTimeFromIso(user.syncedAt)}
			</span>
		),
	},
];

export function UsersTable() {
	const router = useRouter();
	const trpc = useTRPC();
	const { query, input } = useTableQuery(usersSearchParams);
	const users = useQuery({
		...trpc.productUsers.list.queryOptions(input),
		placeholderData: (previous) => previous,
	});
	const source = users.data?.source;
	const fresh =
		source?.freshnessDeadlineAt != null &&
		new Date(source.freshnessDeadlineAt).getTime() > Date.now();

	return (
		<DataTable
			query={query}
			search={
				<ListSearch placeholder="Search email, user ID, name or organization…" />
			}
			columns={COLUMNS}
			rows={users.data?.rows ?? []}
			total={users.data?.total ?? 0}
			getRowId={(user) => user.id}
			loading={users.isFetching}
			onRowClick={(user) => router.push(`/users/${user.id}`)}
			meta={
				source ? (
					<StatusIndicator
						tone={
							source.state === "ERROR" ? "error" : fresh ? "success" : "warning"
						}
						label={
							source.state === "ERROR"
								? "Metabase sync needs attention"
								: fresh
									? "Fresh from Metabase"
									: "Metabase data is stale"
						}
						size="sm"
					/>
				) : null
			}
			empty="No product users match this search."
		/>
	);
}
