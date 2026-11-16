/**
 * Event IDs the trigger has already turned into workflow items, each with the signed timestamp of
 * the delivery that carried it. A delivery can only be replayed while its timestamp is inside the
 * tolerance, so an entry older than the tolerance is no longer needed and is pruned.
 */
export const MAX_REMEMBERED_EVENTS = 1000;

export interface SeenEvents {
	duplicate: boolean;
	next: Record<string, number>;
}

export function rememberEvent(
	stored: unknown,
	eventId: string,
	timestamp: number,
	nowSeconds: number,
	windowSeconds: number,
): SeenEvents {
	const kept: Array<[string, number]> = [];
	if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
		for (const [id, seenAt] of Object.entries(stored as Record<string, unknown>)) {
			if (typeof seenAt === 'number' && seenAt >= nowSeconds - windowSeconds) kept.push([id, seenAt]);
		}
	}
	const duplicate = kept.some(([id]) => id === eventId);
	if (!duplicate) kept.push([eventId, timestamp]);
	kept.sort((a, b) => a[1] - b[1]);
	const next: Record<string, number> = {};
	for (const [id, seenAt] of kept.slice(-MAX_REMEMBERED_EVENTS)) next[id] = seenAt;
	return { duplicate, next };
}
