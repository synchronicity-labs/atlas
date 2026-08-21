import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { getSafeAuthDestination } from "@/lib/auth-redirect";
import { getSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { GoogleSignIn } from "./google-sign-in";
import { type SsoProvider, SsoSignIn } from "./sso-sign-in";

export const metadata: Metadata = {
	title: "Sign in",
};

export const dynamic = "force-dynamic";

type SignInOptions = { google: boolean; providers: SsoProvider[] };

async function signInOptions(): Promise<SignInOptions | null> {
	try {
		return await getServerQueryClient().fetchQuery(
			getServerTrpc().sso.signInOptions.queryOptions(),
		);
	} catch (error) {
		console.error("Sign-in: could not read the sign-in options.", error);
		return null;
	}
}

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{
		method?: string | string[];
		next?: string | string[];
	}>;
}) {
	const [session, options, { method, next }] = await Promise.all([
		getSession().catch((error: unknown) => {
			console.error("Sign-in: could not read the session.", error);
			return null;
		}),
		signInOptions(),
		searchParams,
	]);
	const destination = getSafeAuthDestination(next);

	if (session) {
		redirect(destination);
	}

	const google = options?.google ?? true;
	const providers = options?.providers ?? [];

	const insistOnGoogle = method === "google" && google;
	const showSso = providers.length > 0 && !insistOnGoogle;
	const showGoogle = google && (providers.length === 0 || insistOnGoogle);

	if (!showSso && !showGoogle) {
		return (
			<AuthShell>
				<AuthHeading
					title="No way in yet"
					description="Atlas has no sign-in method configured, so nobody can get in — including you."
				/>

				<p className="text-center text-muted-foreground text-sm/5">
					Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Doppler and restart.
				</p>
			</AuthShell>
		);
	}

	return (
		<AuthShell>
			<AuthHeading
				title="Welcome back"
				description="Sign in with your account to continue."
			/>

			{showSso ? (
				<SsoSignIn destination={destination} providers={providers} />
			) : null}
			{showGoogle ? <GoogleSignIn destination={destination} /> : null}
		</AuthShell>
	);
}
