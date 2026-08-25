import {
	type GoogleServiceAccount,
	googleServiceAccount,
} from "@crm/db/google-service-account";

export type MarketingConfig = {
	google: GoogleServiceAccount | null;
	ga4: Record<string, { id: string; label: string }>;
	searchConsole: Record<string, string>;
	posthog: { host: string; apiKey: string; projectId: string } | null;
};

function env(name: string): string {
	return process.env[name]?.trim() ?? "";
}

export function marketingConfig(): MarketingConfig {
	const posthogHost = env("POSTHOG_HOST").replace(/\/$/, "");
	const posthogApiKey = env("POSTHOG_API_KEY");
	const posthogProjectId = env("POSTHOG_PROJECT_ID");
	return {
		google: googleServiceAccount(),
		ga4: {
			landing: { id: env("GA4_LANDING_PROPERTY_ID"), label: "sync.so" },
			blog: { id: env("GA4_BLOG_PROPERTY_ID"), label: "Blog" },
			playground: {
				id: env("GA4_PLAYGROUND_PROPERTY_ID"),
				label: "Playground",
			},
			docs: { id: env("GA4_DOCS_PROPERTY_ID"), label: "Docs" },
			lipsync: { id: env("GA4_LIPSYNC_PROPERTY_ID"), label: "lipsync.com" },
			support: { id: env("GA4_SUPPORT_PROPERTY_ID"), label: "Support" },
		},
		searchConsole: {
			sync: env("GOOGLE_SEARCH_CONSOLE_SYNC_SITE"),
			lipsync: env("GOOGLE_SEARCH_CONSOLE_LIPSYNC_SITE"),
		},
		posthog:
			posthogHost && posthogApiKey && posthogProjectId
				? {
						host: posthogHost,
						apiKey: posthogApiKey,
						projectId: posthogProjectId,
					}
				: null,
	};
}
