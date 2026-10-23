const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface LoginPageParams {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  error?: string;
  email?: string;
}

export const renderLoginPage = (params: LoginPageParams): string => {
  const errorBlock = params.error
    ? `<div class="error">${escapeHtml(params.error)}</div>`
    : '';

  const emailValue = params.email ? escapeHtml(params.email) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hey Hey CLI - Sign In</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
        Helvetica, Arial, sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #333;
    }
    .card {
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 2rem;
      width: 100%;
      max-width: 400px;
    }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .error {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      color: #991b1b;
      padding: 0.75rem;
      border-radius: 6px;
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }
    label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; }
    input[type="email"], input[type="password"] {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.95rem;
      margin-bottom: 1rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.15); }
    button {
      width: 100%;
      padding: 0.65rem;
      background: #4f46e5;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #4338ca; }
    .scope { color: #888; font-size: 0.8rem; text-align: center; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign in to Hey Hey</h1>
    <p class="subtitle">The CLI is requesting access to your account.</p>
    ${errorBlock}
    <form method="POST" action="/api/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
      <input type="hidden" name="scope" value="${escapeHtml(params.scope)}">
      <input type="hidden" name="state" value="${escapeHtml(params.state)}">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autofocus
        value="${emailValue}" placeholder="you@example.com">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required
        placeholder="Your password">
      <button type="submit">Sign in</button>
    </form>
    <p class="scope">Requested scope: ${escapeHtml(params.scope)}</p>
  </div>
</body>
</html>`;
};
