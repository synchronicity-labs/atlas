import { execFileSync } from "node:child_process";
import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type CsvRow, csvText } from "../agent/lib/persona-evidence";

const USAGE =
	"Usage: bun scripts/export-toolkit-shots.ts --repo owner/repo --ref <branch|tag|commit> --config <path.json> [--config <path.json> ...] --out <private-directory>";

type Shot = {
	id?: unknown;
	status?: unknown;
	billable?: unknown;
	round?: unknown;
	version?: unknown;
	name?: unknown;
	date_received?: unknown;
	date_delivered?: unknown;
	frame_count?: unknown;
	working?: { delivery_base?: unknown };
};

type Config = {
	project?: {
		client_code?: unknown;
		project_code?: unknown;
		project_name?: unknown;
	};
	shots?: Shot[];
};

type Provenance = {
	repo: string;
	ref: string;
	commit: string;
	commitTimestampUtc: string;
};

export function buildExport(
	configs: Array<{ path: string; blob: string; config: Config }>,
	provenance: Provenance,
	extractedAtUtc: string,
) {
	const shots = configs.flatMap(({ path, blob, config }) => {
		if (!config.project || !Array.isArray(config.shots)) {
			throw new Error(`Invalid Toolkit config: ${path}`);
		}
		const project = config.project;
		const sourceConfigUrl = `https://github.com/${provenance.repo}/blob/${provenance.commit}/${path}`;
		return config.shots.map((shot) => ({
			project: project.project_code ?? null,
			client: project.client_code ?? null,
			project_name: project.project_name ?? null,
			shot_id: shot.id ?? null,
			status: shot.status ?? null,
			billable: shot.billable ?? null,
			round: shot.round ?? null,
			source_version: shot.version ?? null,
			source_name: shot.name ?? null,
			delivery_base: shot.working?.delivery_base ?? null,
			date_received: shot.date_received ?? null,
			date_delivered: shot.date_delivered ?? null,
			frame_count: shot.frame_count ?? null,
			sow_id: null,
			acceptance_status: null,
			accepted_at: null,
			rejected_at: null,
			scope_change_at: null,
			usable_assets_at: null,
			kickoff_at: null,
			original_deadline: null,
			revised_deadline: null,
			client_wait_started_at: null,
			client_wait_ended_at: null,
			core_first_use_at: null,
			paid_status: null,
			source_config: path,
			source_config_url: sourceConfigUrl,
			source_blob_sha: blob,
			source_commit: provenance.commit,
			source_commit_timestamp_utc: provenance.commitTimestampUtc,
			extracted_at_utc: extractedAtUtc,
		}));
	});
	const headers = Object.keys(shots.at(0) ?? {});
	const csvRows = shots.map(
		(row) =>
			Object.fromEntries(
				Object.entries(row).map(([key, value]) => [
					key,
					value === null ? "" : String(value),
				]),
			) as CsvRow,
	);
	return {
		json: {
			schema_version: 1,
			repository: provenance.repo,
			source_ref: provenance.ref,
			source_commit: provenance.commit,
			source_commit_timestamp_utc: provenance.commitTimestampUtc,
			extracted_at_utc: extractedAtUtc,
			csv_null_encoding: "empty cells represent null; JSON preserves null",
			interpretation:
				"Toolkit status and billable are source fields, not proof of client acceptance or payment.",
			missing_event_fields: [
				"sow_id",
				"acceptance_status",
				"accepted_at",
				"rejected_at",
				"scope_change_at",
				"usable_assets_at",
				"kickoff_at",
				"original_deadline",
				"revised_deadline",
				"client_wait_started_at",
				"client_wait_ended_at",
				"core_first_use_at",
				"paid_status",
			],
			shots,
		},
		csv: csvText(csvRows, headers),
	};
}

export function validateInput(repo: string, ref: string, paths: string[]) {
	if (
		!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(repo) ||
		repo.split("/").some((part) => part === "." || part === "..")
	) {
		throw new Error("--repo must be owner/repository");
	}
	if (
		!/^\w[\w./-]{0,254}$/.test(ref) ||
		ref.includes("..") ||
		ref.includes("//") ||
		ref.endsWith("/") ||
		ref.endsWith(".") ||
		ref
			.split("/")
			.some((part) => part.startsWith(".") || part.endsWith(".lock"))
	) {
		throw new Error("--ref must be a valid branch, tag, or commit reference");
	}
	if (
		paths.length === 0 ||
		paths.some(
			(path) =>
				!/^[-A-Za-z0-9_.]+(?:\/[-A-Za-z0-9_.]+)*\.json$/.test(path) ||
				path.split("/").some((part) => part === "." || part === ".."),
		) ||
		new Set(paths).size !== paths.length
	) {
		throw new Error("Supply unique relative JSON paths with --config");
	}
}

function ghJson<T>(args: string[]): T {
	return JSON.parse(
		execFileSync("gh", ["api", ...args], {
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		}),
	) as T;
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			help: { type: "boolean" },
			repo: { type: "string" },
			ref: { type: "string" },
			config: { type: "string", multiple: true },
			out: { type: "string" },
		},
	});
	if (values.help) {
		console.log(USAGE);
	} else {
		if (!values.repo || !values.ref || !values.out) throw new Error(USAGE);
		const paths = values.config ?? [];
		validateInput(values.repo, values.ref, paths);
		const out = resolve(values.out);
		const [resolved] = ghJson<
			Array<{ sha: string; commit: { committer: { date: string } } }>
		>([
			"--method",
			"GET",
			`repos/${values.repo}/commits`,
			"-f",
			`sha=${values.ref}`,
			"-F",
			"per_page=1",
		]);
		if (!resolved || !/^[a-f0-9]{40}$/.test(resolved.sha)) {
			throw new Error("GitHub did not resolve --ref to a commit");
		}
		const provenance: Provenance = {
			repo: values.repo,
			ref: values.ref,
			commit: resolved.sha,
			commitTimestampUtc: resolved.commit.committer.date,
		};
		const configs = paths.map((path) => {
			const file = ghJson<{ sha: string; content: string }>([
				"--method",
				"GET",
				`repos/${values.repo}/contents/${path}`,
				"-f",
				`ref=${resolved.sha}`,
			]);
			if (!/^[a-f0-9]{40}$/.test(file.sha)) {
				throw new Error(`GitHub returned an invalid blob for ${path}`);
			}
			return {
				path,
				blob: file.sha,
				config: JSON.parse(
					Buffer.from(file.content, "base64").toString("utf8"),
				) as Config,
			};
		});
		const result = buildExport(configs, provenance, new Date().toISOString());
		await mkdir(out, { recursive: true, mode: 0o700 });
		if ((await readdir(out)).length)
			throw new Error("Output directory is not empty; use a new directory");
		await chmod(out, 0o700);
		const files = [
			["toolkit-shots.json", `${JSON.stringify(result.json, null, 2)}\n`],
			["toolkit-shots.csv", result.csv],
		] as const;
		for (const [file, contents] of files) {
			const path = resolve(out, file);
			await writeFile(path, contents, { flag: "wx", mode: 0o600 });
			await chmod(path, 0o600);
		}
		console.log(
			JSON.stringify({
				outputDirectory: out,
				shotCount: result.json.shots.length,
			}),
		);
	}
}
