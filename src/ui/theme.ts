/**
 * The HourChit brand system.
 *
 * A single source of truth for the CSS custom properties every HTML surface
 * consumes -- the interactive app chrome (layout.ts), the login page
 * (auth.ts), the standalone mail shell (ui/mail.ts), and the printable
 * invoice (ui/invoice.ts). Centralised so the palette is defined exactly once
 * and those four page shells stay in lockstep rather than drifting through
 * copy-paste; each shell still owns its own layout rules, because they are
 * genuinely different documents, but the tokens beneath them are shared.
 *
 * Values are verbatim from the approved brand mockup. Do not change a hex
 * here without updating the mockup it came from.
 *
 * ONE RULE ABOVE ALL OTHERS: amber means "on the clock" -- active, running, in
 * progress -- and nothing else. It is not a general-purpose accent. If amber
 * starts showing up on things that are merely important, it stops meaning
 * anything at all. See the ledger below for exactly where it is allowed.
 *
 * --amber-text is NOT one of the seven brand colours; it is a derived alias
 * that just points at --amber or --amber-deep depending on background, and it
 * exists because the mockup's own comment on --amber-deep says the bright
 * --amber "fails contrast" as text on paper. Measured: bright amber (#E8952A)
 * on light paper (#F6F6F4) is ~2.2:1 -- nowhere near AA. amber-deep
 * (#B96C13) on the same paper is ~3.7:1, which clears AA for the bold/large
 * text this system uses amber for. In dark mode the bright --amber the
 * mockup already substitutes is calibrated for dark paper and reads at
 * ~8.6:1 there, so the alias just tracks whichever amber is correct for the
 * current --paper, in both cases using colours the mockup already defines --
 * never a new one.
 *
 * A second, separate case: amber text set on the dark --ink-2 button chip
 * (used for the one amber-tinted amount inside a button label) wants plain
 * --amber even in light mode, because --ink-2 is a fixed dark surface
 * regardless of theme -- amber-deep there measures a muddy ~3.3:1, while
 * bright amber clears ~5.6:1. That case uses var(--amber) directly at the
 * call site rather than the alias; see dashboard.ts.
 *
 * --card / --card-edge: the mockup asks for "card/panel backgrounds: pure
 * white in light mode", which is a different, brighter surface than --paper
 * itself (the page background, a warm off-white). --card is that panel
 * surface; --card-edge is just --rule, named separately so a future surface
 * that wants a different edge treatment (e.g. print, which hardcodes its own
 * light values instead of using variables at all) has somewhere to diverge
 * without touching --rule for everyone else.
 *
 * --btn-ink-fg: the literal light value of --paper (#F6F6F4), held constant
 * rather than following the light/dark flip. Buttons use --ink-2 as a
 * background in BOTH themes (it is never redefined by the dark media query,
 * so it is always a dark chip), which means the label text on top must
 * always be light too -- var(--paper) would go dark the moment the OS
 * switches to dark mode, putting dark text on a dark chip. This constant is
 * exactly the hex --paper already uses in light mode; it is not a new colour.
 */

/** Full palette: light by default, dark via prefers-color-scheme. For the
 * interactive app chrome that a person actually navigates (dashboard,
 * clients, settings, notices, mail, login). */
export const BRAND_TOKENS = `:root{
  --ink:#15181E;--ink-2:#2A2F38;
  --paper:#F6F6F4;--paper-2:#E9E9E4;--rule:#D6D6CF;
  --text:#15181E;--text-dim:#5C6470;
  --amber:#E8952A;--amber-deep:#B96C13;--kraft:#D8BE8D;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --card:#fff;--card-edge:var(--rule);
  --amber-text:var(--amber-deep);
  --btn-ink-fg:#F6F6F4;
}
@media (prefers-color-scheme: dark){
  :root{
    --paper:#15181E;--paper-2:#1C2029;--rule:#2E3540;
    --text:#E7E7E3;--text-dim:#939BA7;
    --amber:#F0A544;--kraft:#C9AE7D;
    --card:var(--paper-2);--card-edge:var(--rule);
    --amber-text:var(--amber);
  }
}`;

/**
 * Light-only palette, for the one surface that must render identically no
 * matter who is looking at it or on what device: the printable invoice and
 * the PDF Browser Run renders from the same HTML. A business document should
 * look the same on the client's screen as on the operator's, and a dark
 * scheme forced onto a printed or PDF page is how an invoice comes out solid
 * black -- see the print notes already in layout.ts. No dark-mode override on
 * purpose.
 */
export const BRAND_TOKENS_LIGHT = `:root{
  --ink:#15181E;--ink-2:#2A2F38;
  --paper:#F6F6F4;--paper-2:#E9E9E4;--rule:#D6D6CF;
  --text:#15181E;--text-dim:#5C6470;
  --amber:#E8952A;--amber-deep:#B96C13;--kraft:#D8BE8D;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --card:#fff;--card-edge:var(--rule);
  --amber-text:var(--amber-deep);
  --btn-ink-fg:#F6F6F4;
}`;

/**
 * The product wordmark: "Hour" in the page's ordinary text colour, "Chit" in
 * amber. This is the one place amber appears purely as identity rather than
 * as a state signal -- the mockup names it explicitly as one of the four
 * allowed uses, alongside active buttons, currency figures, and in-progress
 * indicators.
 */
export function wordmark(): string {
  return '<span class="wordmark">Hour<span class="chit">Chit</span></span>';
}

/**
 * Shared CSS for the wordmark, so every page that renders it (the login
 * heading, the app-shell footer) agrees on what it looks like. Callers still
 * set their own font-size/opacity for context (a heading vs. a quiet footer
 * credit); this only fixes the type treatment and the colour split.
 */
export const WORDMARK_STYLE = `
.wordmark{font-family:var(--mono);font-weight:700;text-transform:uppercase;
  letter-spacing:.06em;color:var(--text)}
.wordmark .chit{color:var(--amber-text)}
`;
