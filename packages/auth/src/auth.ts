import { sso } from "@better-auth/sso";
import { db } from "@crm/db";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";
import { AUTH_COOKIE_PREFIX } from "./cookies";
import { env } from "./env";
import { ensureWorkspaceMembership } from "./organization";
import { notifySignedIn } from "./signed-in";
import {
	hasSignInAllowList,
	isWorkspaceEmail,
	primaryWorkspaceDomain,
} from "./workspace";

const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};

if (env.google) {
	socialProviders.google = env.google;
}

export const auth = betterAuth({
	appName: "Atlas",
	baseURL: env.appUrl,

	database: prismaAdapter(db, {
		provider: "postgresql",
	}),

	emailAndPassword: {
		enabled: false,
	},

	socialProviders,

	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ["google"],
		},
	},

	session: {
		expiresIn: 60 * 60 * 24 * 7,
		updateAge: 60 * 60 * 24,
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
	},

	rateLimit: {
		enabled: true,
		storage: "database",
	},

	advanced: {
		cookiePrefix: AUTH_COOKIE_PREFIX,

		useSecureCookies: env.isProduction,
		...(env.cookieDomain && {
			crossSubDomainCookies: {
				enabled: true,
				domain: env.cookieDomain,
			},
		}),
	},

	trustedOrigins: [...env.trustedOrigins],
	hooks: {},

	plugins: [
		organization({
			allowUserToCreateOrganization: false,
			disableOrganizationDeletion: true,
			creatorRole: "owner",

			schema: {
				organization: {
					additionalFields: {
						website: {
							type: "string",
							required: false,
						},
					},
				},
			},
		}),

		sso({
			organizationProvisioning: { disabled: true },
		}),
	],

	databaseHooks: {
		user: {
			create: {
				before: async (user) => {
					if (!hasSignInAllowList()) {
						throw new APIError("FORBIDDEN", {
							message:
								"No one can sign in yet: configure ALLOWED_SIGN_IN with your company email domain and restart Atlas.",
						});
					}

					if (!isWorkspaceEmail(user.email)) {
						const domain = primaryWorkspaceDomain();
						throw new APIError("FORBIDDEN", {
							message: domain
								? `Atlas is private. Sign in with your @${domain} account.`
								: "Atlas is private. That address is not on the allow-list.",
						});
					}

					return { data: user };
				},
			},
		},

		session: {
			create: {
				before: async (session) => {
					const workspaceId = await ensureWorkspaceMembership(session.userId);

					return {
						data: { ...session, activeOrganizationId: workspaceId ?? null },
					};
				},

				after: async (session) => {
					const user = await db.user.findUnique({
						where: { id: session.userId },
						select: { id: true, email: true },
					});

					if (user) await notifySignedIn(user);
				},
			},
		},
	},
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session["user"];
