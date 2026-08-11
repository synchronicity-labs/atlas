"use client";

import Add from "@carbon/icons-react/es/Add";
import ChevronDown from "@carbon/icons-react/es/ChevronDown";
import Edit from "@carbon/icons-react/es/Edit";
import Send from "@carbon/icons-react/es/Send";
import TrashCan from "@carbon/icons-react/es/TrashCan";
import { Bubble, BubbleContent } from "@crm/ui/components/bubble";
import { Button } from "@crm/ui/components/button";
import {
	ChatComposer,
	ChatComposerField,
	ChatComposerFooter,
	ChatComposerHint,
	ChatComposerInput,
	ChatComposerSubmit,
} from "@crm/ui/components/chat-composer";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Icon } from "@crm/ui/components/icon";
import Logo from "@crm/ui/components/logo";
import { Markdown } from "@crm/ui/components/markdown";
import { Marker, MarkerContent, MarkerIcon } from "@crm/ui/components/marker";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "@crm/ui/components/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@crm/ui/components/message-scroller";
import { RelativeTimestamp } from "@crm/ui/components/relative-timestamp";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { AgentRecord, AtlasAgentRecord } from "@/lib/agent-record";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

const NEW_THREAD = "new";

export function RudyConversationPanel({
	record,
	thread,
	onThreadChange,
}: {
	record: AtlasAgentRecord;
	thread: string | null;
	onThreadChange: (thread: string | null) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const context = { kind: record.kind, id: record.id } as const;
	const threads = useQuery(trpc.rudy.list.queryOptions(context));
	const history = threads.data ?? [];

	useEffect(() => {
		if (!threads.isSuccess || thread !== null) return;
		onThreadChange(history[0]?.id ?? NEW_THREAD);
	}, [history, onThreadChange, thread, threads.isSuccess]);

	const current =
		thread === NEW_THREAD
			? null
			: (history.find((item) => item.id === thread) ?? null);
	const messages = useQuery({
		...trpc.rudy.messages.queryOptions({ id: current?.id ?? "" }),
		enabled: current !== null,
		staleTime: 0,
		refetchOnWindowFocus: false,
	});
	const [draft, setDraft] = useState("");
	const [optimistic, setOptimistic] = useState<string | null>(null);
	const transcript =
		messages.data?.messages.filter((message) => message.content.trim()) ?? [];

	const send = useMutation(
		trpc.rudy.send.mutationOptions({
			onSuccess: async (result) => {
				setOptimistic(null);
				onThreadChange(result.thread.id);
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: trpc.rudy.list.pathKey() }),
					queryClient.invalidateQueries({
						queryKey: trpc.rudy.messages.pathKey(),
					}),
				]);
			},
			onError: (error) => {
				setOptimistic(null);
				toast.error(error.message);
			},
		}),
	);

	const remove = useMutation(
		trpc.rudy.remove.mutationOptions({
			onSuccess: async () => {
				onThreadChange(NEW_THREAD);
				await queryClient.invalidateQueries({
					queryKey: trpc.rudy.list.pathKey(),
				});
				toast.success("Rudy conversation deleted.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const ask = (value: string) => {
		const message = value.trim();
		if (!message || send.isPending) return;
		setDraft("");
		setOptimistic(message);
		send.mutate({
			context,
			...(current ? { threadId: current.id } : {}),
			message,
		});
	};

	if (threads.isPending) return <Loading />;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-2 border-b px-5 py-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="min-w-0 flex-1 justify-start px-2 font-normal"
						>
							<span className="truncate">
								{current?.title ?? "New conversation"}
							</span>
							<Icon icon={ChevronDown} data-icon="inline-end" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-72">
						{history.length === 0 ? (
							<DropdownMenuItem disabled>Nothing yet</DropdownMenuItem>
						) : (
							history.map((item) => (
								<DropdownMenuItem
									key={item.id}
									onSelect={() => onThreadChange(item.id)}
								>
									<span className="min-w-0 flex-1 truncate">
										{item.title ?? "Untitled"}
									</span>
									<span className="shrink-0 text-muted-foreground text-xs">
										<RelativeTimestamp value={item.lastMessageAt} prefix="" />
									</span>
								</DropdownMenuItem>
							))
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => onThreadChange(NEW_THREAD)}>
							<Icon icon={Add} data-icon="inline-start" />
							New conversation
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				{current ? (
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={send.isPending || remove.isPending}
						onClick={() => remove.mutate({ id: current.id })}
					>
						<Icon icon={TrashCan} />
						<span className="sr-only">Delete this conversation</span>
					</Button>
				) : null}
			</div>

			<MessageScrollerProvider
				autoScroll
				defaultScrollPosition="last-anchor"
				scrollPreviousItemPeek={40}
			>
				<MessageScroller className="flex-1">
					<MessageScrollerViewport>
						<MessageScrollerContent className="px-5 py-4">
							{messages.isPending && current ? <Loading /> : null}
							{!current && !optimistic ? (
								<Idle record={record} onAsk={ask} />
							) : null}
							{transcript.map((message) => (
								<MessageScrollerItem
									key={message.id}
									messageId={message.id}
									scrollAnchor={message.role === "user"}
								>
									<ChatMessage
										speaker={message.role}
										content={message.content}
									/>
								</MessageScrollerItem>
							))}
							{messages.data?.proposals.map((proposal) => (
								<MessageScrollerItem key={proposal.id} messageId={proposal.id}>
									<Proposal proposal={proposal} />
								</MessageScrollerItem>
							))}
							{optimistic ? (
								<>
									<MessageScrollerItem messageId="optimistic-user" scrollAnchor>
										<ChatMessage speaker="user" content={optimistic} />
									</MessageScrollerItem>
									<MessageScrollerItem messageId="optimistic-rudy">
										<Marker aria-live="polite">
											<MarkerIcon>
												<Spinner />
											</MarkerIcon>
											<MarkerContent>
												<span className="shimmer">
													Rudy is thinking with the current Atlas context…
												</span>
											</MarkerContent>
										</Marker>
									</MessageScrollerItem>
								</>
							) : null}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>

			{messages.error ? (
				<p className="border-t px-5 py-2 text-destructive text-xs">
					{messages.error.message}
				</p>
			) : null}

			<ChatComposer
				onSubmit={(event) => {
					event.preventDefault();
					ask(draft);
				}}
			>
				<ChatComposerField>
					<ChatComposerInput
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key !== "Enter" ||
								event.shiftKey ||
								event.nativeEvent.isComposing
							)
								return;
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}}
						placeholder={placeholder(record.kind)}
						disabled={send.isPending}
						aria-label={placeholder(record.kind)}
					/>
					<ChatComposerFooter>
						<ChatComposerHint>
							Enter to send · Shift+Enter for a new line
						</ChatComposerHint>
						<ChatComposerSubmit disabled={send.isPending || !draft.trim()}>
							{send.isPending ? <Spinner /> : <Icon icon={Send} />}
							<span className="sr-only">Ask Rudy</span>
						</ChatComposerSubmit>
					</ChatComposerFooter>
				</ChatComposerField>
			</ChatComposer>
		</div>
	);
}

