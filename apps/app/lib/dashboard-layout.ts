import type { Layout, LayoutItem } from "react-grid-layout";

export function packDashboardLayout(layout: Layout): Layout {
	const source = [...layout].sort(
		(left, right) => left.y - right.y || left.x - right.x,
	);
	const result: LayoutItem[] = [];
	let row: LayoutItem[] = [];
	let rowWidth = 0;
	let nextY = 0;

	function flushRow() {
		if (row.length === 0) return;
		let nextX = 0;
		const height = Math.max(...row.map((item) => item.h));
		row.forEach((item, index) => {
			const width = index === row.length - 1 ? 24 - nextX : item.w;
			result.push({ ...item, x: nextX, y: nextY, w: width, h: height });
			nextX += width;
		});
		nextY += height;
		row = [];
		rowWidth = 0;
	}

	for (const item of source) {
		const width = Math.min(24, Math.max(4, item.w));
		if (row.length > 0 && (item.y !== row[0]?.y || rowWidth + width > 24)) {
			flushRow();
		}
		row.push({ ...item, w: width, h: Math.max(3, item.h) });
		rowWidth += width;
	}
	flushRow();
	return result;
}

export function stackDashboardLayout(layout: Layout, original: Layout): Layout {
	const heights = new Map(original.map((item) => [item.i, item.h]));
	let nextY = 0;
	return [...layout]
		.sort((left, right) => left.y - right.y || left.x - right.x)
		.map((item) => {
			const height = heights.get(item.i) ?? item.h;
			const stacked = { ...item, x: 0, y: nextY, w: 24, h: height };
			nextY += height;
			return stacked;
		});
}
