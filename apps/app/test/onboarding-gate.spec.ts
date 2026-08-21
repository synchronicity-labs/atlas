import { describe, expect, it } from "bun:test";
import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const SESSION_COOKIE = `${AUTH_COOKIE_PREFIX}.session_token=abc.def`;

function request(pathname: string, cookies: string[] = []) {
	return new NextRequest(new URL(pathname, "http://localhost:3000"), {
		headers: cookies.length ? { cookie: cookies.join("; ") } : {},
	});
}

function redirectUrl(response: Response): URL | null {
	const location = response.headers.get("location");

	return location ? new URL(location) : null;
}

function redirectedTo(response: Response): string | null {
	return redirectUrl(response)?.pathname ?? null;
}

describe("proxy", () => {
	it("sends a stranger to sign in, and leaves them there", async () => {
		const redirect = redirectUrl(await proxy(request("/companies?q=fal")));

		expect(redirect?.pathname).toBe("/sign-in");
		expect(redirect?.searchParams.get("next")).toBe("/companies?q=fal");
		expect(redirectedTo(await proxy(request("/sign-in")))).toBeNull();
	});

	it("ignores a neighbour's cookie from the parent domain", async () => {
		expect(AUTH_COOKIE_PREFIX).not.toBe("better-auth");

		expect(
			redirectedTo(
				await proxy(
					request("/companies", ["better-auth.session_token=someone.else"]),
				),
			),
		).toBe("/sign-in");
	});

	it("opens every Atlas surface without CRM onboarding", async () => {
		for (const path of [
			"/",
			"/companies",
			"/contacts",
			"/dashboards/1",
			"/deals",
			"/metrics",
			"/questions",
			"/settings",
			"/users",
		]) {
			expect(
				redirectedTo(await proxy(request(path, [SESSION_COOKIE]))),
			).toBeNull();
		}
	});

	it("sends legacy onboarding URLs to the Atlas dashboard", async () => {
		for (const path of ["/onboarding", "/onboarding/research"]) {
			expect(redirectedTo(await proxy(request(path, [SESSION_COOKIE])))).toBe(
				"/dashboards",
			);
		}
	});

	it("leaves the agent bridge alone", async () => {
		expect(
			redirectedTo(await proxy(request("/eve/v1/info", [SESSION_COOKIE]))),
		).toBeNull();
	});
});
