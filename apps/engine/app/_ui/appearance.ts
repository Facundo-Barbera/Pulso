/**
 * The appearance settings, Telar's system in small: theme, accent, depth, the
 * interface typeface and (in the Mac window) translucency. Stored per browser
 * in localStorage and applied to <html> as the attributes globals.css keys off
 * (`.dark`, `data-accent`, `data-depth`, `data-font-sans`, `data-translucent`).
 *
 * `INIT_SCRIPT` runs before first paint (a bare <script> in layout.tsx), so a
 * reload never flashes the default look; `applyAppearance` does the same live.
 */
export const ACCENTS = ["rose", "indigo", "violet", "plum", "sky", "sea", "moss", "amber"] as const;
export const DEPTHS = ["soft", "flat", "deep"] as const;
export const FONTS = ["geist", "inter", "system"] as const;
export const THEMES = ["system", "dark", "light"] as const;

export type Appearance = {
  theme: (typeof THEMES)[number];
  accent: (typeof ACCENTS)[number];
  depth: (typeof DEPTHS)[number];
  font: (typeof FONTS)[number];
  translucent: boolean;
};

/** Rose is the brand gradient's middle stop. `system` follows the Mac (dark first: the CSS falls to dark when there is no light preference). */
export const DEFAULT_APPEARANCE: Appearance = { theme: "system", accent: "rose", depth: "soft", font: "geist", translucent: true };

export const STORAGE_KEY = "pulso-appearance";

const pick = <T extends readonly string[]>(options: T, value: unknown, fallback: T[number]): T[number] =>
  options.includes(value as string) ? (value as T[number]) : fallback;

export function readAppearance(): Appearance {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
  } catch {}
  return {
    theme: pick(THEMES, stored.theme, DEFAULT_APPEARANCE.theme),
    accent: pick(ACCENTS, stored.accent, DEFAULT_APPEARANCE.accent),
    depth: pick(DEPTHS, stored.depth, DEFAULT_APPEARANCE.depth),
    font: pick(FONTS, stored.font, DEFAULT_APPEARANCE.font),
    translucent: typeof stored.translucent === "boolean" ? stored.translucent : DEFAULT_APPEARANCE.translucent,
  };
}

const prefersDark = () => !window.matchMedia("(prefers-color-scheme: light)").matches;

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.classList.toggle("dark", appearance.theme === "dark" || (appearance.theme === "system" && prefersDark()));
  // `indigo`, `soft` and `geist` are the copied CSS's defaults and have no block.
  const set = (name: string, value: string, none: string) => (value === none ? root.removeAttribute(name) : root.setAttribute(name, value));
  set("data-accent", appearance.accent, "indigo");
  set("data-depth", appearance.depth, "soft");
  set("data-font-sans", appearance.font, "geist");
  root.toggleAttribute("data-translucent", appearance.translucent);
}

export function saveAppearance(appearance: Appearance): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  applyAppearance(appearance);
}

/**
 * Pre-paint: the same as `readAppearance` + `applyAppearance`, inlined, plus
 * the shell flag. `data-telar-shell` is the attribute the copied CSS gates the
 * Mac window's translucency and titlebar inset on; it is set only inside
 * Pulso's Electron window (by user agent: the window has no preload, on purpose).
 */
export const INIT_SCRIPT = `(function(){try{var d=document.documentElement;var a={};try{a=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'{}')}catch(e){}
var p=function(o,v,f){return o.indexOf(v)>=0?v:f};
var t=p(${JSON.stringify(THEMES)},a.theme,'${DEFAULT_APPEARANCE.theme}');
var dark=t==='dark'||(t==='system'&&!matchMedia('(prefers-color-scheme: light)').matches);
d.classList.toggle('dark',dark);
var s=function(n,v,none){if(v===none)d.removeAttribute(n);else d.setAttribute(n,v)};
s('data-accent',p(${JSON.stringify(ACCENTS)},a.accent,'${DEFAULT_APPEARANCE.accent}'),'indigo');
s('data-depth',p(${JSON.stringify(DEPTHS)},a.depth,'${DEFAULT_APPEARANCE.depth}'),'soft');
s('data-font-sans',p(${JSON.stringify(FONTS)},a.font,'${DEFAULT_APPEARANCE.font}'),'geist');
if(a.translucent!==false)d.setAttribute('data-translucent','');
if(/Electron\\//.test(navigator.userAgent))d.setAttribute('data-telar-shell',/Mac/.test(navigator.platform)?'macos':'');
matchMedia('(prefers-color-scheme: light)').addEventListener('change',function(e){var c={};try{c=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'{}')}catch(x){}if((c.theme||'system')==='system')d.classList.toggle('dark',!e.matches)});
}catch(e){}})();`;
