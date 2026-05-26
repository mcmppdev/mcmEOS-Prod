const isProd = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || (isProd ? "" : "mcm-dev-secret");

if (isProd && !SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required when NODE_ENV=production.");
}

module.exports = {
  isProd,
  port: process.env.PORT || 4173,
  sessionTtlMs: 1000 * 60 * 60 * 24,
  sessionTouchIntervalMs: 1000 * 60 * 5,
  sessionRetentionDays: 30,
  SESSION_SECRET
};
