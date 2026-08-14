import { afterEach, describe, expect, it } from "bun:test";
import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { NextRequest } from "next/server";
import { readOnboardingGate } from "../lib/onboarding";
import { proxy } from "../proxy";

const SESSION_COOKIE = `${AUTH_COOKIE_PREFIX}.session_token=abc.def`;

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

function stub(handler: (url: string) => Promise<Response>) {
	globalThis.fetch = ((input: string | URL | Request) =>
		handler(String(input))) as unknown as typeof fetch;
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function answerWith(body: unknown, status = 200) {
	stub(async () => json(body, status));
}

const workspace = (data: { onboarded: boolean; canRename: boolean }) => ({
	result: { data },
});

function setup({
	onboarded = true,
	canRename = true,
}: {
	onboarded?: boolean;
	canRename?: boolean;
} = {}) {
	const calls = { workspace: 0 };

	stub(async () => {
		calls.workspace += 1;
		return json(workspace({ onboarded, canRename }));
	});

	return calls;
}

function request(pathname: string, cookies: string[] = []) {
	return new NextRequest(new URL(pathname, "http://localhost:3000"), {
		headers: cookies.length ? { cookie: cookies.join("; ") } : {},
	});
}

function redirectedTo(response: Response): string | null {
	const location = response.headers.get("location");

	return location ? new URL(location).pathname : null;
}

describe("readOnboardingGate", () => {
	it("reads the answer out of a plain tRPC envelope", async () => {
		answerWith(workspace({ onboarded: false, canRename: true }));

		expect(await readOnboardingGate(request("/", [SESSION_COOKIE]))).toBe(
			"required",
		);
	});

	it("settles for someone who could not answer the form anyway", async () => {
		answerWith(workspace({ onboarded: false, canRename: false }));

		expect(await readOnboardingGate(request("/", [SESSION_COOKIE]))).toBe(
			"settled",
		);
	});

	it("is unknown rather than required when the API cannot be read", async () => {
		answerWith({ error: { message: "UNAUTHORIZED" } }, 401);
		expect(await readOnboardingGate(request("/", [SESSION_COOKIE]))).toBe(
			"unknown",
		);

		stub(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		expect(await readOnboardingGate(request("/", [SESSION_COOKIE]))).toBe(
			"unknown",
		);

		answerWith({ result: { data: { nothing: "useful" } } });
		expect(await readOnboardingGate(request("/", [SESSION_COOKIE]))).toBe(
			"unknown",
		);
	});
});

describe("proxy", () => {
	it("sends a stranger to sign in, and leaves them there", async () => {
		expect(redirectedTo(await proxy(request("/companies")))).toBe("/sign-in");
		expect(redirectedTo(await proxy(request("/sign-in")))).toBeNull();
	});

	it("ignores a neighbour's cookie from the parent domain", async () => {
		expect(AUTH_COOKIE_PREFIX).not.toBe("better-auth");
		setup();

		expect(
			redirectedTo(
				await proxy(
					request("/companies", ["better-auth.session_token=someone.else"]),
				),
			),
		).toBe("/sign-in");
	});

	it("gates a signed-in rep who has not answered the form", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(await proxy(request("/contacts", [SESSION_COOKIE]))),
		).toBe("/onboarding");
	});

	it("lets the form itself render", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(await proxy(request("/onboarding", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("asks again on every request, and remembers nothing", async () => {
		const calls = setup();

		const first = await proxy(request("/contacts", [SESSION_COOKIE]));

		expect([...first.cookies.getAll()]).toHaveLength(0);
		expect(calls).toEqual({ workspace: 1 });

		await proxy(request("/contacts", [SESSION_COOKIE]));

		expect(calls).toEqual({ workspace: 2 });
	});

	it("notices when the answer changes underneath it", async () => {
		setup();
		expect(
			redirectedTo(await proxy(request("/contacts", [SESSION_COOKIE]))),
		).toBeNull();

		// A reset database, a removed key: the browser is carrying nothing that
		// could keep saying the gate was satisfied.
		setup({ onboarded: false });
		expect(
			redirectedTo(await proxy(request("/contacts", [SESSION_COOKIE]))),
		).toBe("/onboarding");
	});

	it("takes a settled rep off the required setup page", async () => {
		setup();

		expect(
			redirectedTo(await proxy(request("/onboarding", [SESSION_COOKIE]))),
		).toBe("/");
	});

	it("never fights /grant-access, which would ping-pong forever", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(await proxy(request("/grant-access", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("opens Atlas surfaces without requiring CRM setup", async () => {
		setup({ onboarded: false });

		for (const path of [
			"/",
			"/dashboards/1",
			"/metrics",
			"/questions",
			"/users",
			"/companies",
		]) {
			expect(
				redirectedTo(await proxy(request(path, [SESSION_COOKIE]))),
			).toBeNull();
		}
	});

	it("leaves the agent bridge alone", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(await proxy(request("/eve/v1/info", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("fails open when the API is unreachable", async () => {
		stub(async () => {
			throw new Error("connect ECONNREFUSED");
		});

		const response = await proxy(request("/contacts", [SESSION_COOKIE]));

		expect(redirectedTo(response)).toBeNull();
	});
});
