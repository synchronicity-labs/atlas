"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Textarea } from "@crm/ui/components/textarea";
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

const QBR_AGENT_CONTEXT = `Use Atlas to answer my Q3 2026 quarterly business review (QBR) request below.

First discover the Atlas tools on my connected Rudy MCP server. Search the available tools for "atlas" or "qbr", or list the server's tools. Look for atlas_qbr_report, atlas_search_questions, atlas_question, and atlas_source_health. Use the existing connection; no Atlas API key is needed.

Start with atlas_qbr_report(quarter="2026-Q3") to discover metric IDs, definitions, values, statuses, and source links. Fetch details only for the metrics my request needs, using metric_ids with up to 10 IDs per call. Use atlas_search_questions and atlas_question for additional saved evidence. Use atlas_source_health if freshness or availability is unclear.

Keep July (2026-07), August (2026-08), September (2026-09), and Q3 (2026-Q3) observations separate. Preserve units, definitions, observation status, asOf, dataThrough, and canonical Atlas source links. Missing is not zero. Flag stale, pending, or unavailable data. Supporting results are separate evidence, not headline values. A reporting_period filter selects a saved snapshot; it does not trim or recompute its rows.

Return the data and format I ask for. Ask a focused question if the metrics, breakdown, or period are unclear. Explain any unavailable data or tools rather than inventing an answer.

Atlas dashboard: https://atlas.pr.sync.so/qbr/north-star`;

const DEFAULT_REQUEST =
	"Show July, August, September, and Q3 revenue, gross margin, and enterprise NDR in a table, with source links and any data gaps.";

export function NorthStarAgentAccess() {
	const [request, setRequest] = useState(DEFAULT_REQUEST);
	const [copyStatus, setCopyStatus] = useState("");
	const prompt = `${QBR_AGENT_CONTEXT}\n\nMy request: ${request.trim() || "Ask me which QBR data I need."}`;

	const copyText = async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopyStatus(`${label} copied.`);
		} catch {
			setCopyStatus("Could not copy. Select the text and copy it manually.");
		}
	};

	return (
		<section aria-labelledby="north-star-agent-access">
			<Card>
				<CardHeader>
					<CardTitle>
						<h2 id="north-star-agent-access">Ask your agent for QBR data</h2>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<p>
						Describe the data you need, copy the prompt, and paste it into your
						agent. It will find the Atlas tools through your connected Rudy MCP
						server. You can then ask follow-up questions in your own words.
					</p>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="qbr-data-request">
								What data do you need?
							</FieldLabel>
							<Textarea
								id="qbr-data-request"
								value={request}
								onChange={(event) => {
									setRequest(event.target.value);
									setCopyStatus("");
								}}
								aria-describedby="qbr-data-request-help"
								rows={3}
							/>
							<FieldDescription id="qbr-data-request-help">
								Name the metrics, dates, breakdown, and format you want. For
								example: “Give me enterprise NDR for Q3 with its definition and
								supporting evidence.”
							</FieldDescription>
						</Field>
						<Field>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<FieldLabel htmlFor="qbr-agent-prompt">
									Prompt to paste into your agent
								</FieldLabel>
								<Button
									type="button"
									onClick={() => void copyText(prompt, "Prompt")}
								>
									Copy prompt
								</Button>
							</div>
							<Textarea
								id="qbr-agent-prompt"
								value={prompt}
								readOnly
								rows={12}
							/>
						</Field>
					</FieldGroup>
					<p role="status" aria-live="polite">
						{copyStatus}
					</p>
					<details>
						<summary className="cursor-pointer">
							Rudy MCP connection details
						</summary>
						<div className="grid min-w-0 gap-3 pt-3">
							<p>
								Already connected to Rudy? Use the prompt above. If you need to
								connect another client, your agent runtime must reach the
								company Tailscale network. Atlas credentials stay on the server.
								These four Atlas tools are read-only; other Rudy tools have
								their own permissions.
							</p>
							<Field>
								<FieldLabel htmlFor="qbr-mcp-configuration">
									MCP configuration
								</FieldLabel>
								<Textarea
									id="qbr-mcp-configuration"
									value={MCP_CONFIGURATION}
									readOnly
									rows={7}
								/>
								<FieldDescription>
									This is generic Claude-compatible JSON. Use the equivalent
									server URL configuration for your MCP client.
								</FieldDescription>
							</Field>
							<div>
								<Button
									type="button"
									variant="outline"
									onClick={() =>
										void copyText(MCP_CONFIGURATION, "MCP configuration")
									}
								>
									Copy MCP configuration
								</Button>
							</div>
							<FieldDescription>
								Browser fallback:{" "}
								<Link
									href="https://atlas.pr.sync.so/qbr/north-star"
									target="_blank"
									rel="noreferrer"
								>
									Atlas Q3 North Star ↗
								</Link>
							</FieldDescription>
						</div>
					</details>
				</CardContent>
			</Card>
		</section>
	);
}
