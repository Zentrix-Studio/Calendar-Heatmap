"use strict";

/**
 * Single source of truth for the user-visible build version.
 *
 * KEEP IN SYNC with pbiviz.json (visual.version + top-level "version") and
 * package.json on every release bump — it's part of the version-bump checklist.
 * Surfaced on the landing page (and available for support/diagnostics) so a user
 * can tell exactly which build they're running at a glance.
 */
export const VERSION = "1.0.0.0";
