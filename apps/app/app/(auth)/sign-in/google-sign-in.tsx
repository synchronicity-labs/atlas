"use client";

import { signIn } from "@crm/auth/client";
import GoogleLogo from "@crm/ui/components/brand-logos/google";
import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { getSignInPath } from "@/lib/auth-redirect";

export function GoogleSignIn({ destination }: { destination: string }) {
	const [pending, setPending] = useState(false);

	async function handleClick() {
		setPending(true);

		try {
			const origin = window.location.origin;
			const { error } = await signIn.social({
				provider: "google",
				callbackURL: new URL(destination, origin).toString(),
				errorCallbackURL: new URL(
					getSignInPath(destination, "google"),
					origin,
				).toString(),
			});

			if (error) {
				toast.error(error.message ?? "Could not reach the sign-in service.");
			}
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not reach the sign-in service.",
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<Button
			className="w-full"
			disabled={pending}
			onClick={handleClick}
			type="button"
			variant="outline"
		>
			{pending ? (
				<Spinner data-icon="inline-start" />
			) : (
				<GoogleLogo data-icon="inline-start" className="size-4" />
			)}
			Continue with Google
		</Button>
	);
}
