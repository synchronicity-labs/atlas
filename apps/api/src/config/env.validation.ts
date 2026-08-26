import { plainToInstance, Type } from "class-transformer";
import {
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUrl,
	Max,
	Min,
	MinLength,
	validateSync,
} from "class-validator";

export enum NodeEnv {
	Development = "development",
	Production = "production",
	Test = "test",
}

export class EnvironmentVariables {
	@IsEnum(NodeEnv)
	NODE_ENV: NodeEnv = NodeEnv.Development;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(65535)
	PORT = 3001;

	@IsString()
	@MinLength(1, {
		message:
			"DATABASE_URL is required. `docker compose up -d` starts one, or set it to any Postgres connection string.",
	})
	DATABASE_URL!: string;

	@IsString()
	@MinLength(32, {
		message:
			"BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32",
	})
	BETTER_AUTH_SECRET!: string;

	@IsString()
	@MinLength(1, {
		message:
			'ALLOWED_SIGN_IN is required — it is the only thing deciding who can sign in. Set it to your email domain, e.g. ALLOWED_SIGN_IN="acme.com", or to a single address for a one-person install.',
	})
	ALLOWED_SIGN_IN!: string;

	@IsOptional()
	@IsString()
	GOOGLE_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	GOOGLE_CLIENT_SECRET?: string;

	@IsOptional()
	@IsUrl({ require_tld: false })
	API_URL?: string;

	@IsOptional()
	@IsString()
	APP_URL?: string;

	@IsOptional()
	@IsString()
	AUTH_COOKIE_DOMAIN?: string;

	@IsOptional()
	@IsString()
	REDIS_URL?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	CACHE_TTL_MS?: number;

	@IsOptional()
	@IsString()
	@MinLength(16, {
		message: "CRON_SECRET must be at least 16 characters.",
	})
	CRON_SECRET?: string;

	@IsOptional()
	@IsString()
	BLOB_READ_WRITE_TOKEN?: string;

	@IsOptional()
	@IsUrl(
		{ require_tld: false, require_protocol: true },
		{
			message:
				"AGENT_URL must be a full URL with a scheme, like http://127.0.0.1:2000.",
		},
	)
	AGENT_URL?: string;

	@IsOptional()
	@IsString()
	AGENT_BRIDGE_SECRET?: string;

	@IsOptional()
	@IsUrl({ require_tld: false, require_protocol: true })
	RUDY_API_URL?: string;

	@IsOptional()
	@IsString()
	@MinLength(16, {
		message: "RUDY_API_KEY must be at least 16 characters.",
	})
	RUDY_API_KEY?: string;

	@IsOptional()
	@IsString()
	@MinLength(16, {
		message: "ATLAS_QUERY_SECRET must be at least 16 characters.",
	})
	ATLAS_QUERY_SECRET?: string;

	@IsOptional()
	@IsString()
	@MinLength(32, {
		message: "ATLAS_AUTHORING_SECRET must be at least 32 characters.",
	})
	ATLAS_AUTHORING_SECRET?: string;

	@IsOptional()
	@IsString()
	@MinLength(32, {
		message: "ATLAS_GBRAIN_INGEST_SECRET must be at least 32 characters.",
	})
	ATLAS_GBRAIN_INGEST_SECRET?: string;

	@IsOptional()
	@IsString()
	@MinLength(32, {
		message: "ATLAS_Q3_GTM_INGEST_SECRET must be at least 32 characters.",
	})
	ATLAS_Q3_GTM_INGEST_SECRET?: string;

	@IsOptional()
	@IsUrl({ require_tld: false })
	METABASE_BASE_URL?: string;

	@IsOptional()
	@IsString()
	METABASE_API_KEY?: string;

	@IsOptional()
	@IsString()
	@MinLength(16, {
		message: "STRIPE_SECRET_KEY must be at least 16 characters.",
	})
	STRIPE_SECRET_KEY?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	METABASE_DASHBOARD_ID?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	METABASE_USER_QUESTION_ID?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	METABASE_SYNC_BATCH_SIZE?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(10)
	@Max(2000)
	METABASE_USER_BATCH_SIZE?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(120)
	METABASE_MAX_BACKFILL_MONTHS?: number;

	@IsOptional()
	@IsString()
	GOOGLE_SERVICE_ACCOUNT_JSON?: string;

	@IsOptional()
	@IsString()
	KPI_CATALOG_SPREADSHEET_ID?: string;

	@IsOptional()
	@IsString()
	GA4_LANDING_PROPERTY_ID?: string;

	@IsOptional()
	@IsString()
	GA4_BLOG_PROPERTY_ID?: string;

	@IsOptional()
	@IsString()
	GA4_PLAYGROUND_PROPERTY_ID?: string;

	@IsOptional()
	@IsString()
	GA4_DOCS_PROPERTY_ID?: string;

	@IsOptional()
	@IsString()
	GA4_LIPSYNC_PROPERTY_ID?: string;

	@IsOptional()
	@IsString()
	GA4_SUPPORT_PROPERTY_ID?: string;

	@IsOptional()
	@IsString()
	GOOGLE_SEARCH_CONSOLE_SYNC_SITE?: string;

	@IsOptional()
	@IsString()
	GOOGLE_SEARCH_CONSOLE_LIPSYNC_SITE?: string;

	@IsOptional()
	@IsUrl({ require_tld: false })
	POSTHOG_HOST?: string;

	@IsOptional()
	@IsString()
	POSTHOG_API_KEY?: string;

	@IsOptional()
	@IsString()
	POSTHOG_PROJECT_ID?: string;

	@IsOptional()
	@IsString()
	HUBSPOT_ACCESS_TOKEN?: string;

	@IsOptional()
	@IsUrl({ require_tld: false })
	HUBSPOT_BASE_URL?: string;

	@IsOptional()
	@IsString()
	HUBSPOT_PORTAL_ID?: string;

	@IsOptional()
	@IsString()
	BETTERSTACK_TELEMETRY_API_KEY?: string;

	@IsOptional()
	@IsString()
	BETTERSTACK_SQL_EU_HOST?: string;

	@IsOptional()
	@IsString()
	BETTERSTACK_SQL_EU_USER?: string;

	@IsOptional()
	@IsString()
	BETTERSTACK_SQL_EU_PASS?: string;
}

export function validateEnv(
	config: Record<string, unknown>,
): EnvironmentVariables {
	const validated = plainToInstance(EnvironmentVariables, config, {
		enableImplicitConversion: true,
		exposeDefaultValues: true,
	});

	const errors = validateSync(validated, {
		skipMissingProperties: false,
		whitelist: false,
	});

	if (errors.length > 0) {
		const details = errors
			.map((error) => Object.values(error.constraints ?? {}).join(", "))
			.join("\n  - ");

		throw new Error(
			`Invalid environment configuration:\n  - ${details}\n\nSee .env.example at the root of the repo.`,
		);
	}

	return validated;
}
