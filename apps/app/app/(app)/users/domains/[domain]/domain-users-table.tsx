"use client";

import { DataTable, type DataTableColumn } from "@crm/ui/components/data-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ListSearch } from "@/components/data-table/list-search";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { domainSearchParams } from "./domain-search-params";

type DomainUser = RouterOutputs["productUsers"]["domain"]["rows"][number];

function userName(user: DomainUser): string {
	return user.displayName ?? user.email ?? user.externalId;
}

function organizationNames(user: DomainUser): string {
	return user.organizations
		.map((organization) => {
			const name = organization.name?.trim();
			if (!name) return "Unnamed workspace";
			return /^personal$/i.test(name) ? "Personal workspace" : name;
		})
		.join(" · ");
}

const COLUMNS: DataTableColumn<DomainUser>[] = [
	{
		id: "name",
		header: "Person",
		sortable: true,
		hideable: false,
		width: "w-[30%]",
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
		width: "w-[30%]",
		cell: (user) =>
			user.email ? (
				<span className="truncate text-muted-foreground">{user.email}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "organizations",
		header: "Product organizations",
		width: "w-[28%]",
		hideBelow: "md",
		cell: (user) =>
			user.organizations.length > 0 ? (
				<span className="truncate">{organizationNames(user)}</span>
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
		cell: (user) => (
			<span className="text-muted-foreground" suppressHydrationWarning>
				{relativeTimeFromIso(user.syncedAt)}
			</span>
		),
	},
];

export function DomainUsersTable({ domain }: { domain: string }) {
	const router = useRouter();
	const trpc = useTRPC();
	const { query, input } = useTableQuery(domainSearchParams);
	const users = useQuery({
		...trpc.productUsers.domain.queryOptions({ ...input, domain }),
		placeholderData: (previous) => previous,
	});

	return (
		<DataTable
			query={query}
			search={<ListSearch placeholder={`Search people at ${domain}…`} />}
			columns={COLUMNS}
			rows={users.data?.rows ?? []}
			total={users.data?.total ?? 0}
			getRowId={(user) => user.id}
			loading={users.isFetching}
			onRowClick={(user) => router.push(`/users/${user.id}`)}
			empty={`No product users at ${domain} match this search.`}
		/>
	);
}
