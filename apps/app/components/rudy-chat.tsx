"use client";

import Chat from "@carbon/icons-react/es/Chat";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import Logo from "@crm/ui/components/logo";
import { cn } from "@crm/ui/lib/utils";
import { parseAsString, useQueryStates } from "nuqs";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/responsive-sheet";
import { RudyConversationPanel } from "@/components/rudy-conversation-panel";
import type { AgentRecord, AtlasAgentRecord } from "@/lib/agent-record";

const parsers = {
	rudy: parseAsString,
	rudyThread: parseAsString,
};

function serialize(record: AgentRecord): string {
	return `${record.kind}:${record.id}`;
}

function parse(value: string | null): AtlasAgentRecord | null {
	if (!value) return null;
	const separator = value.indexOf(":");
	if (separator === -1) return null;
	const kind = value.slice(0, separator);
	const id = value.slice(separator + 1);
	if (!id) return null;
	if (kind === "workspace" && id === "atlas") return { kind, id };
	if ((kind === "dashboard" || kind === "question") && /^[1-9]\d*$/.test(id)) {
		return { kind, id };
	}
	return null;
}

function contextLabel(record: AgentRecord): string {
	if (record.kind === "workspace") return "All of Atlas";
	if (record.kind === "dashboard") return `Dashboard ${record.id}`;
	if (record.kind === "question") return `Question ${record.id}`;
	return "Atlas";
}

export function RudyChatHost() {
	const [{ rudy, rudyThread }, setParams] = useQueryStates(parsers);
	const record = parse(rudy);

	return (
		<Sheet
			open={record !== null}
			onOpenChange={(open) => {
				if (!open) void setParams({ rudy: null, rudyThread: null });
			}}
		>
			<SheetContent
				side="right"
				size="chat"
				className="gap-0 overflow-hidden p-0"
			>
				{record ? (
					<>
						<SheetHeader className="shrink-0 border-b pr-12">
							<div className="flex items-center gap-2.5">
								<span className="flex size-8 items-center justify-center rounded-md bg-foreground text-background">
									<Logo className="size-4" />
								</span>
								<div className="min-w-0">
									<SheetTitle>Rudy</SheetTitle>
									<SheetDescription className="truncate">
										{contextLabel(record)} · Atlas context attached
									</SheetDescription>
								</div>
							</div>
						</SheetHeader>
						<div className="flex min-h-0 flex-1">
							<RudyConversationPanel
								key={serialize(record)}
								record={record}
								thread={rudyThread}
								onThreadChange={(thread) =>
									void setParams({ rudyThread: thread })
								}
							/>
						</div>
					</>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

export function RudyChatTrigger({
	record,
	label = "Ask Rudy",
	iconOnly = false,
	variant = "outline",
	className,
}: {
	record: AgentRecord;
	label?: string;
	iconOnly?: boolean;
	variant?: "outline" | "ghost";
	className?: string;
}) {
	const [, setParams] = useQueryStates(parsers);
	return (
		<Button
			type="button"
			variant={variant}
			size={iconOnly ? "icon-xs" : "sm"}
			className={cn(className)}
			aria-label={label}
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => {
				event.stopPropagation();
				void setParams({ rudy: serialize(record), rudyThread: null });
			}}
		>
			<Icon icon={Chat} />
			{iconOnly ? <span className="sr-only">{label}</span> : label}
		</Button>
	);
}
