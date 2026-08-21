/**
 * Contract read by the frontend service worker (public/sw.js). Only `title` is
 * required; the worker falls back to defaults for anything omitted.
 */
export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
  timestamp?: number;
  data?: Record<string, unknown>;
}

/** Some push services reject bodies larger than this. */
export const MAX_PAYLOAD_BYTES = 3 * 1024;
