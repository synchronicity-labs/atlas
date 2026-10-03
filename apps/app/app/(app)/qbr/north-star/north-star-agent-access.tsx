"use client";

import { Button } from "@crm/ui/components/button";
import Link from "next/link";
import { useState } from "react";

const MCP_CONFIGURATION = JSON.stringify(
	{
		mcpServers: {
			rudy: {
				url: "https://ip-10-0-3-200-1.tail8782ce.ts.net/mcp",
			},
		},
	},
	null,
	2,
);

export const NORTH_STAR_AGENT_INSTRUCTIONS = `Connect to the Rudy MCP server at https://ip-10-0-3-200-1.tail8782ce.ts.net/mcp. The agent runtime must be able to reach the company Tailscale network. This is an existing MCP server with other tools; these instructions describe the QBR tools only, not the permissions of the whole server. No agent-side credential is needed; credentials stay on the server.

Call atlas_qbr_report with quarter "2026-Q3". By default it returns a compact summary with metric definitions, values, statuses, and source question links. Inspect period keys "2026-07", "2026-08", "2026-09", and "2026-Q3". A missing period means not reported, not zero.

Request full evidence only for metrics you need, with at most 10 metric IDs per call. For example: atlas_qbr_report({quarter:'2026-Q3',metric_ids:['enterprise_usage_retention']}). The selected metrics include detailed sources and preparation.supportingResults. Preserve observation status, asOf, dataThrough, source URLs, and supporting-result provenance. Avoid requesting all full evidence by default; the upstream report is large.

Use the source question links as canonical Atlas question URLs. Call atlas_question with the question number and, when useful, reporting_period and as_of to inspect its evidence. reporting_period accepts YYYY-Q1 through YYYY-Q4, YYYY-MM, or YYYY-MM-DD. A quarter selects the saved snapshot for that period; it does not trim rows. as_of limits the read to snapshots captured by that timestamp. Treat supportingResults as separate supporting results, not headline observations. Use atlas_search_questions for targeted discovery and atlas_source_health to understand source freshness or availability; neither replaces the report's period-specific evidence.

MCP client configuration formats may differ. The copied JSON is a generic Claude-compatible example; use the equivalent server URL configuration for your client.

Human browser fallback: https://atlas.pr.sync.so/qbr/north-star`;

export function NorthStarAgentAccess() {
	const [copyStatus, setCopyStatus] = useState("");

	const copyText = async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopyStatus(`${label} copied.`);
		} catch {
			setCopyStatus("Could not copy. Check browser clipboard permissions.");
		}
	};

	return (
		<section
			className="grid gap-3 rounded-lg border p-4"
			aria-labelledby="north-star-agent-access"
		>
			<div className="grid min-w-0 gap-3">
				<div>
					<h2 id="north-star-agent-access" className="font-medium">
						For agents
					</h2>
					<p className="text-sm text-muted-foreground">
						Connect the Rudy MCP tools to read QBR evidence. Your agent runtime
						must reach the company Tailscale network; credentials stay on the
						server.
					</p>
				</div>
				<div className="grid min-w-0 gap-2">
					<h3 id="qbr-agent-prompt" className="text-sm font-medium">
						Agent prompt
					</h3>
					<div className="whitespace-pre-wrap break-words rounded-md border p-3 font-sans text-sm leading-relaxed">
						{NORTH_STAR_AGENT_INSTRUCTIONS}
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() =>
							void copyText(MCP_CONFIGURATION, "MCP configuration")
						}
					>
						Copy MCP configuration
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() =>
							void copyText(NORTH_STAR_AGENT_INSTRUCTIONS, "QBR instructions")
						}
					>
						Copy QBR instructions
					</Button>
				</div>
			</div>
			<p className="text-sm" role="status" aria-live="polite">
				{copyStatus}
			</p>
			<details>
				<summary className="cursor-pointer text-sm font-medium">
					Client format and browser fallback
				</summary>
				<p className="mt-2 text-sm text-muted-foreground">
					The copied server entry is generic Claude-compatible JSON. MCP client
					configuration formats may differ. For a person using a browser, open{" "}
					<Link
						href="https://atlas.pr.sync.so/qbr/north-star"
						target="_blank"
						rel="noreferrer"
						className="underline underline-offset-4"
					>
						Atlas Q3 North Star ↗
					</Link>
					.
				</p>
			</details>
		</section>
	);
}
