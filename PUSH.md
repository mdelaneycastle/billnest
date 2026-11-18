# Optional direct iPhone notifications

GitHub Pages serves the app. Supabase runs the optional background scheduler. A fully local setup can skip this entire page and use the recurring Calendar reminders in the app.

## 1. Create the notification service

Use a Supabase project you control, install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then run from the repository root:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy outgoings-push --no-verify-jwt
```

Set these **Edge Function secrets** in Supabase Dashboard → Edge Functions → Secrets:

| Name | Value |
| --- | --- |
| `OUTGOINGS_ORIGIN` | The actual HTTPS origin in Olly’s browser, without any path or trailing slash. The default Pages URL currently redirects to `https://marcdelaney.co.uk`. |
| `OUTGOINGS_INVITE` | A random setup code for Olly. Generate with `openssl rand -hex 32`. |
| `OUTGOINGS_CRON_SECRET` | A different random value from a second run of `openssl rand -hex 32`. |
| `OUTGOINGS_VAPID_PUBLIC` | The public key from `npx --yes web-push@3.6.7 generate-vapid-keys`. |
| `OUTGOINGS_VAPID_PRIVATE` | The private key from the same command. Keep it secret. |
| `OUTGOINGS_VAPID_SUBJECT` | A contact address like `mailto:you@example.com`. |
| `OUTGOINGS_DB_KEY` | Optional. A Supabase secret API key if the runtime’s built-in legacy `SUPABASE_SERVICE_ROLE_KEY` is unavailable. |

The public Edge Function uses the invite for enrolment and a separate high-entropy per-device credential for edits. Cron authenticates with its own secret. The tables and SQL functions are restricted to the service role. Keep the invite, cron secret and private VAPID key out of GitHub and the browser. Share only the invite with Olly.

## 2. Schedule the delivery job

Enable **Cron** and **pg_net** in Supabase. Add secrets named `outgoings_push_url` and `outgoings_cron_secret` in Supabase Vault. Their values are the full URL `https://YOUR_PROJECT_REF.supabase.co/functions/v1/outgoings-push` and the same cron secret from step 1. Then run this in the Supabase SQL editor:

```sql
select cron.schedule(
  'outgoings-reminders',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'outgoings_push_url'),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-outgoings-cron',
        (select decrypted_secret from vault.decrypted_secrets where name = 'outgoings_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $job$
);
```

## 3. Connect GitHub Pages

In repository **Settings → Secrets and variables → Actions → Variables**, create these two repository variables:

- `OUTGOINGS_PUSH_ENDPOINT` with the full Edge Function URL.
- `OUTGOINGS_VAPID_PUBLIC` with the **public** VAPID key.

Run the Pages workflow again. For a different static host, set those same two public values in `dist/push-config.js` and change the cache version in `dist/sw.js` when redeploying. If you use a Supabase custom endpoint domain, also allow its origin in the CSP in `dist/index.html`.

## 4. Verify on Olly’s iPhone

From the Home Screen icon go to **Settings → Phone reminders → Set up notifications**. Enter the setup code and tap **Enable alerts → Allow**. Tap **Send test alert**, lock the phone and check for the test. Also add a test bill with an upcoming date and confirm a scheduled alert end to end.

The browser stores bill data. The server receives a device subscription, a credential hash, a revision counter and generic reminder timestamps. Payments repeat within a rolling 366-day horizon, while renewals use their next entered date. Reopen the app online periodically to extend the horizon and upload any offline edits. Multiple payments or renewals on the same alert day produce one generic message at about 9am UK time. Focus, permissions, service availability and network delays can affect delivery. Use Calendar if you want the reminders to continue without opening the app.

**Turn off** in app Settings removes the device subscription and scheduled jobs. A push already claimed or queued by the browser gateway may still arrive. The scheduler cleans up expired jobs and subscriptions that have gone inactive. After testing, review the Cron run history and any failed function invocations without logging request payloads.
