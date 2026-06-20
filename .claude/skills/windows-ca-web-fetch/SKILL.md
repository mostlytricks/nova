---
name: windows-ca-web-fetch
description: Fetch internal or protected web resources from Windows without built-in WebFetch/browser tools, using curl.exe with custom CA bundles, explicit headers, cookies, redirects, and large-response handling. Use when Claude/Codex must retrieve URLs that need corporate/private CA trust, Authorization headers, session cookies, custom request headers, or precise Windows command behavior.
---

# windows-ca-web-fetch

Use this skill when a normal fetch tool is unsuitable because the request needs Windows-specific control over TLS, custom CA bundles, headers, cookies, redirects, or response files.

## Rules

- Use `curl.exe`, not `curl`; PowerShell may alias `curl` to `Invoke-WebRequest`.
- Prefer the bundled wrapper: `scripts/fetch.ps1`.
- Never use `-k` or `--insecure` unless the user explicitly asks after being told it disables certificate verification.
- Treat header values, bearer tokens, API keys, and cookies as secrets. Do not echo them back in final answers.
- Save large responses to a temp/output file, then inspect only the needed parts.
- If a request fails, report status, TLS/cert error, redirect issue, or auth failure without exposing secrets.

## Inputs To Gather

Ask for missing values only when needed:

- URL.
- CA bundle path, for example `C:\certs\corp-root.pem`.
- Headers, for example `Authorization: Bearer ...`, `Accept: text/markdown`.
- Cookies, either inline cookie string or cookie file path.
- Method and body for non-GET requests.
- Output preference: stdout for small text, file for large content.

## Wrapper

Use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\windows-ca-web-fetch\scripts\fetch.ps1 `
  -Url "https://internal.example.com/llms.txt" `
  -CaCert "C:\certs\corp-root.pem" `
  -Header "Accept: text/markdown" `
  -Header "Authorization: Bearer <token>" `
  -Cookie "sid=<cookie>" `
  -OutFile "$env:TEMP\llms.txt"
```

For cookie jar workflows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\windows-ca-web-fetch\scripts\fetch.ps1 `
  -Url "https://internal.example.com/docs" `
  -CookieFile ".\cookies.txt" `
  -CookieJar ".\cookies.txt" `
  -OutFile "$env:TEMP\docs.html"
```

For POST/JSON:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\windows-ca-web-fetch\scripts\fetch.ps1 `
  -Url "https://internal.example.com/api/search" `
  -Method POST `
  -Header "Content-Type: application/json" `
  -Body '{"q":"routing"}' `
  -OutFile "$env:TEMP\search.json"
```

## Direct curl.exe Fallback

If the wrapper is not available, use direct `curl.exe`:

```powershell
curl.exe --fail-with-body --location --show-error `
  --cacert "C:\certs\corp-root.pem" `
  -H "Accept: text/markdown,text/plain,text/html" `
  -H "Authorization: Bearer <token>" `
  --cookie "session=<cookie>" `
  --output "$env:TEMP\response.txt" `
  "https://internal.example.com/llms.txt"
```

## Troubleshooting

- Certificate error: verify the PEM path and retry with `--verbose` if needed. Do not disable verification.
- PowerShell quoting issue: prefer the wrapper and pass each header as a separate `-Header`.
- 401/403: credentials or cookies are missing/expired; ask the user for refreshed auth.
- 404: URL or route is stale; do not assume an alternate route unless the user provides it.
- 5xx/timeout: retry once, then report the failure.

## Reporting

Summarize:

- URL host/path, not secret query values if sensitive.
- HTTP success/failure and content type when known.
- Output file path if saved.
- Which non-secret request features were used: custom CA, custom headers, cookie jar, POST body.

Do not include raw cookies, bearer tokens, API keys, or full proprietary response dumps unless the user explicitly asks and it is safe.
