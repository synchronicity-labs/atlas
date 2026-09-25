import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import { betterAuth } from "better-auth";
import { type MemoryDB, memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { google } from "better-auth/social-providers";
import { googleClientIds } from "../src/google-client-ids";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
});
const kid = "minirudy-audience-test";
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256" };
const originalFetch = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
	(input, init) => {
		const url = String(input);
		if (url.includes("googleapis.com") && url.includes("certs")) {
			return Promise.resolve(Response.json({ keys: [jwk] }));
		}
		return originalFetch(input, init);
	},
);

afterAll(() => fetchSpy.mockRestore());

function token(audience: string, nonce = "nonce") {
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iss: "https://accounts.google.com",
		aud: audience,
		sub: "own-google-subject",
		email: "person@sync.so",
		name: "Test Person",
		email_verified: true,
		hd: "sync.so",
		iat: now,
		exp: now + 600,
		nonce,
	};
	const encoded = [
		Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url"),
		Buffer.from(JSON.stringify(payload)).toString("base64url"),
	].join(".");
	const signature = createSign("RSA-SHA256").update(encoded).sign(privateKey);
	return `${encoded}.${signature.toString("base64url")}`;
}

describe("Mini Rudy's optional Google audience", () => {
	it("keeps the existing client as the only audience unless configured", () => {
		expect(googleClientIds("atlas")).toBe("atlas");
		expect(googleClientIds("atlas", " ")).toBe("atlas");
		expect(googleClientIds("atlas", "atlas")).toBe("atlas");
	});

	it("uses Atlas's original client for redirect-based Google sign-in", async () => {
		const provider = google({
			clientId: googleClientIds("atlas", "minirudy"),
			clientSecret: "atlas-secret",
		});
		const url = await provider.createAuthorizationURL({
			state: "state",
			codeVerifier: "verifier",
			redirectURI: "https://atlas.example/api/auth/callback/google",
		});
		expect(url.searchParams.get("client_id")).toBe("atlas");
	});

	it("uses native signature, audience, and nonce verification for both allowed clients", async () => {
		const provider = google({
			clientId: googleClientIds("atlas", "minirudy"),
			clientSecret: "atlas-secret",
		});
		expect(await provider.verifyIdToken?.(token("atlas"), "nonce")).toBe(true);
		expect(await provider.verifyIdToken?.(token("minirudy"), "nonce")).toBe(
			true,
		);
		expect(await provider.verifyIdToken?.(token("other"), "nonce")).toBe(false);
		expect(await provider.verifyIdToken?.(token("minirudy"), "wrong")).toBe(
			false,
		);
		const nativeOnly = google({ clientId: "atlas", clientSecret: "secret" });
		expect(await nativeOnly.verifyIdToken?.(token("minirudy"), "nonce")).toBe(
			false,
		);
	});

	it("creates a first-time account and runs membership provisioning before issuing its session", async () => {
		const database: MemoryDB = {
			user: [],
			account: [],
			session: [],
			verification: [],
			member: [],
			organization: [
				{
					id: "sync-workspace",
					name: "Sync",
					slug: "sync",
					createdAt: new Date(),
				},
			],
		};
		const provisionedUsers: string[] = [];
		const auth = betterAuth({
			baseURL: "http://localhost:3000",
			secret: "isolated-auth-test-secret-with-at-least-32-characters",
			database: memoryAdapter(database),
			socialProviders: {
				google: {
					clientId: googleClientIds("atlas", "minirudy"),
					clientSecret: "atlas-secret",
				},
			},
			plugins: [organization({ allowUserToCreateOrganization: false })],
			databaseHooks: {
				session: {
					create: {
						before: async (session, context) => {
							if (!context) throw new Error("Expected sign-in request context");
							provisionedUsers.push(session.userId);
							const member = await context.context.adapter.findOne({
								model: "member",
								where: [{ field: "userId", value: session.userId }],
							});
							if (!member)
								await context.context.adapter.create({
									model: "member",
									data: {
										organizationId: "sync-workspace",
										userId: session.userId,
										role: "member",
										createdAt: new Date(),
									},
								});
							return {
								data: { ...session, activeOrganizationId: "sync-workspace" },
							};
						},
					},
				},
			},
		});
		const signIn = () =>
			auth.handler(
				new Request("http://localhost:3000/api/auth/sign-in/social", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						provider: "google",
						idToken: { token: token("minirudy"), nonce: "nonce" },
					}),
				}),
			);
		const first = await signIn();
		expect(first.status).toBe(200);
		const created = await first.json();
		expect(created.user.email).toBe("person@sync.so");
		expect(database.user).toHaveLength(1);
		expect(database.account).toHaveLength(1);
		expect(database.account[0]).toMatchObject({
			accountId: "own-google-subject",
			providerId: "google",
			userId: created.user.id,
		});
		expect(database.member).toHaveLength(1);
		expect(database.member[0]).toMatchObject({
			organizationId: "sync-workspace",
			userId: created.user.id,
		});
		expect(database.session[0]).toMatchObject({
			userId: created.user.id,
			activeOrganizationId: "sync-workspace",
		});
		expect(first.headers.get("set-cookie")).toContain("session_token=");
		const existing = await signIn();
		expect(existing.status).toBe(200);
		expect((await existing.json()).user.id).toBe(created.user.id);
		expect(database.user).toHaveLength(1);
		expect(database.account).toHaveLength(1);
		expect(database.member).toHaveLength(1);
		expect(provisionedUsers).toEqual([created.user.id, created.user.id]);
	});
});
