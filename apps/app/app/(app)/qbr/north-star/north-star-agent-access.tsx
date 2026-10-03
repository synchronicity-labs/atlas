"use client";

import { Button } from "@crm/ui/components/button";
import Link from "next/link";
import { useState } from "react";

export const NORTH_STAR_AGENT_INSTRUCTIONS = `1. Read the saved Q3 report from the read-only endpoint below. The production Atlas API origin is https://atlas-api.pr.sync.so.
2. Check metrics[id].observations for these exact period keys: 2026-07, 2026-08, 2026-09, and 2026-Q3. Each value includes its status, asOf, and dataThrough. A missing key means not reported, not zero.
3. Treat preparation.supportingResults as separate supporting tables, not headline observations. Follow metrics[id].question.url for the canonical Atlas question; do not guess question numbers or URLs.
4. This endpoint reads saved report data. It does not refresh sources or run provider queries.
5. ATLAS_QUERY_SECRET is read-only across Atlas catalog, question, source-status, and QBR-report endpoints; it cannot refresh, edit, or write CRM data. Rudy's documented gateway receives it through scoped Doppler prd_core. For another agent runtime, an authorized runtime owner must provision this read credential through that runtime's approved secret manager. Do not send it in chat or prompts.
6. Human browser fallback: sign in to Atlas at https://atlas.pr.sync.so/qbr/north-star and read the report there. This is for a person using the browser, not an agent API credential. Never copy browser cookies into an agent.

: "\${ATLAS_QUERY_SECRET:?set it in approved runtime secrets}"
curl --fail --silent --show-error \\
  -H "Accept: application/json" \\
  -H "Authorization: Bearer $ATLAS_QUERY_SECRET" \\
  "https://atlas-api.pr.sync.so/internal/atlas/reports/qbr/2026-Q3"

Provide ATLAS_QUERY_SECRET only through this runtime's approved secret provisioning. Never paste it into a prompt, browser, command history, logs, or shared output.`;

export function NorthStarAgentAccess() {
	const [copyStatus, setCopyStatus] = useState("");

	const copyInstructions = async () => {
		try {
			await navigator.clipboard.writeText(NORTH_STAR_AGENT_INSTRUCTIONS);
			setCopyStatus("Agent instructions copied.");
		} catch {
			setCopyStatus(
				"Could not copy instructions. Check browser clipboard permissions.",
			);
		}
	};

	return (
		<section
			className="grid gap-3 rounded-lg border p-4"
			aria-labelledby="north-star-agent-access"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="north-star-agent-access" className="font-medium">
						For agents
					</h2>
					<p className="text-sm text-muted-foreground">
						The agent endpoint uses a read-only runtime credential. If it is not
						provisioned for your agent, open the signed-in dashboard:{" "}
						<Link
							href="https://atlas.pr.sync.so/qbr/north-star"
							target="_blank"
							rel="noreferrer"
							className="underline underline-offset-4"
						>
							Atlas Q3 North Star ↗
						</Link>
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					onClick={() => void copyInstructions()}
				>
					Copy instructions
				</Button>
			</div>
			<details>
				<summary className="cursor-pointer text-sm font-medium">
					Access and data notes
				</summary>
				<pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">
					{NORTH_STAR_AGENT_INSTRUCTIONS}
				</pre>
			</details>
			<p className="text-sm" role="status" aria-live="polite">
				{copyStatus}
			</p>
		</section>
	);
}
