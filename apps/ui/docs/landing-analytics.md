# Public homepage analytics

The production site is https://heyhey.goatcounter.com/ and its tracking
endpoint is `https://heyhey.goatcounter.com/count`.

Production's `docker-compose.prod.yml` sets `VITE_GOATCOUNTER_ENDPOINT`
directly to this endpoint; no additional environment-file setting is needed.
The UI container publishes it through `/runtime-config.js`, so the UI image
does not need rebuilding when the endpoint changes. An empty value disables
tracking. Staging uses `STAGING_GOATCOUNTER_ENDPOINT`, which should remain
empty unless a separate GoatCounter site is registered for staging.

Only the standalone public homepage loads the tracking script. It records
the `/` page without query parameters and both signup links as `Signup Click`
events. Existing-user sign-in, welcome credentials, and app pages are excluded.
No goal configuration or API key is required.

After deployment, visit the homepage and click a signup link. Verify the `/`
page and `Signup Click` event in GoatCounter, then check that `/login` and
authenticated app pages do not load `gc.zgo.at/count.js`.

## Post-deploy verification checklist

1. Locally, run `vitest run src/pages/Landing` and confirm the landing tests pass.
2. Fetch `https://heyhey.dev/runtime-config.js` and confirm
   `goatCounterEndpoint` is `https://heyhey.goatcounter.com/count`. Fetch
   `https://staging.heyhey.dev/runtime-config.js` and confirm it is `""`.
3. In a browser with devtools open on `https://heyhey.dev/`, confirm a request
   to `gc.zgo.at/count.js` and a `heyhey.goatcounter.com/count?p=%2F` hit.
   Click a "Sign up" link and confirm a `count?p=Signup%20Click&e=true` beacon
   and that the link still goes to `/request-access`.
4. Repeat on `https://staging.heyhey.dev/`, `/login`, and signed-in app pages
   and confirm no `goatcounter` or `zgo.at` requests.
5. In the GoatCounter dashboard, confirm the `/` visit and the `Signup Click`
   event for today. Use a normal (non-headless) browser for this check:
   GoatCounter marks headless or automated browsers as bots (the `b=` request
   parameter) and leaves them out of the dashboard.

If counts are missing, check the served runtime config and the deployment's
`VITE_GOATCOUNTER_ENDPOINT` before changing code.

Compare homepage visitors and signup clicks over the same date range to
calculate a rough click rate. Repeated clicks count separately, so this is
an intent measure rather than a deduplicated conversion or completed signup.
Blocking analytics can also reduce recorded counts.
