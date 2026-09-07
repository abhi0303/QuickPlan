/**
 * Where the frontend lives. Used to build the links inside verification and
 * reset emails, so getting it wrong sends people to a page that does not
 * exist - and they only find out after clicking.
 *
 * Overridden by APP_URL. This default is the last resort, and it matters
 * because a missing environment variable would otherwise point every email at
 * whichever domain happened to be current when the code was written.
 *
 * No trailing path: the custom domain serves the app at its root.
 */
export const DEFAULT_APP_URL = 'https://quickplan.co.in';
