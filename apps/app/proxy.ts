import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

const SIGN_IN_PATH = "/sign-in";
const ONBOARDING_PATH = "/onboarding";
const APP_HOME_PATH = "/dashboards";

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (
		getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) === null
	) {
		if (pathname === SIGN_IN_PATH) {
			return NextResponse.next();
		}

		const signInUrl = new URL(SIGN_IN_PATH, request.nextUrl);
		signInUrl.searchParams.set(
			"next",
			`${request.nextUrl.pathname}${request.nextUrl.search}`,
		);

		return NextResponse.redirect(signInUrl);
	}

	return pathname === ONBOARDING_PATH ||
		pathname.startsWith(`${ONBOARDING_PATH}/`)
		? NextResponse.redirect(new URL(APP_HOME_PATH, request.nextUrl))
		: NextResponse.next();
}

export const config = {
	matcher: [
		"/((?!api|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
