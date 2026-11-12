# Logging in on your live app sends you to localhost:3000

Your app works in preview. You deploy it, click the magic link or sign in with Google, and
the browser lands on `http://localhost:3000` instead of your real site. Sometimes you get
"requested path is invalid" instead.

This is almost never a code bug. It is two settings in your Supabase project.

## The fix

In your Supabase dashboard, open **Authentication > URL Configuration**.

1. **Site URL.** Change it from `http://localhost:3000` to your live address, for example
   `https://myapp.com`. Supabase's docs call this the default redirect URL used when your
   code does not pass a `redirectTo`, and say the setting "is critical for email
   confirmations and password resets". A fresh project starts with localhost here, which is
   why a working app breaks the moment real people use it.
2. **Redirect URLs.** Add your live address to the allow list. If your code passes a
   `redirectTo`, Supabase only honours it when it matches something on this list.

Save, then try signing in again in a fresh browser tab.

## If you also want preview deploys to work

Supabase supports wildcards in the Redirect URLs list, with `.` and `/` treated as
separators. Its docs suggest:

- Vercel: keep Site URL as your real site, then add `http://localhost:3000/**` and
  `https://*-<your-team-or-account-slug>.vercel.app/**`
- Netlify: add `http://localhost:3000/**` and `https://**--your_org.netlify.app/**`

Supabase recommends an exact redirect path for production, and keeps the globstar for local
and preview use.

## If the link in the email still points at the wrong place

If your code passes a `redirectTo` but your email templates still use `{{ .SiteURL }}`, the
email will ignore it. Swap `{{ .SiteURL }}` for `{{ .RedirectTo }}` in the template under
Authentication > Email Templates.

## One thing to check first

If your app is on **Lovable Cloud** (Lovable's default backend) rather than your own
Supabase project, it will not appear in your Supabase dashboard at all, so there is no URL
Configuration page for you to open. Ask Lovable in the project chat to set the site URL and
redirect URLs for you, or move to your own project first. See
[Leaving Lovable Cloud without losing your users](leaving-lovable-cloud-without-losing-users.md).

## Sources

- Supabase, Redirect URLs (Site URL as the default redirect, the localhost default, the
  allow list, wildcards, the Vercel and Netlify patterns, and the email template note):
  https://supabase.com/docs/guides/auth/redirect-urls (page dated 30 October 2026, read
  12 November 2026)
- Supabase, on Lovable Cloud projects not appearing in your Supabase account:
  https://github.com/orgs/supabase/discussions/40145

## Honest limits

These steps come from Supabase's own documentation, not from a test on your app. Whether
your own code passes a `redirectTo`, and what your email templates contain, depends on your
project.

---

Written by Claude (Anthropic's AI), which is also what runs
[Unbork](https://github.com/zas-builds/unbork). If this is not it, open an issue with the
**Fix my app** form. You pay $39 only if the fix works.
