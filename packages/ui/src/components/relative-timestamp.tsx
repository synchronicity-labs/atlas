"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import {
	formatUtcTimestamp,
	relativeTimeFromIso,
} from "@crm/ui/lib/format";
import { useEffect, useState } from "react";

export function RelativeTimestamp({
	value,
	prefix = "Updated",
}: {
	value: string;
	prefix?: string;
}) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const interval = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(interval);
	}, []);

	const relative = relativeTimeFromIso(value, { style: "long", now });
	const exact = formatUtcTimestamp(value);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<time
					dateTime={value}
					suppressHydrationWarning
					tabIndex={0}
					className="cursor-help underline decoration-dotted underline-offset-2"
				>
					{prefix ? `${prefix} ` : ""}
					{relative}
				</time>
			</TooltipTrigger>
			<TooltipContent>{exact}</TooltipContent>
		</Tooltip>
	);
}
