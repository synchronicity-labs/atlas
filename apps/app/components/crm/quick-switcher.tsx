"use client";

import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@crm/ui/components/command";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { useMountEffect } from "@crm/ui/hooks/use-mount-effect";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

const GROUP_LABEL = {
	user: "Product users",
} as const;

const KINDS = ["user"] as const;

export function QuickSwitcher() {
	const router = useRouter();
	const trpc = useTRPC();

	const [open, setOpen] = useQueryState("k", parseAsBoolean.withDefault(false));
	const [query, setQuery] = useState("");

	useMountEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void setOpen((current) => (current ? null : true));
			}
		};

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	const results = useQuery({
		...trpc.search.quick.queryOptions({ q: query }),
		enabled: open && query.trim().length >= 2,
		placeholderData: (previous) => previous,
	});

	const hits = results.data?.hits ?? [];

	const go = (id: string) => {
		setQuery("");
		void setOpen(null);
		router.push(`/users/${id}`);
	};

	return (
		<CommandDialog
			open={open}
			onOpenChange={(next) => setOpen(next || null)}
			title="Search"
			description="Jump to a product user"
		>
			<Command shouldFilter={false}>
				<CommandInput
					placeholder="Search product users…"
					value={query}
					onValueChange={setQuery}
				/>
				<CommandList>
					<CommandEmpty>
						{query.trim().length < 2
							? "Type at least two characters."
							: "Nothing matches."}
					</CommandEmpty>

					{KINDS.map((kind) => {
						const group = hits.filter((hit) => hit.kind === kind);
						if (group.length === 0) return null;

						return (
							<CommandGroup key={kind} heading={GROUP_LABEL[kind]}>
								{group.map((hit) => (
									<CommandItem
										key={`${hit.kind}:${hit.id}`}
										value={`${hit.kind}:${hit.id}`}
										onSelect={() => go(hit.id)}
									>
										<PersonAvatar
											src={hit.imageUrl}
											name={hit.label}
											size="sm"
										/>
										<span className="flex min-w-0 flex-col">
											<span className="truncate">{hit.label}</span>
											{hit.detail ? (
												<span className="truncate text-muted-foreground text-xs">
													{hit.detail}
												</span>
											) : null}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						);
					})}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
