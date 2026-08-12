import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { ONBOARDING_PATH, readOnboardingGate } from "@/lib/onboarding";

const SIGN_IN_PATH = "/sign-in";

const UNGATED = [
	"/",
	SIGN_IN_PATH,
	"/grant-access",
	"/eve",
	"/dashboards",
	"/questions",
	"/users",
	"/companies",
];

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (
		getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) === null
	) {
		return pathname === SIGN_IN_PATH
			? NextResponse.next()
			: NextResponse.redirect(new URL(SIGN_IN_PATH, request.nextUrl));
	}

	if (isUngated(pathname)) return NextResponse.next();

	const onboarding = await readOnboardingGate(request);

	if (onboarding === "required") return sendTo(ONBOARDING_PATH, request);

	return onboarding === "settled" && pathname === ONBOARDING_PATH
		? NextResponse.redirect(new URL("/", request.nextUrl))
		: NextResponse.next();
}

function isUngated(pathname: string): boolean {
	return UNGATED.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

function sendTo(path: string, request: NextRequest): NextResponse {
	return request.nextUrl.pathname === path
		? NextResponse.next()
		: NextResponse.redirect(new URL(path, request.nextUrl));
}

export const config = {
	matcher: [
		"/((?!api|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
