# OAuth and password reset setup

OAuth login and email password recovery are disabled until each provider's credentials are configured in the hosting environment. Do not commit client secrets or SMTP passwords.

## Public application URL

Set `APP_BASE_URL` to the canonical HTTPS origin of the deployed app, with no trailing path, for example `https://your-app.onrender.com`.

Register these exact callback URLs with each provider:

- Google: `${APP_BASE_URL}/api/auth/google/callback`
- Discord: `${APP_BASE_URL}/api/auth/discord/callback`

For the current Render service, that means `https://oceandonate.onrender.com/api/auth/google/callback` and `https://oceandonate.onrender.com/api/auth/discord/callback`.

## Google login

Create a Google OAuth web client, configure the app's authorized domain and consent screen, and add the callback URL above as an authorized redirect URI. Set these Render environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Google must return a verified email for the account to be accepted.

## Discord login

Create a Discord application, add the callback URL above under OAuth2 redirects, and set:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`

Discord must return a verified email. Provider access tokens are not stored by OceanDonate.

## Password reset email

Configure an SMTP account that can send mail for your verified sender domain. Set:

- `SMTP_HOST`
- `SMTP_PORT` (usually `465` for implicit TLS or `587` for STARTTLS)
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM` (verified sender address, optionally formatted as `OceanDonate <no-reply@example.com>`)

The forgot-password route responds with the same message whether or not an account exists. Reset links expire after 30 minutes and work once. Until SMTP is configured, the route remains enumeration-safe and does not send a reset email.

## Enablement check

After setting variables in Render, redeploy and verify Google and Discord signup, login, explicit account linking, and email delivery. Use test accounts first. Do not put credentials in source code, logs, chat, or screenshots. This setup enables OAuth/recovery only; it does not change the EasySlip payment configuration.
