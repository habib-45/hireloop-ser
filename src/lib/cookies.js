function baseCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
  };
}

export function readCookie(req, name) {
  const header = req.headers.cookie;

  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();

    if (key !== name) {
      continue;
    }

    const value = part.slice(separator + 1).trim();

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function setSessionCookie(res, config, token) {
  res.cookie(config.sessionCookieName, token, {
    ...baseCookieOptions(config),
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res, config) {
  res.clearCookie(config.sessionCookieName, baseCookieOptions(config));
}
