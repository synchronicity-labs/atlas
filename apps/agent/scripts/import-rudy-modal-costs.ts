const remoteCollector = `
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

mapping = {
    "sync-v2.5-v0": "sync-2-pro",
    "sync-v2.5-v0-pw": "sync-2-pro",
    "sync-v2.0.0-short-v1-25fps": "sync-2",
    "sync-v1.9.0-beta-long": "sync-1.9",
    "sync-v1.9.0-short": "sync-1.9",
    "react-distributed-inference": "react-1",
    "react-distributed-inference-prod": "react-1",
    "sync-v2.0.0-short-v1-mini": "sync-2-mini",
    "sync-v3.0.0-modal-prod": "sync-3",
    "sync-v3.0.0-modal-prod-tc": "sync-3",
}

def model(value):
    value = str(value or "")
    for prefix, target in mapping.items():
        if value == prefix or value.startswith(prefix):
            return target
    lower = value.lower()
    if "sync-v3.0" in lower or "sync-3" in lower:
        return "sync-3"
    return "other"

today = date.today()
month_start = today.replace(day=1)
previous_start = (month_start - timedelta(days=1)).replace(day=1)
entries = []
env = dict(os.environ)
env["MODAL_PROFILE"] = "synchronicity-labs"

for start, end in [(previous_start, month_start), (month_start, today)]:
    result = subprocess.run(
        ["modal", "billing", "report", "--start", start.isoformat(), "--end", end.isoformat(), "--json"],
        capture_output=True,
        text=True,
        timeout=120,
        env=env,
    )
    if result.returncode != 0:
        raise SystemExit("Modal billing collector failed")
    entries.extend(json.loads(result.stdout))

aggregated = defaultdict(float)
for entry in entries:
    period = str(entry.get("Interval Start") or "")[:7]
    if not period:
        continue
    target = model(entry.get("Object ID") or "")
    if target == "other":
        target = model(entry.get("Description") or "")
    aggregated[(period, target)] += float(entry.get("Cost") or 0)

payload = {
    "capturedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "collector": "rudy-modal-billing-v1",
    "rows": [
        {"month": period, "model": target, "costUsd": round(cost, 6)}
        for (period, target), cost in sorted(aggregated.items())
    ],
}
json.dump(payload, sys.stdout)
`;

const secret = process.env.CRON_SECRET?.trim();
if (!secret) throw new Error("CRON_SECRET is required.");

const child = Bun.spawn(
	[
		"ssh",
		"-o",
		"BatchMode=yes",
		"-o",
		"ConnectTimeout=8",
		process.env.RUDY_SSH_HOST?.trim() || "rudy",
		"sudo -n -H python3 -",
	],
	{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
);
child.stdin.write(remoteCollector);
await child.stdin.end();
const [payload, error, exitCode] = await Promise.all([
	new Response(child.stdout).text(),
	new Response(child.stderr).text(),
	child.exited,
]);
if (exitCode !== 0) {
	throw new Error(error.trim() || "Rudy Modal collector failed.");
}
const parsed = JSON.parse(payload) as { rows?: unknown[] };
if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
	throw new Error("Rudy returned no aggregate Modal cost rows.");
}
const baseUrl = process.env.API_URL?.trim() || "http://localhost:3001";
const response = await fetch(new URL("/internal/sync/modal", baseUrl), {
	method: "POST",
	headers: {
		Authorization: `Bearer ${secret}`,
		"Content-Type": "application/json",
	},
	body: payload,
});
const body = (await response.json()) as Record<string, unknown>;
if (!response.ok) {
	throw new Error(
		typeof body.message === "string"
			? body.message
			: `Atlas Modal import failed (${response.status}).`,
	);
}
console.log(JSON.stringify(body));
