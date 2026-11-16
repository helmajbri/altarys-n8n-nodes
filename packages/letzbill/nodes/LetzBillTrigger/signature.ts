import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature v2: lowercase hex HMAC-SHA256, keyed by the endpoint secret (UTF-8), over the
 * bytes `{timestamp}.{raw body}`. The timestamp is Unix seconds in X-Webhook-Timestamp and must be
 * within the tolerance of the receiver's clock, in either direction.
 */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type VerificationFailure =
	| 'no_secret'
	| 'missing_parameters'
	| 'bad_timestamp'
	| 'timestamp_outside_tolerance'
	| 'signature_mismatch';

export type Verification = { ok: true } | { ok: false; reason: VerificationFailure };

export interface DeliveryToVerify {
	timestamp: string | undefined;
	signature: string | undefined;
	rawBody: Buffer | undefined;
	secret: string;
	nowSeconds: number;
	toleranceSeconds: number;
}

const TIMESTAMP_PATTERN = /^[0-9]{1,15}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function signV2(secret: string, timestamp: string, rawBody: Buffer): string {
	return createHmac('sha256', Buffer.from(secret, 'utf8'))
		.update(Buffer.from(`${timestamp}.`, 'utf8'))
		.update(rawBody)
		.digest('hex');
}

export function verifySignatureV2(delivery: DeliveryToVerify): Verification {
	if (!delivery.secret) return { ok: false, reason: 'no_secret' };
	if (!delivery.timestamp || !delivery.signature || delivery.rawBody === undefined) {
		return { ok: false, reason: 'missing_parameters' };
	}
	if (!TIMESTAMP_PATTERN.test(delivery.timestamp)) return { ok: false, reason: 'bad_timestamp' };
	const timestamp = Number(delivery.timestamp);
	if (Math.abs(delivery.nowSeconds - timestamp) > delivery.toleranceSeconds) {
		return { ok: false, reason: 'timestamp_outside_tolerance' };
	}
	const given = delivery.signature.trim().toLowerCase();
	if (!DIGEST_PATTERN.test(given)) return { ok: false, reason: 'signature_mismatch' };
	const expected = signV2(delivery.secret, delivery.timestamp, delivery.rawBody);
	const match = timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(given, 'utf8'));
	return match ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}