function Idle({
	record,
	onAsk,
}: {
	record: AtlasAgentRecord;
	onAsk: (message: string) => void;
}) {
	const suggestions =
		record.kind === "question"
			? ["Explain this metric", "Audit this query", "Suggest a safer version"]
			: record.kind === "dashboard"
				? [
						"Summarize this dashboard",
						"What looks stale?",
						"What should I investigate?",
					]
				: [
						"What changed recently?",
						"Which sources are stale?",
						"Find an Atlas metric",
					];
	return (
		<Empty width="wide">
			<EmptyHeader>
				<EmptyMedia>
					<span className="flex size-8 items-center justify-center bg-foreground text-background">
						<Logo className="size-4" />
					</span>
				</EmptyMedia>
				<EmptyTitle>Ask Rudy here</EmptyTitle>
				<EmptyDescription>
					This opens a real Rudy session and keeps the Atlas context attached
					across follow-ups.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent layout="row">
				{suggestions.map((suggestion) => (
					<Button
						key={suggestion}
						variant="outline"
						size="sm"
						onClick={() => onAsk(suggestion)}
					>
						{suggestion}
					</Button>
				))}
			</EmptyContent>
		</Empty>
	);
}

function ChatMessage({
	speaker,
	content,
}: {
	speaker: "user" | "assistant";
	content: string;
}) {
	if (speaker === "user") {
		return (
			<Message align="end">
				<MessageContent>
					<Bubble variant="secondary" align="end">
						<BubbleContent>{content}</BubbleContent>
					</Bubble>
				</MessageContent>
			</Message>
		);
	}
	return (
		<Message>
			<MessageContent>
				<MessageHeader>
					<Logo className="size-3" />
					Rudy
				</MessageHeader>
				<Bubble variant="ghost">
					<BubbleContent>
						<Markdown>{content}</Markdown>
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
	);
}

function Proposal({
	proposal,
}: {
	proposal: RouterOutputs["rudy"]["messages"]["proposals"][number];
}) {
	return (
		<div className="ml-9 rounded-md border bg-muted/30 p-3">
			<div className="flex items-start gap-2">
				<Icon icon={Edit} className="mt-0.5 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<p className="font-medium text-sm">
						Proposed edit to question {proposal.questionNumber}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{proposal.summary}
					</p>
					<Button asChild variant="outline" size="sm" className="mt-3">
						<Link href={proposal.reviewUrl}>Review and preview</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}

function Loading() {
	return (
		<div className="flex flex-1 items-center justify-center py-8">
			<Spinner />
		</div>
	);
}

function placeholder(kind: AgentRecord["kind"]): string {
	if (kind === "question") return "Ask about or change this question…";
	if (kind === "dashboard") return "Ask about this dashboard…";
	return "Ask Rudy across Atlas…";
}
