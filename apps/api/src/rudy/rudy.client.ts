import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";

type HermesMessage = {
	id?: string;
	role?: string;
	content?: unknown;
	timestamp?: number;
};

type HermesSession = {
	id: string;
	title?: string | null;
	message_count?: number;
};

const REQUEST_TIMEOUT_MS = 15 * 60_000;

@Injectable()
export class RudyClient {
	private readonly baseUrl: string | null;
	private readonly apiKey: string | null;

	constructor(config: ConfigService<EnvironmentVariables, true>) {
		this.baseUrl =
			config.get("RUDY_API_URL", { infer: true })?.replace(/\/$/, "") ?? null;
		this.apiKey = config.get("RUDY_API_KEY", { infer: true }) ?? null;
	}

	configured(): boolean {
		return Boolean(this.baseUrl && this.apiKey);
	}

	async create(input: {
		id: string;
		title: string;
		systemPrompt: string;
	}): Promise<HermesSession> {
		const response = await this.request<{ session: HermesSession }>(
			"/api/sessions",
			{
				method: "POST",
				body: JSON.stringify({
					id: input.id,
					title: input.title,
					source: "api_server",
					system_prompt: input.systemPrompt,
				}),
			},
		);
		return response.session;
	}

	async messages(sessionId: string): Promise<HermesMessage[]> {
		const response = await this.request<{ data: HermesMessage[] }>(
			`/api/sessions/${encodeURIComponent(sessionId)}/messages`,
		);
		return response.data ?? [];
	}

	async chat(input: {
		sessionId: string;
		message: string;
		instructions: string;
	}): Promise<string> {
		const response = await this.request<{
			message?: { content?: unknown };
		}>(`/api/sessions/${encodeURIComponent(input.sessionId)}/chat`, {
			method: "POST",
			body: JSON.stringify({
				message: input.message,
				instructions: input.instructions,
			}),
		});
		return textContent(response.message?.content);
	}

	async remove(sessionId: string): Promise<void> {
		await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
			method: "DELETE",
		});
	}

	private async request<T = unknown>(
		path: string,
		init: RequestInit = {},
	): Promise<T> {
		if (!this.baseUrl || !this.apiKey) {
			throw new ServiceUnavailableException(
				"The Rudy session bridge is not configured.",
			);
		}
		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}${path}`, {
				...init,
				headers: {
					accept: "application/json",
					authorization: `Bearer ${this.apiKey}`,
					"content-type": "application/json",
					...init.headers,
				},
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			throw new ServiceUnavailableException(
				"Rudy is not reachable over the Tailnet right now.",
			);
		}
		if (!response.ok) {
			const body = await response.text();
			throw new ServiceUnavailableException(
				`Rudy returned ${response.status}: ${safeError(body)}`,
			);
		}
		return (await response.json()) as T;
	}
}

export function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => {
			if (typeof part === "string") return [part];
			if (
				part &&
				typeof part === "object" &&
				"text" in part &&
				typeof part.text === "string"
			) {
				return [part.text];
			}
			return [];
		})
		.join("\n");
}

function safeError(value: string): string {
	try {
		const parsed = JSON.parse(value) as {
			error?: { message?: string } | string;
		};
		if (typeof parsed.error === "string") return parsed.error.slice(0, 300);
		if (parsed.error?.message) return parsed.error.message.slice(0, 300);
	} catch {}
	return "The gateway request failed.";
}
