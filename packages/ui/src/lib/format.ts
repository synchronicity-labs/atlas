export function formatCount(count: number, noun: string): string {
	return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

const WELL_FORMED_CURRENCY_CODE = /^[A-Za-z]{3}$/;

function displayCurrencyCode(currency: string): string {
	return WELL_FORMED_CURRENCY_CODE.test(currency)
		? currency.toUpperCase()
		: "USD";
}

export function formatMoney(cents: number, currency = "usd"): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: displayCurrencyCode(currency),
		minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
	}).format(cents / 100);
}

export function formatMoneyCompact(cents: number, currency = "usd"): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: displayCurrencyCode(currency),
		notation: "compact",
		maximumFractionDigits: cents % 100_000 === 0 ? 0 : 1,
	}).format(cents / 100);
}

export function formatPercent(rate: number): string {
	return new Intl.NumberFormat(undefined, {
		style: "percent",
		maximumFractionDigits: 0,
	}).format(rate);
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

const monthFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});

const compactMonthFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	timeZone: "UTC",
});

const utcTimestampFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
	timeZone: "UTC",
});

const longRelativeFormat = new Intl.RelativeTimeFormat("en-US", {
	numeric: "always",
});

const MONTH_PERIOD = /^\d{4}-\d{2}(?:-\d{2}(?:T.*)?)?$/;

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

export function toDay(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDay(value: string | null | undefined): Date | undefined {
	if (!value) return undefined;
	const [year, month, day] = value.slice(0, 10).split("-").map(Number);
	if (!year || !month || !day) return undefined;
	const date = new Date(year, month - 1, day);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatDay(value: string | null | undefined): string {
	const date = fromDay(value);
	return date ? dayFormat.format(date) : (value ?? "—");
}

export function formatMonthPeriod(
	value: unknown,
	options: { includeMtd?: boolean; compact?: boolean } = {},
): string {
	if (typeof value !== "string" || !MONTH_PERIOD.test(value)) {
		return String(value ?? "");
	}
	const date = new Date(value.length === 7 ? `${value}-01T00:00:00Z` : value);
	if (Number.isNaN(date.getTime())) return value;
	const now = new Date();
	const current =
		date.getUTCFullYear() === now.getUTCFullYear() &&
		date.getUTCMonth() === now.getUTCMonth();
	const label = options.compact
		? compactMonthFormat.format(date)
		: monthFormat.format(date);
	return current && options.includeMtd ? `${label} MTD` : label;
}

export function formatUtcTimestamp(value: string | null | undefined): string {
	if (!value) return "—";
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: `${utcTimestampFormat.format(date)} UTC`;
}

export function relativeTimeFromIso(
	iso: string | null | undefined,
	options: { style?: "short" | "long"; now?: number } = {},
): string {
	if (!iso) return "—";
	const then = new Date(iso).getTime();
	if (!Number.isFinite(then)) return "—";
	const diff = (options.now ?? Date.now()) - then;
	const abs = Math.abs(diff);
	const min = 60_000;
	const hour = 60 * min;
	const day = 24 * hour;
	if (abs < min) return "just now";
	if (options.style === "long") {
		const [amount, unit] =
			abs < hour
				? [Math.round(abs / min), "minute" as const]
				: abs < day
					? [Math.round(abs / hour), "hour" as const]
					: abs < 7 * day
						? [Math.round(abs / day), "day" as const]
						: abs < 30 * day
							? [Math.round(abs / (7 * day)), "week" as const]
							: abs < 365 * day
								? [Math.round(abs / (30 * day)), "month" as const]
								: [Math.round(abs / (365 * day)), "year" as const];
		return longRelativeFormat.format(diff < 0 ? amount : -amount, unit);
	}
	const distance =
		abs < hour
			? `${Math.round(abs / min)}m`
			: abs < day
				? `${Math.round(abs / hour)}h`
				: abs < 30 * day
					? `${Math.round(abs / day)}d`
					: null;
	if (distance === null) {
		return new Date(iso).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	}
	return diff < 0 ? `in ${distance}` : `${distance} ago`;
}

export function initialsFromName(name: string | null | undefined): string {
	const parts = (name ?? "").split(/\s+/).filter(Boolean);
	const first = parts[0];
	if (!first) return "?";
	if (parts.length === 1) return first.slice(0, 2).toUpperCase();
	const last = parts[parts.length - 1] ?? first;
	return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase();
}
