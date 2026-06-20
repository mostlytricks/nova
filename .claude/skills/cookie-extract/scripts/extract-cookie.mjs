#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

function usage() {
  console.error(`Usage: node extract-cookie.mjs --url <url> [options]

Options:
  --cookie-name <name>       Cookie name to export. Repeat for multiple.
  --out <file>               Output JSON file. Default: %TEMP%/codex-cookies.json
  --user-data-dir <dir>      Persistent browser profile directory.
  --post-login-url <text>    Optional URL substring expected after login.
  --timeout-ms <n>           Navigation timeout. Default: 60000.
  --list-only                List redacted cookies and do not export values.
`);
}

function parseArgs(argv) {
  const opts = {
    cookieNames: [],
    out: path.join(os.tmpdir(), 'codex-cookies.json'),
    timeoutMs: 60_000,
    listOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    if (arg === '--url') opts.url = next();
    else if (arg === '--cookie-name') opts.cookieNames.push(next());
    else if (arg === '--out') opts.out = next();
    else if (arg === '--user-data-dir') opts.userDataDir = next();
    else if (arg === '--post-login-url') opts.postLoginUrl = next();
    else if (arg === '--timeout-ms') opts.timeoutMs = Number(next());
    else if (arg === '--list-only') opts.listOnly = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!opts.url) throw new Error('--url is required');
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) throw new Error('--timeout-ms must be positive');
  return opts;
}

async function prompt(message) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}

function redact(value) {
  if (!value) return '';
  if (value.length <= 8) return '<redacted>';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function looksLikeLogin(page) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const hasPassword = await page.locator('input[type="password"]').count().catch(() => 0);
  const loginButton = await page.locator('button, input[type="submit"], a').filter({
    hasText: /log in|login|sign in|signin|continue|sso/i,
  }).count().catch(() => 0);
  return {
    login: /login|signin|sign-in|sso|auth|oauth/i.test(url) ||
      /login|sign in|signin|sso|auth/i.test(title) ||
      hasPassword > 0 ||
      loginButton > 0,
    signals: {
      url,
      title,
      passwordInputs: hasPassword,
      loginLikeControls: loginButton,
    },
  };
}

function cookieHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    throw new Error(`Playwright is required. Run "pnpm install" and "pnpm exec playwright install chromium". ${e.message}`);
  }

  let context;
  if (opts.userDataDir) {
    context = await chromium.launchPersistentContext(opts.userDataDir, { headless: false });
  } else {
    const browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
  }

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
    const loginState = await looksLikeLogin(page);

    console.log(`Opened: ${page.url()}`);
    console.log(`Title: ${loginState.signals.title || '(none)'}`);
    if (loginState.login) {
      console.log('Login appears to be required. Complete login in the browser window.');
      await prompt('Press Enter here after login finishes...');
      if (opts.postLoginUrl) {
        await page.waitForURL((u) => u.toString().includes(opts.postLoginUrl), { timeout: opts.timeoutMs }).catch(() => undefined);
      } else {
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      }
    } else {
      const answer = await prompt('Page does not look like a login page. Press Enter to extract cookies, or type "wait" to log in first: ');
      if (answer.trim().toLowerCase() === 'wait') {
        await prompt('Complete login in the browser window, then press Enter here...');
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      }
    }

    const allCookies = await context.cookies(opts.url);
    const selected = opts.cookieNames.length
      ? allCookies.filter((c) => opts.cookieNames.includes(c.name))
      : allCookies;

    const redacted = selected.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
      value: redact(c.value),
    }));

    console.log(JSON.stringify({ cookieCount: selected.length, cookies: redacted }, null, 2));

    if (opts.listOnly) return;
    if (opts.cookieNames.length === 0) {
      const answer = await prompt('No --cookie-name was provided. Export all listed cookies? Type "yes" to continue: ');
      if (answer.trim().toLowerCase() !== 'yes') {
        console.log('No cookies exported.');
        return;
      }
    }

    const out = {
      url: opts.url,
      exportedAt: new Date().toISOString(),
      cookies: selected,
      cookieHeader: cookieHeader(selected),
    };
    await fs.mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
    await fs.writeFile(opts.out, JSON.stringify(out, null, 2), 'utf8');
    console.log(`Saved ${selected.length} cookie(s) to ${opts.out}`);
  } finally {
    await context.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  usage();
  process.exit(1);
});
