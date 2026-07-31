import { esc } from './html';

const STYLE = `
:root{--bg:#0d1117;--card:#161b22;--fg:#e6edf3;--muted:#8b949e;--accent:#1f6feb;--line:#30363d;--good:#238636;--warn:#9e6a03}
@media (prefers-color-scheme: light){:root{--bg:#f6f8fa;--card:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de}}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);margin:0;line-height:1.5}
header{display:flex;justify-content:space-between;align-items:center;padding:.8rem 1rem;border-bottom:1px solid var(--line)}
header .biz{font-weight:600}
header a{color:var(--muted);text-decoration:none;font-size:.85rem}
main{max-width:44rem;margin:0 auto;padding:1rem}
/* One column by default: the design target is a phone. */
.cols{display:grid;gap:0}
.col{min-width:0}
/* Two columns once there is genuinely room for two readable ones. Keyed to
   content width rather than a device guess, and align-items:start so a short
   column does not stretch its cards to match a tall neighbour. */
@media (min-width:62rem){
  main{max-width:76rem}
  .cols{grid-template-columns:1fr 1fr;gap:0 1.2rem;align-items:start}
}
h1,h2{margin:1.2rem 0 .6rem;font-size:1.1rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:1rem;margin:.7rem 0}
label{display:block;font-size:.85rem;color:var(--muted);margin:.5rem 0 .1rem}
input,select,button,textarea{font-size:1rem;padding:.55rem;border-radius:.4rem;border:1px solid var(--line);background:var(--bg);color:var(--fg);width:100%}
button{background:var(--accent);color:#fff;border:0;cursor:pointer;font-weight:600}
button.stop{background:var(--warn)}
button.secondary{background:transparent;border:1px solid var(--line);color:var(--fg)}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:end}
.row>*{flex:1;min-width:8rem}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:.4rem .3rem;border-bottom:1px solid var(--line)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.muted{color:var(--muted);font-size:.85rem}
.big{font-size:2rem;font-variant-numeric:tabular-nums}
.flash{padding:.6rem 1rem;border-radius:.4rem;margin:.5rem 0}
.flash.ok{background:rgba(35,134,54,.15);border:1px solid var(--good)}
.flash.err{background:rgba(158,106,3,.15);border:1px solid var(--warn)}
a.btnlink{display:inline-block;text-decoration:none}
`;

export function layout(opts: { title: string; business: string; body: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} · HourChit</title>
<style>${STYLE}</style></head>
<body>
<header>
  <span class="biz">${esc(opts.business)}</span>
  <nav><a href="/">Dashboard</a> &nbsp; <a href="/logout">Sign out</a></nav>
</header>
<main>${opts.body}</main>
</body></html>`;
}
