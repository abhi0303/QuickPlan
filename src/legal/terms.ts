/**
 * Which terms a person agreed to, not merely that they ticked something.
 *
 * A boolean answers "did they tick a box" and nothing else. It cannot answer
 * the question that actually comes up - *which* terms did this person agree
 * to, and do they need to see the new ones - and it quietly becomes a lie the
 * first time the terms change.
 */

/** The version a new signup is expected to accept. Bump when the policies change. */
export const CURRENT_TERMS_VERSION = '2026-09-10';

/**
 * Every version that has ever been published, newest last. Older entries stay
 * here so a stale frontend that accepts a real earlier version is recorded
 * truthfully - and, being older than current, is asked again.
 */
export const PUBLISHED_TERMS_VERSIONS: readonly string[] = [CURRENT_TERMS_VERSION];

/**
 * Backfilled onto accounts that predate any published policy. Server-only: it
 * records that we do not know what they agreed to, which is the truth, and it
 * sorts before every real version so those accounts are asked once.
 */
export const LEGACY_TERMS_VERSION = 'legacy';

/** True for a version a client is allowed to claim acceptance of. */
export function isPublishedVersion(version: string): boolean {
  return PUBLISHED_TERMS_VERSIONS.includes(version);
}

/**
 * Whether the stored acceptance still covers the current policies.
 *
 * Anything unrecognised - null, 'legacy', or a version withdrawn since - counts
 * as out of date. Erring towards asking again is the safe direction: the cost
 * is one tap, and the cost of the other mistake is a consent record that does
 * not mean anything.
 */
export function needsReacceptance(version: string | null | undefined): boolean {
  return version !== CURRENT_TERMS_VERSION;
}
