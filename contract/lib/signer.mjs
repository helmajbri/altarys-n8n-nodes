// Webhook signature v2 as a sender computes it, written independently of the node packages so
// that a defect in a package's verifier cannot also hide in the signer that tests it.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Lowercase hex HMAC-SHA256, keyed by the secret (UTF-8), over `{timestamp}.{raw body}`. */
export function signV2(secret, timestamp, rawBody) {
	return createHmac('sha256', Buffer.from(secret, 'utf8'))
		.update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]))
		.digest('hex');
}

/** v1: lowercase hex HMAC-SHA256 of the raw body alone. */
export function signV1(secret, rawBody) {
	return createHmac('sha256', Buffer.from(secret, 'utf8')).update(rawBody).digest('hex');
}

/**
 * Checks the signer against the shared vectors file. Returns the names of the vectors it fails;
 * an empty file is refused, so an empty result always means every vector was reproduced.
 */
export function checkVectors(path, pinnedSha256) {
	const bytes = readFileSync(path);
	const digest = createHash('sha256').update(bytes).digest('hex');
	if (pinnedSha256 && digest !== pinnedSha256) {
		throw new Error(`vectors file ${path} has sha256 ${digest}, not the pinned ${pinnedSha256}`);
	}
	const vectors = JSON.parse(bytes.toString('utf8')).vectors;
	if (!Array.isArray(vectors) || vectors.length === 0) throw new Error(`no vectors in ${path}`);
	const failed = [];
	for (const v of vectors) {
		const got = signV2(v.secret, String(v.timestamp), Buffer.from(v.body_hex, 'hex'));
		if (got !== v.expected_v2) failed.push(v.name);
	}
	return { count: vectors.length, failed };
}
