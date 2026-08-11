import ArrowLeft from "@carbon/icons-react/es/ArrowLeft";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Icon } from "@crm/ui/components/icon";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import type { Metadata } from "next";
import Link from "next/link";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { recordHref } from "@/lib/record-href";
import { requireSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export const metadata: Metadata = { title: "Product user" };

function value(value: string | null | undefined): string {
	return value || "—";
}

function dateValue(value: string | null | undefined): string {
	if (!value) return "—";
	return new Date(value).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

function objectValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function textValue(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return null;
}

function numberValue(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

type SourceLinkView = {
	method: string;
	sourceRecord: {
		payload: unknown;
		syncedAt: string;
		source: { key: string; label: string };
	};
};

export default async function ProductUserPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireSession();
	const { id } = await params;
	const trpc = getServerTrpc();
	const user = await getServerQueryClient().fetchQuery(
		trpc.productUsers.byId.queryOptions({ id }),
	);
	const name = user.displayName ?? user.email ?? user.externalId;
	const accountState = user.banned
		? "Banned"
		: user.disabled
			? "Disabled"
			: user.isAnonymous
				? "Anonymous"
				: user.banned === false || user.disabled === false
					? "Active"
					: "Status unavailable";
	const sourceLinks = user.sourceLinks as unknown as SourceLinkView[];
	const posthog = sourceLinks.find(
		(link) => link.sourceRecord.source.key === "posthog:product",
	);
	const posthogPayload = objectValue(posthog?.sourceRecord.payload);
	const activity = objectValue(posthogPayload.activity);
	const properties = objectValue(posthogPayload.properties);
	const clients = new Map<
		string,
		{ id: string; name: string; domain: string | null; method: string }
	>();
	for (const link of user.companyLinks) {
		clients.set(link.company.id, { ...link.company, method: link.method });
	}
	for (const link of user.contactLinks) {
		if (link.contact.company) {
			clients.set(link.contact.company.id, {
				...link.contact.company,
				method: link.method,
			});
		}
	}
	const acquisition = [
		[
			"Source",
			properties.sync_attr_source_type ?? properties.$initial_utm_source,
		],
		[
			"Medium",
			properties.sync_attr_utm_medium ?? properties.$initial_utm_medium,
		],
		[
			"Campaign",
			properties.sync_attr_utm_campaign ?? properties.$initial_utm_campaign,
		],
		[
			"Landing page",
			properties.sync_attr_landing_page ?? properties.$initial_current_url,
		],
		[
			"Referrer",
			properties.sync_attr_referrer ?? properties.$initial_referring_domain,
		],
	].flatMap(([label, raw]) => {
		const resolved = textValue(raw);
		return resolved ? [{ label: String(label), value: resolved }] : [];
	});

	return (
		<PageShell>
			<Button asChild variant="ghost" size="sm" className="w-fit">
				<Link href="/users">
					<Icon icon={ArrowLeft} />
					Product users
				</Link>
			</Button>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle className="flex items-center gap-3">
						<PersonAvatar
							src={user.avatarUrl}
							name={name}
							email={user.email}
							size="lg"
						/>
						<span className="truncate">{name}</span>
					</PageShellTitle>
					<PageShellDescription>
						A source-backed identity. Shared emails remain separate records.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<div className="grid gap-6 lg:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle>Client bridge</CardTitle>
							<CardDescription>
								The CRM account Atlas can connect to this product identity.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{clients.size > 0 ? (
								<div className="space-y-3">
									{Array.from(clients.values()).map((client) => (
										<div
											key={client.id}
											className="flex items-center justify-between gap-4 rounded-md border p-3"
										>
											<div className="min-w-0">
												<p className="truncate font-medium">{client.name}</p>
												<p className="text-muted-foreground text-xs">
													{client.domain || "No domain"} ·{" "}
													{client.method.toLowerCase().replaceAll("_", " ")}
												</p>
											</div>
											<Button asChild variant="outline" size="sm">
												<Link
													href={recordHref("/companies", "company", client.id)}
												>
													Open client
												</Link>
											</Button>
										</div>
									))}
								</div>
							) : (
								<p className="text-muted-foreground text-sm">
									No verified CRM client match yet. Atlas will not invent one
									from a similar name.
								</p>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Product behavior</CardTitle>
							<CardDescription>
								A 30-day PostHog view attached to this exact identity.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{posthog ? (
								<div className="space-y-4">
									<StatusIndicator
										tone="success"
										label={`${posthog.sourceRecord.source.label} · ${posthog.method.toLowerCase().replaceAll("_", " ")}`}
									/>
									<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
										{(
											[
												["Events", activity.events30d],
												["Active days", activity.activeDays30d],
												["Sessions", activity.sessions30d],
												["Pageviews", activity.pageviews30d],
											] as Array<[string, unknown]>
										).map(([label, metric]) => (
											<div
												key={String(label)}
												className="rounded-md border p-3"
											>
												<p className="text-muted-foreground text-xs">{label}</p>
												<p className="font-medium text-xl tabular-nums">
													{numberValue(metric).toLocaleString()}
												</p>
											</div>
										))}
									</div>
									<dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
										<dt className="text-muted-foreground">Last event</dt>
										<dd>{textValue(activity.lastEventName) || "—"}</dd>
										<dt className="text-muted-foreground">Event time</dt>
										<dd>{dateValue(textValue(activity.lastEventAt))}</dd>
										{acquisition.map((item) => (
											<div key={item.label} className="contents">
												<dt className="text-muted-foreground">{item.label}</dt>
												<dd className="truncate" title={item.value}>
													{item.value}
												</dd>
											</div>
										))}
									</dl>
								</div>
							) : (
								<StatusIndicator
									tone="neutral"
									label="PostHog lookup queued when this profile was opened"
								/>
							)}
						</CardContent>
					</Card>
				</div>

				<div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
					<Card>
						<CardHeader>
							<CardTitle>Identity map</CardTitle>
							<CardDescription>
								Identifiers Atlas can use to find this exact user.
							</CardDescription>
						</CardHeader>
						<CardContent className="p-0">
							<dl className="divide-y">
								{user.identities.map((identity) => (
									<div
										key={identity.id}
										className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center"
									>
										<dt className="text-muted-foreground text-xs uppercase tracking-wide">
											{identity.kind.replaceAll("_", " ")}
										</dt>
										<dd className="truncate font-mono text-sm">
											{identity.value}
										</dd>
									</div>
								))}
							</dl>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Source state</CardTitle>
							<CardDescription>
								Latest deterministic Metabase observation.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<StatusIndicator
								tone="success"
								label={`Observed ${relativeTimeFromIso(user.syncedAt)}`}
							/>
							<dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
								<dt className="text-muted-foreground">User ID</dt>
								<dd className="truncate font-mono text-xs">
									{user.externalId}
								</dd>
								<dt className="text-muted-foreground">Email</dt>
								<dd className="truncate">{value(user.email)}</dd>
								<dt className="text-muted-foreground">Role</dt>
								<dd>{value(user.role)}</dd>
								<dt className="text-muted-foreground">Account</dt>
								<dd>{accountState}</dd>
								<dt className="text-muted-foreground">Snapshots</dt>
								<dd>{user.snapshots.length}</dd>
								<dt className="text-muted-foreground">Created</dt>
								<dd>{dateValue(user.createdAtSource)}</dd>
								<dt className="text-muted-foreground">Updated</dt>
								<dd>{dateValue(user.updatedAtSource)}</dd>
								<dt className="text-muted-foreground">Last seen</dt>
								<dd>{dateValue(user.lastSeenAt)}</dd>
								<dt className="text-muted-foreground">Locale</dt>
								<dd>{value(user.locale)}</dd>
								<dt className="text-muted-foreground">Phone</dt>
								<dd>{value(user.phoneNumber)}</dd>
								<dt className="text-muted-foreground">Email verified</dt>
								<dd>
									{user.emailVerified == null
										? "—"
										: user.emailVerified
											? "Yes"
											: "No"}
								</dd>
							</dl>
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>
							{user.workDomain
								? `Company domain · ${user.workDomain}`
								: "Email domain"}
						</CardTitle>
						<CardDescription>
							{user.workDomain
								? "Atlas groups work-email peers without merging their user identities."
								: user.emailDomain
									? `${user.emailDomain} is a public or machine email provider, so Atlas does not treat it as a company.`
									: "This user has no company-classifiable email domain."}
						</CardDescription>
						{user.workDomain ? (
							<CardAction>
								<Button asChild variant="outline" size="sm">
									<Link href={`/users/domains/${user.workDomain}`}>
										Explore domain
									</Link>
								</Button>
							</CardAction>
						) : null}
					</CardHeader>
					<CardContent>
						<p className="font-mono text-sm">
							{user.emailDomain ?? "No domain"}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Organizations</CardTitle>
						<CardDescription>
							Memberships are independent, so one user can belong to several
							product organizations.
						</CardDescription>
					</CardHeader>
					<CardContent className="p-0">
						{user.memberships.length > 0 ? (
							<div className="divide-y">
								{user.memberships.map((membership) => (
									<div
										key={membership.organization.id}
										className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center"
									>
										<div className="min-w-0">
											<p className="truncate font-medium">
												{membership.organization.name?.trim()
													? /^personal$/i.test(membership.organization.name)
														? "Personal workspace"
														: membership.organization.name
													: "Unnamed workspace"}
											</p>
											<p className="truncate font-mono text-muted-foreground text-xs">
												{membership.organization.externalId}
											</p>
										</div>
										<div>
											<p className="text-muted-foreground text-xs">Plan</p>
											<p className="text-sm">
												{value(membership.organization.plan)}
											</p>
										</div>
										<div>
											<p className="text-muted-foreground text-xs">Payment</p>
											<p className="text-sm">
												{value(membership.organization.paymentStatus)}
											</p>
										</div>
									</div>
								))}
							</div>
						) : (
							<p className="p-6 text-center text-muted-foreground text-sm">
								No organization membership was returned by the source.
							</p>
						)}
					</CardContent>
				</Card>
			</PageShellContent>
		</PageShell>
	);
}
