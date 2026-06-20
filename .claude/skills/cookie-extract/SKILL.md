---
name: cookie-extract
description: Human-in-the-loop browser login and session cookie extraction for protected web apps. Use when Claude/Codex needs to open a specified page, detect whether login is required, let the user complete login interactively, then extract target session cookies for later curl/API fetches. Designed for Windows/project-local workflows with Playwright and explicit user approval for headed browser interaction.
---

# cookie-extract

Use this skill to obtain session cookies from a real browser login flow with the user present. This is for HITL authentication handoff, not credential collection.

## Safety Rules

- Ask the user before launching a headed browser.
- Never ask the user to paste passwords, MFA codes, or raw credential secrets into chat.
- The user enters credentials only into the browser window.
- Extract only cookies the user requested, or list cookie names/domains with values redacted and ask which to export.
- Treat extracted cookies as secrets. Do not print cookie values in final answers unless the user explicitly requests it.
- Prefer short-lived output files under `$env:TEMP`; tell the user where the file is.
- Do not bypass TLS verification or browser security controls.

## Workflow

1. Gather:
   - target URL
   - target cookie name(s), if known
   - optional expected post-login URL pattern
   - output file path, default `$env:TEMP\codex-cookies.json`
2. Launch the bundled script in headed mode.
3. If the page looks logged out, ask the user to complete login in the browser and press Enter in the terminal when done.
4. Extract cookies for the target URL.
5. If target cookie names are unknown, review the redacted cookie list and ask the user which names to export.
6. Use the exported cookie file with `windows-ca-web-fetch` or another explicit fetch workflow.

## Script

Default interactive run:

```powershell
node .claude\skills\cookie-extract\scripts\extract-cookie.mjs `
  --url "https://internal.example.com/docs" `
  --cookie-name "session" `
  --out "$env:TEMP\codex-cookies.json"
```

Multiple cookies:

```powershell
node .claude\skills\cookie-extract\scripts\extract-cookie.mjs `
  --url "https://internal.example.com/docs" `
  --cookie-name "session" `
  --cookie-name "csrf" `
  --out "$env:TEMP\codex-cookies.json"
```

Use a persistent browser profile when SSO requires it:

```powershell
node .claude\skills\cookie-extract\scripts\extract-cookie.mjs `
  --url "https://internal.example.com/docs" `
  --user-data-dir "$env:TEMP\codex-auth-profile" `
  --out "$env:TEMP\codex-cookies.json"
```

The output JSON contains selected cookie objects and a `cookieHeader` string usable with curl.

## Detection Heuristics

The script treats a page as likely login when it sees any of:

- password input
- submit button text like login/sign in/continue
- URL/title containing login, signin, sso, auth, oauth

Heuristics are advisory only. If uncertain, ask the user whether the page is logged in before extracting.

## Hand Off To Fetch

After extraction, use `windows-ca-web-fetch` with either:

```powershell
--Cookie "name=value; other=value"
```

or convert the JSON cookies to the exact cookie header needed. Keep the cookie value out of chat logs where possible.
