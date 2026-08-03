import { esc } from './html';
import { BRAND_TOKENS, WORDMARK_STYLE, wordmark } from './theme';

const STYLE = `
${BRAND_TOKENS}
${WORDMARK_STYLE}
*{box-sizing:border-box}
body{font-family:var(--sans);background:var(--paper);color:var(--text);margin:0;line-height:1.5}
header{display:flex;justify-content:space-between;align-items:center;padding:.8rem 1rem;
  border-bottom:1px solid var(--rule);background:var(--paper)}
header .biz{font-family:var(--mono);font-weight:600;letter-spacing:.02em}
header a{color:var(--text-dim);text-decoration:none;font-size:.85rem}
header a:hover{color:var(--text)}
/* The palette has no blue, so a bare <a> in body content (there was never a
   rule for one before this pass either) no longer falls back to the
   browser's default link blue, which reads as a stray foreign accent next to
   a deliberately narrow palette. */
a{color:var(--text)}
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
/* Monospace does the talking: every heading and label is tracked-out mono,
   per the brand's type system. Body prose (paragraphs, table descriptions)
   stays in --sans, set on body above. */
h1,h2,h3{margin:1.2rem 0 .6rem;font-size:1.05rem;font-family:var(--mono);font-weight:600;
  text-transform:uppercase;letter-spacing:.08em;color:var(--text)}
h1{font-size:1.2rem}
.tag{font-size:.68rem;font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);
  border:1px solid var(--rule);border-radius:.25rem;padding:.05rem .3rem}
.linkish{background:none;border:0;color:var(--text);text-decoration:underline;cursor:pointer;padding:0;font:inherit}
.card{background:var(--card);border:1px solid var(--card-edge);border-radius:10px;padding:1rem;margin:.7rem 0}
label{display:block;font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;
  color:var(--text-dim);margin:.6rem 0 .2rem}
input,select,button,textarea{font-size:1rem;padding:.55rem;border-radius:.4rem;border:1px solid var(--rule);
  background:var(--paper);color:var(--text);width:100%;font-family:var(--sans)}
input:focus-visible,select:focus-visible,button:focus-visible,textarea:focus-visible{
  outline:2px solid var(--ink-2);outline-offset:1px}
button{background:var(--ink-2);color:var(--btn-ink-fg);border:0;cursor:pointer;font-weight:600}
button:active{background:var(--ink)}
/* The one deliberate exception to "buttons are neutral": stopping a running
   timer is the literal "on the clock" action, so it is the literal amber
   button. Nothing else in this stylesheet colours a button amber. */
button.stop{background:var(--amber);color:var(--ink)}
button.stop:active{background:var(--amber-deep)}
button.secondary{background:transparent;border:1px solid var(--rule);color:var(--text)}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:end}
.row>*{flex:1;min-width:8rem}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:.4rem .3rem;border-bottom:1px solid var(--rule)}
th{font-family:var(--mono);font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;
  color:var(--text-dim);font-weight:600}
td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
/* For a number or date that shouldn't right-align (e.g. a leading date
   column) but should still read as data rather than prose. */
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.muted{color:var(--text-dim);font-size:.85rem}
/* "On the clock" is the label FOR the active state, so it gets the same
   amber as the number underneath it -- see .big below. */
.on-clock{font-family:var(--mono);font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;
  color:var(--amber-text);font-weight:600}
/* The running clock: the one number that IS the "on the clock" state, not
   merely a report of it. */
.big{font-size:2rem;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--amber-text)}
/* A "draft" invoice is unsent work still in flight -- the other place amber
   marks something as in progress rather than settled. */
.status-draft{font-family:var(--mono);font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;
  color:var(--amber-text);font-weight:600}
/* An amount named INSIDE a neutral ink-2 button (e.g. "Create invoice: $X").
   Plain --amber, not the --amber-text alias: that alias is calibrated for
   amber sitting on --paper/--card, and reads muddy on the button's dark ink-2
   chip. Bright amber is what a dark chip wants; see theme.ts. */
.amt{color:var(--amber)}
/* The same idea for an amount sitting directly on --paper/--card (a table
   cell, not a button) -- here the contrast-safe alias is the right one. */
.amt-onpaper{color:var(--amber-text)}
/* Flash banners and inline errors stay within the palette rather than
   reaching for a red/green this brand doesn't have: ok vs. err is carried by
   a leading glyph and weight, not a hue amber would otherwise have to cover. */
.flash{padding:.6rem 1rem;border-radius:.4rem;margin:.5rem 0;background:var(--paper-2);
  border:1px solid var(--rule);font-size:.9rem}
.flash.err{font-weight:600}
.flash.ok::before{content:"\\2713  "}
.flash.err::before{content:"\\26A0  "}
.err{color:var(--text);font-weight:600}
.err::before{content:"\\26A0  "}
.ok{color:var(--text-dim)}
.ok::before{content:"\\2713  "}
a.btnlink{display:inline-block;text-decoration:none}
footer.brand{padding:1.4rem 1rem 2rem;text-align:center;opacity:.6}
footer.brand .wordmark{font-size:.72rem}

/* Print, and therefore Save as PDF, which is how an invoice and a notice of
   changed terms actually reach a client. Everything the reader cannot act on
   from paper is application chrome: the nav, the buttons that produced the
   page, anything marked .noprint. Leaving them in put a "Mark sent" button and
   a "back to Dashboard" link on documents going to a paying customer.

   Colours are forced to the brand's light values rather than left to CSS
   variables, because the app's default may be a dark theme and a printer will
   happily render that as a solid black page -- the same reasoning as before,
   just against the new palette's light literals instead of the old dark
   theme's greys. */
@media print{
  header,.noprint{display:none !important}
  body{background:#F6F6F4;color:#15181E;line-height:1.45}
  main{max-width:none;margin:0;padding:0}
  .card{background:#fff;border:0;border-radius:0;margin:0 0 1rem;padding:0}
  .muted{color:#5C6470}
  a{color:#15181E;text-decoration:none}
  th,td{border-bottom:1px solid #D6D6CF}
  h1,h2{margin:.6rem 0 .4rem}
}
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
  <nav><a href="/">Dashboard</a> &nbsp; <a href="/clients">Clients</a> &nbsp;
    <a href="/mail">Mail</a> &nbsp;
    <a href="/settings">Terms</a> &nbsp; <a href="/logout">Sign out</a></nav>
</header>
<main>${opts.body}</main>
<footer class="noprint brand">${wordmark()}</footer>
</body></html>`;
}
