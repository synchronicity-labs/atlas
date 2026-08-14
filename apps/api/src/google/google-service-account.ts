import { createSign } from "node:crypto";

export type GoogleServiceAccount = {
	client_email: string;
	private_key: string;
	token_uri?: string;
};

function base64Url(value: string | Buffer): string {
	return Buffer.from(value)
		.toString("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export function googleServiceAccount(): GoogleServiceAccount | null {
	const value = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
	if (!value) return null;
	const parsed = JSON.parse(value) as Partial<GoogleServiceAccount>;
	if (!parsed.client_email || !parsed.private_key) {
		throw new Error("The Google service account configuration is invalid.");
	}
	return {
		client_email: parsed.client_email,
		private_key: parsed.private_key,
		token_uri: parsed.token_uri,
	};
}

export class GoogleServiceAccountClient {
	private readonly tokens = new Map<
		string,
		{ value: string; expiresAt: number }
	>();

	constructor(private readonly credential: GoogleServiceAccount | null) {}

	async accessToken(scopes: string[]): Promise<string> {
		const scope = [...scopes].sort().join(" ");
		const cached = this.tokens.get(scope);
		if (cached && cached.expiresAt > Date.now() + 60_000) {
			return cached.value;
		}
		if (!this.credential) {
			throw new Error("Google reporting is not configured.");
		}
		const now = Math.floor(Date.now() / 1000);
		const assertion = this.jwt(scopes, now);
		const response = await fetch(
			this.credential.token_uri ?? "https://oauth2.googleapis.com/token",
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
					assertion,
				}),
			},
		);
		const body = (await response.json()) as {
			access_token?: string;
			expires_in?: number;
		};
		if (!response.ok || !body.access_token) {
			throw new Error(`Google authorization failed (${response.status}).`);
		}
		const token = {
			value: body.access_token,
			expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
		};
		this.tokens.set(scope, token);
		return token.value;
	}

	private jwt(scopes: string[], now: number): string {
		if (!this.credential) {
			throw new Error("Google reporting is not configured.");
		}
		const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
		const payload = base64Url(
			JSON.stringify({
				iss: this.credential.client_email,
				scope: scopes.join(" "),
				aud: this.credential.token_uri ?? "https://oauth2.googleapis.com/token",
				iat: now,
				exp: now + 3600,
			}),
		);
		const unsigned = `${header}.${payload}`;
		const signature = createSign("RSA-SHA256")
			.update(unsigned)
			.end()
			.sign(this.credential.private_key);
		return `${unsigned}.${base64Url(signature)}`;
	}
}
