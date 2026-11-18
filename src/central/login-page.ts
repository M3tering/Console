import { createHash } from 'crypto';

/** Central sign-in page. Served before authentication, so it cannot load the desktop's
 * static CSS; everything is inline and allowed by an exact hash. No scripts at all. */
const css = `
:root{--ink:#1f332c;--muted:#5f6f67;--accent:#316a4d;--accent-ink:#fff;--card:#fbfcfa;--field:#fff;--line:#cdd6cb;
  --danger:#a53a43;--danger-bg:#fbeeee;--ok-bg:#eaf4ee;--shadow:0 30px 80px #04191433,0 2px 10px #04191418;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--ink:#eef2ef;--muted:#a9b7b0;--accent:#7cc39a;--accent-ink:#0f241a;--card:#1d2925;
  --field:#15201c;--line:#36463f;--danger:#f19aa1;--danger-bg:#3a2226;--ok-bg:#1f3a2b;--shadow:0 30px 80px #0008;color-scheme:dark}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{min-height:100dvh;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);color:var(--ink);
  font:15px/1.5 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:radial-gradient(ellipse at 15% 85%,#3f7a5c 0%,transparent 55%),radial-gradient(ellipse at 85% 10%,#2b5f63 0%,transparent 50%),
  linear-gradient(140deg,#0d2a25 0%,#173c39 55%,#24524a 100%)}
.hero{display:flex;flex-direction:column;justify-content:space-between;padding:48px 56px;color:#eaf3ee}
.brand{display:flex;align-items:center;gap:12px;font-weight:600;font-size:16px}
.mark{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#eaf3ee;color:#173c39;font-weight:700;font-size:17px;letter-spacing:-.5px}
.brand small{display:block;font-weight:400;font-size:13px;color:#b8cec3}
.eyebrow{font-size:12px;letter-spacing:.16em;color:#a9c7b8;margin:0 0 14px}
.hero h2{font-size:clamp(34px,4.4vw,56px);line-height:1.05;letter-spacing:-.02em;margin:0;font-weight:650}
.hero p.lede{max-width:30em;color:#c9dbd2;margin:18px 0 0}
.hero footer{font-size:13px;color:#a9c7b8}
main{display:grid;place-items:center;padding:32px}
.card{width:min(410px,100%);background:var(--card);border-radius:20px;padding:36px 34px 30px;box-shadow:var(--shadow)}
.card .mark{display:none}
h1{font-size:24px;line-height:1.2;margin:0 0 6px;letter-spacing:-.01em}
.sub{margin:0 0 24px;color:var(--muted)}
.alert{display:flex;gap:10px;align-items:flex-start;margin:0 0 20px;padding:12px 14px;border-radius:12px;font-size:14px}
.alert::before{flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;font-weight:700;font-size:12px;margin-top:1px}
.alert.error{background:var(--danger-bg);color:var(--danger)}
.alert.error::before{content:"!";background:var(--danger);color:var(--card)}
.alert.ok{background:var(--ok-bg);color:var(--accent)}
.alert.ok::before{content:"✓";background:var(--accent);color:var(--accent-ink)}
form{display:grid;gap:16px}
label{display:grid;gap:6px;font-size:13px;font-weight:600}
input{width:100%;height:46px;padding:0 14px;border:1px solid var(--line);border-radius:11px;background:var(--field);color:var(--ink);
  font:inherit;font-size:15px;transition:border-color .15s,box-shadow .15s}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)}
button{margin-top:6px;height:48px;border:0;border-radius:11px;background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:600;
  font-size:15px;cursor:pointer;transition:filter .15s,transform .05s}
button:hover{filter:brightness(1.07)}
button:active{transform:translateY(1px)}
button:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:3px}
.note{display:flex;align-items:center;gap:8px;margin:22px 0 0;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}
.note::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--accent)}
@media (max-width:860px){
  body{grid-template-columns:1fr}
  .hero{display:none}
  main{padding:24px 16px;align-content:center}
  .card{padding:30px 22px 24px}
  .card .mark{display:grid;margin-bottom:18px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const favicon = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#173c39"/>' +
  '<text x="32" y="42" font-family="sans-serif" font-size="28" font-weight="700" text-anchor="middle" fill="#eaf3ee">m³</text></svg>');

export const loginPolicy = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(css).digest('base64')}'; ` +
  "img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const escape = (value: string): string => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export interface LoginView { error?: string; notice?: string; username?: string }
export function loginPage({ error, notice, username = '' }: LoginView = {}): string {
  const message = error ? `<p class="alert error" role="alert">${escape(error)}</p>`
    : notice ? `<p class="alert ok" role="status">${escape(notice)}</p>` : '';
  const focusPassword = !!error && !!username;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Sign in · M3tering Console</title><link rel="icon" href="${favicon}"><style>${css}</style></head>
<body>
<section class="hero" aria-hidden="true">
  <div class="brand"><span class="mark">m³</span><span>M3tering Console<small>Central workspace</small></span></div>
  <div><p class="eyebrow">YOUR ENERGY. YOUR ENVIRONMENT.</p><h2>A little more<br>connected.</h2>
  <p class="lede">Every gateway, its terminal, network server and meters, from one secure workspace.</p></div>
  <footer>M3tering Console · Provider workspace</footer>
</section>
<main>
  <div class="card">
    <span class="mark" aria-hidden="true">m³</span>
    <h1>Welcome back</h1>
    <p class="sub">Sign in to manage your gateways.</p>
    ${message}
    <form method="post" action="/login">
      <label>Username<input name="username" autocomplete="username" required maxlength="100" value="${escape(username)}"${focusPassword ? '' : ' autofocus'}></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="1024"${focusPassword ? ' autofocus' : ''}></label>
      <button>Sign in</button>
    </form>
    <p class="note">Encrypted connection · Sessions end after 8 hours</p>
  </div>
</main>
</body></html>`;
}
