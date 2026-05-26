const LOGIN_WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_USERNAME = 5;
const MAX_FAILURES_PER_IP = 10;

class LoginRateLimitError extends Error {
  constructor(message = "Too many login attempts. Try again later.") {
    super(message);
    this.name = "LoginRateLimitError";
    this.statusCode = 429;
  }
}

async function assertLoginAllowed(pool, { username, ipAddress }) {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const ip = String(ipAddress || "").trim();
  if (!normalizedUsername && !ip) return;

  const { rows } = await pool.query(
    `
    select
      count(*) filter (where $1 <> '' and lower(coalesce(username, '')) = $1)::integer as username_failures,
      count(*) filter (where $2 <> '' and coalesce(ip_address, '') = $2)::integer as ip_failures
    from public.app_login_audit
    where success = false
      and login_at >= now() - ($3::text || ' minutes')::interval
      and (
        ($1 <> '' and lower(coalesce(username, '')) = $1)
        or ($2 <> '' and coalesce(ip_address, '') = $2)
      )
    `,
    [normalizedUsername, ip, String(LOGIN_WINDOW_MINUTES)]
  );

  const row = rows[0] || {};
  if (Number(row.username_failures || 0) >= MAX_FAILURES_PER_USERNAME) {
    throw new LoginRateLimitError();
  }
  if (Number(row.ip_failures || 0) >= MAX_FAILURES_PER_IP) {
    throw new LoginRateLimitError();
  }
}

module.exports = {
  assertLoginAllowed,
  LoginRateLimitError,
  LOGIN_WINDOW_MINUTES,
  MAX_FAILURES_PER_USERNAME,
  MAX_FAILURES_PER_IP
};
