function clientSafeError(error) {
  const message = String(error?.message || "Unexpected server error");
  const lower = message.toLowerCase();

  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    return "Database is not configured locally. Set DATABASE_URL before starting the server.";
  }
  if (lower.includes("connection timeout")) {
    return "Database connection timeout. Check Vercel DATABASE_URL and use the Supabase pooler connection string with SSL.";
  }
  if (lower.includes("relation") && lower.includes("does not exist")) {
    return "Required database schema is missing. Apply the Supabase migrations before using this feature.";
  }
  if (process.env.NODE_ENV === "production") {
    return "Unexpected server error. Please try again or contact support.";
  }
  return message;
}

module.exports = { clientSafeError };
