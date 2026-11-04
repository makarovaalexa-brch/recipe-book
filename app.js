'use strict';
/* Recipe Book – phone app. Plain JS, no build step.
 * Data comes from the Apps Script back end (see backend/Code.gs) and is cached
 * in localStorage so recipes still open offline. Without a back end configured
 * it runs against Mock (mock.js), which keeps demo data on this device. */

// ------------------------------------------------------------- basics ---

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yes = v => v === true || /^(y|yes|true|1)$/i.test(String(v == null ? '' : v).trim());
const num = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);

const store = {
  get(k, d) { try { const v = localStorage.getItem('rb_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rb_' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
};

let D = store.get('cache', null); // everything from bootstrap
const UI = {
  week: weekOf(new Date()),
  rFilter: 'all', rSort: 'recent', rq: '',
  portions: {}, got: {}, step: {}, swaps: {},
  draft: store.get('draft', null),
  showTrolley: false, showHome: false,
  basicsOpen: store.get('basicsOpen', false),
  wake: null,
};

function cfg() { return store.get('cfg', { api: '', key: '' }); }
function S() { return (D && D.settings) || {}; }
function defPortions() { return num(S().default_portions, 7); }
function saveCache() { store.set('cache', D); }

// ------------------------------------------------------------- dates ---

function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function today() { return iso(new Date()); }
function parseIso(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
/** Weeks run Sunday–Saturday (planning and shopping happen on Sunday). */
function weekOf(date) { const d = new Date(date); d.setDate(d.getDate() - d.getDay()); return iso(d); }
function addDays(isoStr, n) { const d = parseIso(isoStr); d.setDate(d.getDate() + n); return iso(d); }
function daysSince(s) { return s ? Math.round((parseIso(today()) - parseIso(s)) / 864e5) : Infinity; }
function nice(s, opts) { return s ? parseIso(s).toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short' }) : ''; }
function ago(s) {
  const n = daysSince(s);
  if (n === Infinity) return 'never';
  if (n < 1) return 'today';
  if (n < 2) return 'yesterday';
  if (n < 14) return n + ' days ago';
  if (n < 60) return Math.round(n / 7) + ' weeks ago';
  return Math.round(n / 30) + ' months ago';
}

// ---------------------------------------------------------------- api ---

async function api(action, payload) {
  const c = cfg();
  setSync('<span class="spinner"></span>');
  try {
    let data;
    if (!c.api) {
      data = await Mock.call(action, JSON.parse(JSON.stringify(payload || {})));
    } else {
      const res = await fetch(c.api, { method: 'POST', body: JSON.stringify(Object.assign({}, payload, { action, key: c.key })) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      data = j.data;
    }
    setSync('');
    return data;
  } catch (e) {
    setSync(/fetch|network/i.test(e.message) ? 'offline' : '');
    throw e;
  }
}

function setSync(html) { const el = $('#sync'); if (el) el.innerHTML = html; }

let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 2600);
}

/** Runs an api call, showing errors as a toast. Returns undefined on failure. */
async function run(action, payload) {
  try { return await api(action, payload); } catch (e) { toast(e.message, true); }
}

/** New ingredients get nutrition, price and swap data from Gemini in the background. */
async function enrichNewItems() {
  if (!cfg().api || !D.items.some(i => !i.group)) return;
  try {
    const res = await api('itemsEnrich', {});
    if (res && res.items) { D.items = res.items; saveCache(); render(); }
  } catch (e) { /* not urgent – it retries on the next save */ }
}

async function load() {
  try {
    D = await api('bootstrap');
    saveCache();
  } catch (e) {
    if (!D) { $('#view').innerHTML = '<div class="empty">Could not load: ' + esc(e.message) + '<br><br><a href="#/settings">Check settings</a></div>'; return; }
    toast('Offline – showing saved copy', true);
  }
  render();
}

// ----------------------------------------------------------- lookups ---

function recipe(id) { return D.recipes.find(r => r.id === id); }
function activeRecipes() { return D.recipes.filter(r => !yes(r.archived)); }
function itemMap() { const m = {}; D.items.forEach(i => { m[i.id] = i; }); return m; }

function normKey(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s-]/g, ' ')
    .replace(/\b(fresh|large|small|medium|free range|organic)\b/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map(w => {
      if (w.length > 4 && /(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
      if (w.length > 3 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
      if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
      return w;
    }).join(' ');
}
function findItem(name) {
  const k = normKey(name);
  return D.items.find(i => normKey(i.name) === k ||
    String(i.aliases || '').split(',').some(a => a.trim() && normKey(a) === k));
}
function searchItems(q) {
  const k = normKey(q);
  if (!k) return [];
  const hit = i => [i.name].concat(String(i.aliases || '').split(',')).some(n => normKey(n).includes(k));
  return D.items.filter(hit)
    .sort((a, b) => (normKey(a.name).startsWith(k) ? 0 : 1) - (normKey(b.name).startsWith(k) ? 0 : 1) || a.name.localeCompare(b.name))
    .slice(0, 8);
}
function aisleIdx(a) { const i = D.aisles.indexOf(a); return i < 0 ? 999 : i; }

function stats() {
  const s = {};
  D.log.forEach(l => {
    if (!l.recipe_id) return;
    const x = s[l.recipe_id] || (s[l.recipe_id] = { count: 0, sum: 0, n: 0, last: '' });
    x.count++;
    const r = Number(l.rating);
    if (r) { x.sum += r; x.n++; }
    if (String(l.date) > x.last) x.last = String(l.date);
  });
  Object.values(s).forEach(x => { x.avg = x.n ? x.sum / x.n : 0; });
  return s;
}

function verdict(st) {
  if (!st) return '<span class="badge">new</span>';
  if (st.n && st.avg <= 2) return '<span class="badge bad">never again</span>';
  if (st.count >= 3 && st.avg >= 4) return '<span class="badge good">staple</span>';
  return '';
}

function stars(v, showEmpty) {
  if (!v && !showEmpty) return '';
  const r = Math.round(v);
  return '<span class="stars">' + '★'.repeat(r) + '<span class="off">' + '★'.repeat(5 - r) + '</span></span>';
}

/** Recipe types fall into the three meal sections of the week. */
const GROUPS = [['dinner', 'Dinners'], ['baking', 'Baking'], ['other', 'Other meals']];
function groupOf(type) {
  type = type || 'dinner';
  return type === 'dinner' ? 'dinner' : type === 'baking' || type === 'dessert' ? 'baking' : 'other';
}
/** Section of a plan entry ('extra' is how older versions stored baking and other meals). */
function kindOf(e) {
  if (e.kind !== 'extra') return e.kind || 'dinner';
  const r = recipe(e.recipe_id);
  return r ? groupOf(r.type) : 'other';
}
function chillies(r) { const n = num(r && r.spice, 0); return n > 0 ? '<span title="spice level">' + '🌶'.repeat(Math.min(3, n)) + '</span>' : ''; }

const EMOJI = { baking: '🧁', dessert: '🍮', side: '🥗', breakfast: '🥣', lunch: '🥪', fish: '🐟', seafood: '🦐', veggie: '🥦', vegan: '🥦', beef: '🥩', chicken: '🍗', pork: '🥓', lamb: '🍖' };
function emoji(r) { return (r && (EMOJI[r.type] || EMOJI[r.protein])) || '🍲'; }
function thumb(r, cls) {
  return r && r.image
    ? '<img class="' + (cls || 'thumb') + '" src="' + esc(r.image) + '" alt="" loading="lazy">'
    : '<div class="' + (cls || 'thumb') + '">' + emoji(r) + '</div>';
}

// --------------------------------------------------- quantities/units ---

const UNITS = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000], tsp: ['tsp', 1], tbsp: ['tsp', 3] };
const PLURAL = { clove: 'cloves', tin: 'tins', pack: 'packs', bunch: 'bunches', pinch: 'pinches', slice: 'slices' };
const SLICES_PER_LOAF = 16;

function fmtNum(n) {
  if (!isFinite(n)) return '';
  if (n >= 10) return String(Math.round(n));
  let r = Math.round(n * 4) / 4;
  if (r === 0 && n > 0) r = 0.25;
  const w = Math.floor(r);
  const fr = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[r - w] || '';
  return (w ? String(w) : (fr ? '' : '0')) + fr;
}
function roundW(x) { return x < 10 ? Math.round(x) : x < 100 ? Math.round(x / 5) * 5 : Math.round(x / 10) * 10; }

/** Amount for the recipe view. */
function fmtQty(q, unit) {
  const u = String(unit || '').toLowerCase();
  if (q === '' || q == null || isNaN(q)) return u && u !== 'pc' ? u : '';
  q = Number(q);
  if (u === 'g' || u === 'kg') { const g = u === 'kg' ? q * 1000 : q; return g >= 1000 ? Math.round(g / 100) / 10 + ' kg' : roundW(g) + ' g'; }
  if (u === 'ml' || u === 'l') { const m = u === 'l' ? q * 1000 : q; return m >= 1000 ? Math.round(m / 100) / 10 + ' l' : roundW(m) + ' ml'; }
  if (u === 'tsp' || u === 'tbsp') { const t = u === 'tbsp' ? q * 3 : q; return t >= 3 ? fmtNum(t / 3) + ' tbsp' : fmtNum(t) + ' tsp'; }
  // Things you count are rounded up to whole ones (3½ cloves → 4); under one stays as ½.
  if (['', 'pc', 'clove', 'tin', 'slice'].indexOf(u) >= 0 && q > 1) q = Math.ceil(q - 0.05);
  else if (u !== 'pinch') q = Math.max(0.5, Math.round(q * 2) / 2); // nobody uses 1¾ eggs
  if (!u || u === 'pc') return fmtNum(q);
  return fmtNum(q) + ' ' + (q > 1 ? (PLURAL[u] || u) : u);
}

/** Amount for the shopping list: countable things are rounded up. */
function fmtShop(v, base) {
  if (!v) return '';
  if (UNITS[base] && base !== 'tsp') return fmtQty(v, base);
  if (base === 'tsp') return fmtQty(v, 'tsp');
  const n = Math.ceil(v - 0.01);
  if (base === 'slice') { const l = Math.ceil(n / SLICES_PER_LOAF); return l + (l > 1 ? ' loaves' : ' loaf') + ' (' + n + ' slices)'; }
  if (base === 'pc' || !base) return String(n);
  return n + ' ' + (n > 1 ? (PLURAL[base] || base) : base);
}

/** Adds up ingredients across planned meals, matching names through the Items list. */
function aggregate(entries) {
  const items = itemMap();
  const by = {};
  entries.forEach(({ r, portions }) => {
    const f = portions / (num(r.servings, 0) || portions || 1);
    (r.ingredients || []).forEach(ing => {
      const it = items[ing.item_id] || findItem(ing.item);
      const key = it ? it.id : 'n:' + normKey(ing.item);
      const row = by[key] || (by[key] = {
        item_id: it ? it.id : '', name: it ? it.name : ing.item, aisle: it ? it.aisle : 'Other',
        staple: it ? yes(it.staple) : false, each: it ? num(it.each_g, 0) : 0, parts: {}, recipes: [],
      });
      if (row.recipes.indexOf(r.title) < 0) row.recipes.push(r.title);
      const u = String(ing.unit || '').toLowerCase();
      const [base, mult] = UNITS[u] || [u || 'pc', 1];
      row.parts[base] = (row.parts[base] || 0) + (ing.qty === '' || ing.qty == null ? 0 : Number(ing.qty) * mult * f);
    });
  });
  return Object.values(by).map(row => ({
    item_id: row.item_id, name: row.name, aisle: row.aisle || 'Other', unit: '', staple: row.staple,
    qty: shopQty(row.parts, row.each), note: row.recipes.join(', '),
  }));
}

/** Turns amounts in mixed units into one figure for the shop, e.g. 2 onions + 300 g onion → "4 (≈600 g)". */
function shopQty(parts, each) {
  const p = Object.assign({}, parts);
  Object.keys(p).forEach(k => { if (!p[k]) delete p[k]; });
  if (p.g && p.ml) { p.g += p.ml; delete p.ml; } // near enough for shopping
  const wt = p.g ? 'g' : p.ml ? 'ml' : '';
  if (wt && p.tsp) { p[wt] += p.tsp * 5; delete p.tsp; } // a spoonful next to 300 g hardly matters
  const out = [];
  if (each && (p.pc || p.g)) {
    const g = (p.g || 0) + (p.pc || 0) * each;
    const n = Math.max(1, Math.ceil(g / each - 0.15));
    out.push(!p.pc ? fmtQty(g, 'g') + ' (~' + n + ')' : p.g ? n + ' (≈' + fmtQty(g, 'g') + ')' : String(n));
    delete p.g; delete p.pc;
  }
  return out.concat(Object.keys(p).map(b => fmtShop(p[b], b))).filter(Boolean).join(' + ');
}

// ------------------------------------------------ nutrition, cost, health ---

const NUTR = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satfat', 'fibre', 'salt'];
// Store-cupboard extras that recipes (Gousto especially) leave unmeasured: assumed grams per portion.
// Added salt is left out altogether: it's to taste, so only salt inside other ingredients (stock, cheese, sauces) counts.
const ASSUMED_G = { butter: 5, 'caster sugar': 2, 'brown sugar': 2, 'plain flour': 5, 'semi-skimmed milk': 20, milk: 20 };
const OIL_G = 5; // a teaspoon of oil per portion
// Groups that hardly change the totals; a recipe still counts as measured without their amounts.
const MINOR_GROUPS = ['herb_spice', 'sauce', 'fat_oil', 'drink', 'other'];

/** Grams of one recipe line, or null when it has no usable amount. */
function gramsOf(ing, it) {
  const q = Number(ing.qty);
  if (ing.qty === '' || ing.qty == null || !isFinite(q)) return null;
  const ml = num(it && it.ml_g, 1) || 1;
  const each = num(it && it.each_g, 0);
  switch (String(ing.unit || '').toLowerCase()) {
    case 'g': return q;
    case 'kg': return q * 1000;
    case 'ml': return q * ml;
    case 'l': return q * 1000 * ml;
    case 'tsp': return q * 5 * ml;
    case 'tbsp': return q * 15 * ml;
    case 'pinch': return q * 0.4;
    case 'tin': return q * (each >= 150 ? each : 400);
    case 'pack': return (num(it && it.price_g, 0) || each) * q || null;
    case 'bunch': return q * 30;
    default: return each ? q * each : null; // pc, clove, slice or no unit
  }
}

/** Grams for nutrition: the measured amount, or a small assumed amount for unmeasured oil, butter, salt… */
function usedGrams(ing, it, per) {
  const g = gramsOf(ing, it);
  if (g != null) return { g, assumed: false };
  const a = it.group === 'fat_oil' ? OIL_G : ASSUMED_G[it.name] || 0;
  return { g: a * per, assumed: a > 0 };
}

/** Per-portion nutrition, cost and food-group grams for a recipe, from the Items reference data. */
function recipeFacts(r) {
  const items = itemMap();
  const per = num(r.servings, 0) || 4;
  const n = {};
  NUTR.forEach(k => { n[k] = 0; });
  const groups = {};
  let cost = 0, weight = 0, counted = 0, priced = 0, sweetSugar = 0, gl = 0;
  const missing = [], assumed = [], unmeasured = [];
  let main = 0;
  (r.ingredients || []).forEach(ing => {
    const it = items[ing.item_id] || findItem(ing.item);
    if (!it || !it.group) { missing.push(ing.item); return; }
    if (it.name === 'salt') return;
    const isMain = MINOR_GROUPS.indexOf(it.group) < 0;
    if (isMain) main++;
    const { g, assumed: est } = usedGrams(ing, it, per);
    if (!g) { if (isMain) unmeasured.push(ing.item); return; } // "to taste" herbs, pepper…
    if (est) assumed.push(it.name);
    counted++;
    weight += g;
    groups[it.group] = (groups[it.group] || 0) + g;
    NUTR.forEach(k => { n[k] += num(it[k], 0) * g / 100; });
    if (it.group === 'sweet') sweetSugar += num(it.sugar, 0) * g / 100; // free sugars, not fruit/veg/milk sugar
    // Glycemic load = GI × digestible carbs / 100 (UK carbs already exclude fibre). Items without a GI barely have carbs.
    gl += num(it.gi, 30) * num(it.carbs, 0) * g / 100 / 100; // no GI = low-carb veg/dairy, assume a low 30
    if (num(it.price, 0) && num(it.price_g, 0)) { cost += it.price / it.price_g * g; priced++; }
  });
  NUTR.forEach(k => { n[k] /= per; });
  Object.keys(groups).forEach(k => { groups[k] /= per; });
  return { n, groups, cost: cost / per, weight: weight / per, sweetSugar: sweetSugar / per, gl: gl / per, counted, priced, missing, assumed, unmeasured, main, lines: (r.ingredients || []).length };
}

/** Health score 0–10: points for veg, oily fish, protein, fibre and a low glycemic load; minus for saturated fat, added sugar, a high glycemic load and processed meat. */
function healthScore(f) {
  const g = k => f.groups[k] || 0;
  const reasons = [];
  let s = 4;
  const add = (pts, text) => { s += pts; reasons.push({ pts, text }); };
  const five = (g('veg') + g('fruit') + Math.min(g('legume'), 80)) / 80;
  if (five >= 1) add(Math.min(3, Math.floor(five)), `${fmtNum(five)} of your 5-a-day`);
  if (g('oily_fish') >= 60) add(2, 'oily fish');
  if (f.n.protein >= 25) add(1, 'good protein');
  if (f.n.fibre >= 8) add(1, 'high fibre');
  // Glycemic load per portion: library median 34; a day under ~80 counts as low, over ~120 as high.
  if (f.gl < 20) add(1, 'low glycemic load'); else if (f.gl > 60) add(-2, 'very high glycemic load'); else if (f.gl > 45) add(-1, 'high glycemic load');
  if (f.n.satfat > 10) add(-2, 'very high saturated fat'); else if (f.n.satfat > 6) add(-1, 'high saturated fat');
  if (f.sweetSugar > 20) add(-2, 'lots of added sugar'); else if (f.sweetSugar > 10) add(-1, 'added sugar');
  if (g('processed_meat') >= 30) add(-1, 'processed meat');
  s = Math.max(0, Math.min(10, s));
  const label = s >= 8 ? 'Very healthy' : s >= 6 ? 'Healthy' : s >= 4 ? 'Balanced' : s >= 2 ? 'Indulgent' : 'A treat';
  return { score: s, label, reasons };
}

/** UK front-of-pack colours: per 100 g, or red when one portion is over 30 % of the daily reference intake. */
function trafficLight(k, perPortion, weight) {
  const T = { fat: [3, 17.5, 21], satfat: [1.5, 5, 6], sugar: [5, 22.5, 27], salt: [0.3, 1.5, 1.8] }[k];
  if (!T || !weight) return '';
  const p100 = perPortion / weight * 100;
  return p100 > T[1] || perPortion > T[2] ? 'red' : p100 > T[0] ? 'amber' : 'green';
}

/** Score and cost for lists, cached until the recipes or items change. */
let quickCache = { recipes: null, items: null, m: new Map() };
function quickFacts(r) {
  if (quickCache.recipes !== D.recipes || quickCache.items !== D.items) quickCache = { recipes: D.recipes, items: D.items, m: new Map() };
  if (!quickCache.m.has(r.id)) {
    const f = recipeFacts(r);
    const ok = f.counted && f.unmeasured.length <= Math.max(1, f.main * 0.25);
    quickCache.m.set(r.id, ok ? { score: healthScore(f).score, cost: f.priced ? f.cost : null } : null);
  }
  return quickCache.m.get(r.id);
}

function factsPanel(r) {
  const f = recipeFacts(r);
  if (!f.counted) return '';
  if (f.unmeasured.length > Math.max(1, f.main * 0.25)) {
    return `<p class="facts-missing">Nutrition and price need amounts for ${esc(f.unmeasured.slice(0, 6).join(', '))}${f.unmeasured.length > 6 ? '…' : ''} – <a href="#/edit/${r.id}">add them</a>.</p>`;
  }
  const h = healthScore(f);
  const row = (label, k, unit) => {
    const v = f.n[k];
    const tl = trafficLight(k, v, f.weight);
    return `<div class="nrow"><span>${tl ? `<i class="tl ${tl}"></i>` : ''}${label}</span><b>${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${unit}</b></div>`;
  };
  return `<details class="facts">
    <summary><span class="hs"><b>${h.score}</b>/10 · ${h.label}</span><span>${Math.round(f.n.kcal)} kcal</span>${f.priced ? `<span>≈ £${f.cost.toFixed(2)}</span>` : ''}<span class="more">per portion</span></summary>
    <div class="facts-body">
      <div class="reasons">${h.reasons.map(x => `<span class="${x.pts > 0 ? 'plus' : 'minus'}">${x.pts > 0 ? '+' : '−'}${Math.abs(x.pts)} ${esc(x.text)}</span>`).join('') || '<span class="muted">nothing stands out either way</span>'}</div>
      <div class="ngrid">${row('Energy', 'kcal', ' kcal')}${row('Protein', 'protein', ' g')}${row('Carbs', 'carbs', ' g')}${row('of which sugars', 'sugar', ' g')}
        ${row('Fat', 'fat', ' g')}${row('of which saturates', 'satfat', ' g')}${row('Fibre', 'fibre', ' g')}${row('Salt', 'salt', ' g')}
        <div class="nrow"><span>Glycemic load</span><b>${Math.round(f.gl)}</b></div></div>
      <p class="muted small">Rough figures from typical values for each ingredient, not counting salt added to taste${f.assumed.length ? ', including a little ' + esc([...new Set(f.assumed)].join(', ')) + ' where the recipe gives no amount' : ''}.
        ${f.missing.concat(f.unmeasured).length ? `Not counted: ${esc(f.missing.concat(f.unmeasured).join(', '))}.` : ''} Prices are ballpark Aldi prices for the amount used.</p>
    </div></details>`;
}

function swapHint(r, ing, n) {
  const it = itemMap()[ing.item_id] || findItem(ing.item);
  if (!it || !it.swap) return '';
  const key = r.id + ':' + n;
  return ` <button class="swap" data-act="swapHint" data-k="${key}">swap?</button>${UI.swaps[key] ? `<span class="swaptext">${esc(it.swap)}</span>` : ''}`;
}

// -------------------------------------------------------------- plan ---

function weekEntries(week) {
  return D.plan.filter(p => p.week === week).sort((a, b) => num(a.order, 0) - num(b.order, 0));
}

async function savePlan(week, entries) {
  entries.forEach((e, i) => { e.week = week; e.order = i; if (!e.id) e.id = Math.random().toString(36).slice(2, 10); });
  D.plan = D.plan.filter(p => p.week !== week).concat(entries);
  saveCache();
  render();
  const rows = await run('planSave', { week, entries });
  if (rows) { D.plan = D.plan.filter(p => p.week !== week).concat(rows); saveCache(); }
}

function planEntry(r, kind, portions) {
  return { recipe_id: r ? r.id : '', title: r ? r.title : '', portions: portions || defPortions(), kind: kind || 'dinner', done: false };
}

/** Suggests n dinners: staples, forgotten favourites and something never cooked, avoiding repeats. */
function suggest(n, exclude) {
  const st = stats();
  const week = weekEntries(UI.week);
  const used = new Set(week.map(e => e.recipe_id).concat(exclude || []));
  const proteins = week.filter(e => kindOf(e) === 'dinner').map(e => (recipe(e.recipe_id) || {}).protein).filter(Boolean);
  const candidates = activeRecipes().filter(r => groupOf(r.type) === 'dinner' && !used.has(r.id))
    .filter(r => !(st[r.id] && st[r.id].n && st[r.id].avg <= 2) && num(r.spice, 0) < 3);
  let pool = candidates.filter(r => !st[r.id] || daysSince(st[r.id].last) >= 14);
  // Small collection: allow recently cooked ones rather than leaving gaps.
  if (pool.length < n) pool = pool.concat(candidates.filter(r => pool.indexOf(r) < 0).sort((a, b) => daysSince(st[b.id].last) - daysSince(st[a.id].last)));
  const buckets = {
    staple: r => st[r.id] && st[r.id].count >= 3 && st[r.id].avg >= 4,
    fav: r => st[r.id] && st[r.id].avg >= 4 && daysSince(st[r.id].last) >= 42,
    fresh: r => !st[r.id],
    any: () => true,
  };
  const pattern = ['staple', 'fav', 'fresh', 'staple', 'any', 'fav', 'fresh'];
  const picks = [];
  for (let i = 0; i < n; i++) {
    const avail = pool.filter(r => picks.indexOf(r) < 0);
    if (!avail.length) break;
    let cands = avail.filter(buckets[pattern[i % pattern.length]]);
    if (!cands.length) cands = avail;
    const varied = cands.filter(r => proteins.indexOf(r.protein) < 0);
    if (varied.length) cands = varied;
    // weighted random: better rated recipes come up more often
    const w = cands.map(r => 1 + (st[r.id] && st[r.id].avg ? st[r.id].avg : 3));
    let x = Math.random() * w.reduce((a, b) => a + b, 0);
    let pick = cands[0];
    for (let j = 0; j < cands.length; j++) { x -= w[j]; if (x <= 0) { pick = cands[j]; break; } }
    picks.push(pick);
    if (pick.protein) proteins.push(pick.protein);
  }
  return picks;
}

function groceryEntry(item, qty) {
  return { recipe_id: '', item_id: item.id, title: item.name, qty: qty || '', portions: '', kind: 'item', done: false };
}

/** Rows for this week's groceries: weekly basics (unless skipped) plus anything added in the Week tab. */
function groceryRows(week) {
  const entries = weekEntries(week);
  const skip = new Set(entries.filter(e => e.kind === 'skip').map(e => e.item_id));
  const rows = D.items.filter(i => yes(i.weekly) && !skip.has(i.id))
    .map(i => ({ item_id: i.id, name: i.name, aisle: i.aisle, qty: i.default_qty || '', unit: '', note: '', source: 'basic', status: yes(i.staple) ? 'check' : '' }));
  entries.filter(e => e.kind === 'item').forEach(e => {
    const it = D.items.find(i => i.id === e.item_id) || {};
    const have = rows.find(r => r.item_id === e.item_id);
    if (have) have.qty = [have.qty, e.qty].filter(Boolean).join(' + ');
    else rows.push({ item_id: e.item_id, name: it.name || e.title, aisle: it.aisle || 'Other', qty: e.qty || '', unit: '', note: '', source: 'basic', status: '' });
  });
  return rows;
}

async function buildList() {
  const entries = weekEntries(UI.week).filter(e => recipe(e.recipe_id)).map(e => ({ r: recipe(e.recipe_id), portions: num(e.portions, defPortions()) }));
  // Store-cupboard staples are asked about ("check you have") rather than assumed.
  const rows = aggregate(entries).map(r => Object.assign(r, { source: 'recipe', status: r.staple ? 'check' : '' }));
  rows.forEach(r => { delete r.staple; });
  const onList = new Set(D.list.filter(l => !yes(l.checked) && l.source === 'manual').map(l => l.item_id));
  groceryRows(UI.week).forEach(g => {
    if (onList.has(g.item_id)) return;
    const r = rows.find(x => x.item_id === g.item_id);
    if (!r) rows.push(g);
    else if (g.qty) Object.assign(r, { qty: [r.qty, g.qty].filter(Boolean).join(' + '), status: g.status });
  });
  const list = await run('listBuild', { rows });
  if (!list) return;
  D.list = list;
  saveCache();
  toast('Shopping list ready – ' + list.filter(l => !yes(l.checked)).length + ' items');
  location.hash = '#/list';
}

// ------------------------------------------------------------- views ---

const VIEWS = {};

VIEWS.week = () => {
  const wk = UI.week;
  const entries = weekEntries(wk);
  const meals = k => entries.filter(e => kindOf(e) === k);
  const dinners = meals('dinner');
  const target = num(S().dinners_per_week, 4);
  const thisWeek = wk === weekOf(new Date());
  return demoBanner() + `
    <div class="row">
      <button class="ghost" data-act="weekMove" data-n="-7" aria-label="Previous week">‹</button>
      <div class="grow weekhead"><b>${thisWeek ? 'This week' : 'Week of ' + nice(wk, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
        <div class="muted small">${nice(wk)} – ${nice(addDays(wk, 6))}</div></div>
      <button class="ghost" data-act="weekMove" data-n="7" aria-label="Next week">›</button>
    </div>
    <h2>Dinners <span class="muted small">${dinners.length}/${target}</span></h2>
    ${weekHealth(dinners)}
    <div class="stack">${dinners.map(mealCard).join('') || '<div class="empty">Nothing planned yet.</div>'}</div>
    ${wishRow(entries)}
    <div class="row" style="margin-top:12px">
      ${dinners.length < target ? '<button class="primary" data-act="suggestWeek">✨ Suggest ' + (target - dinners.length) + '</button>' : ''}
      <button data-act="openPicker" data-kind="dinner">＋ Add</button>
      <button data-act="openClassics" data-kind="dinner">🎓 Classics</button>
    </div>
    <h2>Baking</h2>
    <div class="stack">${meals('baking').map(mealCard).join('') || '<p class="muted small">Cakes, bread, biscuits, puddings…</p>'}</div>
    <div class="row" style="margin-top:12px"><button data-act="openPicker" data-kind="baking">＋ Add baking</button>
      <button data-act="openClassics" data-kind="baking">🎓 Classics</button></div>
    <h2>Other meals</h2>
    <div class="stack">${meals('other').map(mealCard).join('') || '<p class="muted small">Breakfasts, lunches, sides…</p>'}</div>
    <div class="row" style="margin-top:12px"><button data-act="openPicker" data-kind="other">＋ Add a meal</button></div>
    ${groceriesSection(entries)}
    <hr>
    <button class="primary" style="width:100%" data-act="buildList" ${entries.length || D.items.some(i => yes(i.weekly)) ? '' : 'disabled'}>🛒 Make shopping list</button>
    <p class="muted small" style="text-align:center">Adds up every ingredient plus the groceries. Store-cupboard things are asked about, and you can tick off anything you already have.</p>`;
};

/** Things to buy that are not part of a recipe: weekly basics plus anything else this week. */
function groceriesSection(entries) {
  const skip = new Set(entries.filter(e => e.kind === 'skip').map(e => e.item_id));
  const extra = entries.filter(e => e.kind === 'item');
  const basics = D.items.filter(i => yes(i.weekly)).sort((a, b) => a.name.localeCompare(b.name));
  return `<h2>Groceries <span class="muted small">no recipe needed</span></h2>
    <div class="search"><input id="gq" data-in="grocSearch" placeholder="Add anything… e.g. “sugar”, “2 ready desserts”" autocomplete="off" enterkeyhint="done"><div id="gsugg"></div></div>
    <div class="chips wrap">${extra.map(e => `<button class="chip on" data-act="unplan" data-id="${e.id}" title="Remove">${esc((e.qty ? e.qty + ' ' : '') + e.title)} ✕</button>`).join('')}</div>
    ${basics.length ? `<div class="basics">
      <button class="basics-head" data-act="toggleBasics" aria-expanded="${UI.basicsOpen}">
        <span class="grow">Weekly basics</span>
        <span class="muted small">${basics.filter(i => !skip.has(i.id)).length} of ${basics.length} on the list</span>
        <span class="chev">${UI.basicsOpen ? '−' : '+'}</span>
      </button>
      ${UI.basicsOpen ? `<p class="muted small" style="margin:8px 0 4px">Untick anything you don't need this week.</p>
      <div class="basics-list">${basics.map(i => `<label class="basic-row ${skip.has(i.id) ? 'off' : ''}">
        <input type="checkbox" data-act="grocSkip" data-id="${i.id}" ${skip.has(i.id) ? '' : 'checked'}>
        <span class="grow">${esc(i.name)}</span>${i.default_qty ? `<span class="muted small">${esc(i.default_qty)}</span>` : ''}</label>`).join('')}</div>` : ''}
    </div>` : ''}`;
}

/** Wishlist recipes not planned this week, one tap to add. */
function wishRow(entries) {
  const planned = new Set(entries.map(e => e.recipe_id));
  const wished = activeRecipes().filter(r => r.wish && !planned.has(r.id));
  if (!wished.length) {
    return `<div class="wishrow"><span class="muted small">♡ Wishlist – ${activeRecipes().some(r => r.wish) ? 'everything on it is already planned this week' : 'tap “♡ Save for later” on any recipe to keep ideas here'}.</span></div>`;
  }
  return `<div class="wishrow"><span class="muted small">♡ From your wishlist</span>
    <div class="chips wrap">${wished.map(r => `<button class="chip" data-act="wishAdd" data-id="${r.id}">＋ ${esc(r.title)}${r.wish !== 'soon' ? ` <span class="muted">· ${esc(r.wish)}</span>` : ''}</button>`).join('')}</div></div>`;
}

async function setWish(r, wish) {
  r.wish = wish;
  saveCache();
  render();
  await run('recipeWish', { id: r.id, wish });
}

// Weekly dinner health. Past weeks average 5.5; 7+ counts as a healthy week (only ~1 in 10 past weeks got there).
const WEEK_GOOD = 7, WEEK_LOW = 5, DINNER_LOW = 4;

function weekHealth(dinners) {
  const scored = dinners.map(e => ({ e, r: recipe(e.recipe_id) })).filter(x => x.r)
    .map(x => Object.assign(x, { q: quickFacts(x.r) })).filter(x => x.q);
  if (scored.length < 2) return '';
  const avg = scored.reduce((t, x) => t + x.q.score, 0) / scored.length;
  const allLow = scored.every(x => x.q.score <= DINNER_LOW);
  const worst = scored.slice().sort((a, b) => a.q.score - b.q.score)[0];
  const level = avg >= WEEK_GOOD && !allLow ? 'good' : avg >= WEEK_LOW && !allLow ? 'warn' : 'bad';
  const text = { good: 'Healthy week', warn: 'Could be healthier', bad: 'Unhealthy week' }[level];
  return `<div class="weekhealth ${level}"><span><b>${String(Math.round(avg * 10) / 10)}</b>/10 · ${text}</span>
    ${level === 'good' ? '' : `<span class="small">Aim for ${WEEK_GOOD}+ – try swapping <a href="#/r/${worst.r.id}">${esc(worst.r.title)}</a> (${worst.q.score}/10) for something lighter.</span>`}</div>`;
}

function mealCard(e) {
  const r = recipe(e.recipe_id);
  const logged = yes(e.done);
  return `<div class="card meal ${logged ? 'done' : ''}">
    ${r ? `<a href="#/r/${r.id}?p=${esc(e.portions)}">${thumb(r)}</a>` : '<div class="thumb">📝</div>'}
    <div class="grow">
      <div class="title">${r ? `<a href="#/r/${r.id}?p=${esc(e.portions)}" style="color:inherit">${esc(r.title)}</a>` : esc(e.title)}</div>
      ${(q => q ? `<div class="qf">${q.score}/10${q.cost != null ? ` · £${q.cost.toFixed(2)} pp` : ''}</div>` : '')(r && quickFacts(r))}
      <div class="row small" style="margin-top:6px;gap:6px">
        <span class="stepper"><button data-act="portions" data-id="${e.id}" data-n="-1">−</button><span>${esc(e.portions)}</span><button data-act="portions" data-id="${e.id}" data-n="1">+</button></span>
        <span class="muted">portions</span>
      </div>
      <div class="row" style="margin-top:6px;gap:4px">
        ${logged ? '<span class="badge good">eaten ✓</span>' : `<button class="small" data-act="ateIt" data-id="${e.id}">Ate it ★</button>`}
        ${r && kindOf(e) === 'dinner' && !logged ? `<button class="ghost small" data-act="swap" data-id="${e.id}" title="Swap for another suggestion">↻ swap</button>` : ''}
        <button class="ghost small" data-act="unplan" data-id="${e.id}" aria-label="Remove">✕</button>
      </div>
    </div>
  </div>`;
}

VIEWS.list = () => {
  const open = D.list.filter(l => !yes(l.checked));
  const ask = open.filter(l => l.status === 'check');
  const home = open.filter(l => l.status === 'home');
  const need = open.filter(l => !l.status);
  const done = D.list.filter(l => yes(l.checked));
  const groups = {};
  need.forEach(l => { (groups[l.aisle || 'Other'] = groups[l.aisle || 'Other'] || []).push(l); });
  const aisles = Object.keys(groups).sort((a, b) => aisleIdx(a) - aisleIdx(b));
  return demoBanner() + `
    <div class="search" id="lsearch">
      <input id="lq" data-in="listSearch" placeholder="Add item… e.g. “2 milk”" autocomplete="off" enterkeyhint="done">
      <div id="lsugg"></div>
    </div>
    ${ask.length ? `<div class="card pantry" style="margin-top:14px">
      <b>Check you have</b> <span class="muted small">store-cupboard things this week's recipes use</span>
      ${ask.map(l => `<div class="li"><div class="name">${esc(l.name)}<span class="note">${esc([l.qty, l.note].filter(Boolean).join(' · '))}</span></div>
        <button class="small" data-act="setStatus" data-id="${l.id}" data-s="">Need</button>
        <button class="ghost small" data-act="setStatus" data-id="${l.id}" data-s="home">Got ✓</button></div>`).join('')}
      <div class="row end" style="margin-top:6px"><button class="ghost small" data-act="allHome">Got all of these</button></div>
    </div>` : ''}
    ${need.length && !done.length ? '<p class="muted small" style="margin-bottom:0">Before you go: tap 🏠 on anything you already have at home.</p>' : ''}
    ${aisles.map(a => `<div class="aisle"><h3>${esc(a)}</h3>${groups[a].sort((x, y) => x.name.localeCompare(y.name)).map(listRow).join('')}</div>`).join('') ||
      (ask.length ? '' : '<div class="empty">The list is empty.<br>Plan the week and tap “Make shopping list”, or add items above.</div>')}
    ${home.length ? `<div class="aisle"><div class="row"><h3 class="grow" style="margin:0">🏠 Already at home (${home.length})</h3>
      <button class="ghost small" data-act="toggleHome">${UI.showHome ? 'hide' : 'show'}</button></div>
      ${UI.showHome ? home.map(l => `<div class="li"><span class="name">${esc(l.name)}<span class="note">${esc(l.qty)}</span></span>
        <button class="ghost small" data-act="setStatus" data-id="${l.id}" data-s="">need it after all</button></div>`).join('') : ''}</div>` : ''}
    ${done.length ? `<div class="aisle"><div class="row"><h3 class="grow" style="margin:0">In the trolley (${done.length})</h3>
      <button class="ghost small" data-act="toggleTrolley">${UI.showTrolley ? 'hide' : 'show'}</button>
      <button class="ghost small" data-act="clearChecked">clear</button></div>
      ${UI.showTrolley ? done.map(listRow).join('') : ''}</div>` : ''}
    <hr>
    <div class="row">
      <button data-act="openBasics">📋 Weekly basics</button>
      <button data-act="emailList" ${need.length ? '' : 'disabled'}>✉️ Email list</button>
      <a class="btn" href="#/items">Items</a>
    </div>`;
};

/** Swap hint under a list row, for deciding in the shop when the item isn't there. */
function listSwap(l) {
  const it = D.items.find(i => i.id === l.item_id);
  return it && it.swap && !yes(l.checked) ? `<span class="swapnote">If not in stock: ${esc(it.swap)}</span>` : '';
}

function listRow(l) {
  return `<div class="li ${yes(l.checked) ? 'checked' : ''}">
    <input type="checkbox" data-act="tick" data-id="${l.id}" ${yes(l.checked) ? 'checked' : ''} aria-label="Got it">
    <div class="name" data-act="tick" data-id="${l.id}">${esc(l.name)}${l.note ? `<span class="note">${esc(l.note)}</span>` : ''}${listSwap(l)}</div>
    <span class="qty">${esc([l.qty, l.unit].filter(Boolean).join(' '))}</span>
    ${yes(l.checked) ? '' : `<button class="ghost small" data-act="setStatus" data-id="${l.id}" data-s="home" aria-label="Already have it" title="Already have it">🏠</button>`}
    <button class="ghost small" data-act="editRow" data-id="${l.id}" aria-label="Edit">⋯</button>
  </div>`;
}

VIEWS.recipes = () => {
  const filters = [['all', 'All'], ['wish', '♡ Wishlist']].concat(GROUPS, [
    ['staple', '⭐ Staples'], ['lately', '⏳ Not lately'], ['new', '🆕 Never cooked'], ['never', '🚫 Never again']]);
  const sorts = [['recent', 'Recently cooked'], ['most', 'Most cooked'], ['rating', 'Top rated'], ['healthy', 'Healthiest'], ['cheap', 'Cheapest'], ['az', 'A–Z'], ['added', 'Newest']];
  return demoBanner() + `
    <div class="row"><div class="search grow"><input data-in="recipeSearch" value="${esc(UI.rq)}" placeholder="Search recipes or ingredients"></div>
      <a class="btn primary" href="#/add">＋ Add</a></div>
    <div class="chips">${filters.map(([k, l]) => `<button class="chip ${UI.rFilter === k ? 'on' : ''}" data-act="rFilter" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="row small"><span class="muted">Sort</span><select data-ch="rSort" style="width:auto;min-height:36px;padding:4px 8px">
      ${sorts.map(([k, l]) => `<option value="${k}" ${UI.rSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div id="rresults" style="margin-top:10px">${recipeResults()}</div>`;
};

function recipeResults() {
  const st = stats();
  const q = normKey(UI.rq);
  const f = UI.rFilter;
  let list = activeRecipes().filter(r => {
    const s = st[r.id];
    if (q && !normKey(r.title + ' ' + (r.tags || '') + ' ' + (r.ingredients || []).map(i => i.item).join(' ')).includes(q)) return false;
    if (GROUPS.some(g => g[0] === f)) return groupOf(r.type) === f;
    if (f === 'wish') return !!r.wish;
    if (f === 'staple') return s && s.count >= 3 && s.avg >= 4;
    if (f === 'lately') return s && s.avg >= 4 && daysSince(s.last) >= 42;
    if (f === 'new') return !s;
    if (f === 'never') return s && s.n && s.avg <= 2;
    return !(s && s.n && s.avg <= 2);
  });
  const g = (r, k) => (st[r.id] || {})[k] || 0;
  const sorters = {
    recent: (a, b) => String(g(b, 'last') || '').localeCompare(String(g(a, 'last') || '')),
    most: (a, b) => g(b, 'count') - g(a, 'count'),
    rating: (a, b) => g(b, 'avg') - g(a, 'avg'),
    az: (a, b) => a.title.localeCompare(b.title),
    added: (a, b) => String(b.created || '').localeCompare(String(a.created || '')),
    healthy: (a, b) => ((quickFacts(b) || {}).score ?? -1) - ((quickFacts(a) || {}).score ?? -1),
    cheap: (a, b) => ((quickFacts(a) || {}).cost ?? 99) - ((quickFacts(b) || {}).cost ?? 99),
  };
  list = list.sort(sorters[UI.rSort] || sorters.recent);
  if (!list.length) return '<div class="empty">No recipes here yet.</div>';
  return '<div class="grid">' + list.map(r => {
    const s = st[r.id];
    return `<a class="rcard" href="#/r/${r.id}">
      ${r.image ? `<div class="img" style="background-image:url('${esc(r.image)}')"></div>` : `<div class="img">${emoji(r)}</div>`}
      <div class="body">${source(r).name ? `<div class="src">${r.wish ? '♥ ' : ''}${esc(source(r).name)}</div>` : r.wish ? '<div class="src">♥</div>' : ''}<div class="t">${esc(r.title)}</div>
        <div class="small">${s && s.n ? stars(s.avg) : ''} ${verdict(s)}</div>
        <div class="muted small">${s ? `${s.count}× · ${ago(s.last)}` : 'not cooked yet'}</div>
        ${(q => q ? `<div class="qf">${q.score}/10${q.cost != null ? ` · £${q.cost.toFixed(2)}` : ''}</div>` : '')(quickFacts(r))}</div></a>`;
  }).join('') + '</div>';
}

// Who the recipe is from: an author or a site, shown as a byline. Archived copies keep the original name.
function source(r) {
  const raw = String(r.source_name || '').trim();
  const archived = /\(archived copy\)/i.test(raw) || /web\.archive\.org/.test(r.source_url || '');
  const name = raw.replace(/\s*\(archived copy\)\s*/i, '');
  return { name: name === 'Home recipe' ? 'Our kitchen' : name, archived };
}

function byline(r) {
  const s = source(r);
  if (!s.name && !r.source_url) return '';
  const name = esc(s.name || 'Original recipe');
  return `<div class="byline">${s.name === 'Our kitchen' ? 'From' : 'Recipe by'}
    ${r.source_url ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">${name} ↗</a>` : `<b>${name}</b>`}
    ${s.archived ? '<span class="muted">· archived copy</span>' : ''}</div>`;
}

VIEWS.r = rt => {
  const r = recipe(rt.id);
  if (!r) return '<div class="empty">Recipe not found.</div>';
  const st = stats()[r.id];
  const base = num(r.servings, 4);
  const p = UI.portions[r.id] || num(rt.q.get('p'), 0) || defPortions();
  UI.portions[r.id] = p;
  const f = p / base;
  const got = UI.got[r.id] || {};
  const cur = UI.step[r.id];
  return `
    ${r.image ? `<img class="hero" src="${esc(r.image)}" alt="">` : ''}
    <h1>${esc(r.title)}</h1>
    <div class="row small">${st && st.n ? stars(st.avg) + `<span class="muted">${st.avg.toFixed(1)}</span>` : ''} ${verdict(st)}
      <span class="muted">${st ? `cooked ${st.count}× · last ${nice(st.last, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'not cooked yet'}</span></div>
    ${byline(r)}
    <div class="row small muted" style="margin-top:4px">${r.time_mins ? '⏱ ' + esc(r.time_mins) + ' min' : ''} ${chillies(r)}</div>
    <div>${String(r.tags || '').split(',').filter(t => t.trim()).map(t => `<span class="tag">${esc(t.trim())}</span>`).join('')}</div>
    ${r.description ? `<p class="muted">${esc(r.description)}</p>` : ''}
    ${factsPanel(r)}
    ${r.wish ? `<p class="wishline">♥ On your wishlist${r.wish !== 'soon' ? ' – ' + esc(r.wish) : ''}</p>` : ''}
    <div class="row" style="margin:12px 0">
      <button class="primary" data-act="addToWeek" data-id="${r.id}">＋ This week</button>
      <button data-act="rateRecipe" data-id="${r.id}">We ate this ★</button>
      <button data-act="wish" data-id="${r.id}">${r.wish ? '♥ On wishlist' : '♡ Save for later'}</button>
      <button data-act="wake">${UI.wake ? '🔆 Screen on' : '🔅 Keep screen on'}</button>
    </div>
    <div class="row"><h2 class="grow" style="margin:.8em 0 .3em">Ingredients</h2>
      <span class="stepper"><button data-act="rPortions" data-id="${r.id}" data-n="-1">−</button><span>${p}</span><button data-act="rPortions" data-id="${r.id}" data-n="1">+</button></span>
      <span class="muted small">portions</span></div>
    <ul class="ings">${(r.ingredients || []).map((i, n) => `<li class="${got[n] ? 'got' : ''}" data-act="gotIng" data-id="${r.id}" data-n="${n}">
      <span class="q">${esc(fmtQty(i.qty === '' ? '' : Number(i.qty) * f, i.unit))}</span><span>${esc(i.item)}${i.note ? ` <span class="muted">${esc(i.note)}</span>` : ''}${swapHint(r, i, n)}</span></li>`).join('')}</ul>
    <h2>Method</h2>
    <ol class="steps">${(r.steps || []).map((s, n) => `<li data-act="step" data-id="${r.id}" data-n="${n}" class="${cur === n ? 'cur' : cur > n ? 'past' : ''}">${esc(s)}</li>`).join('')}</ol>
    ${(r.tips || []).length ? `<div class="tips" style="margin-top:14px"><b>💡 Why it works</b><ul>${r.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${r.notes ? `<h2>Our notes</h2><p style="white-space:pre-wrap">${esc(r.notes)}</p>` : ''}
    <hr>
    <div class="row"><a class="btn" href="#/edit/${r.id}">✏️ Edit</a><button class="ghost" data-act="archive" data-id="${r.id}">Archive</button></div>`;
};

VIEWS.add = rt => {
  const tab = rt.q.get('tab') || 'link';
  const url = rt.q.get('url') || '';
  const text = rt.q.get('text') || '';
  const tabs = [['link', '🔗 Link'], ['text', '📝 Text'], ['photo', '📷 Photo'], ['manual', '✍️ Type it']];
  return `<h1>Add a recipe</h1>
    <div class="chips">${tabs.map(([k, l]) => `<a class="chip ${tab === k ? 'on' : ''}" href="#/add?tab=${k}">${l}</a>`).join('')}</div>
    <div class="stack" style="margin-top:8px">
    ${tab === 'link' ? `<p class="muted small">Gousto, BBC Good Food, any recipe blog or YouTube. For Instagram/TikTok, the caption is used – if it fails, copy the caption into the Text tab.</p>
      <input id="impUrl" type="url" placeholder="https://…" value="${esc(url)}">
      <button class="primary" data-act="importUrl">Import</button>` : ''}
    ${tab === 'text' ? `<p class="muted small">Paste anything: a reel caption, a YouTube description, a recipe from a message or email.</p>
      <textarea id="impText" placeholder="Paste the recipe here">${esc(text)}</textarea>
      <input id="impSrc" type="url" placeholder="Link to the original (optional)" value="${esc(url)}">
      <button class="primary" data-act="importText">Tidy it up</button>` : ''}
    ${tab === 'photo' ? `<p class="muted small">Photo of a cookbook page, a handwritten card or a screenshot of a reel.</p>
      <input id="impPhoto" type="file" accept="image/*">
      <button class="primary" data-act="importPhoto">Read the photo</button>` : ''}
    ${tab === 'manual' ? `<p class="muted small">Start with an empty recipe and fill it in.</p><button class="primary" data-act="manualRecipe">Start</button>` : ''}
    <div id="impStatus"></div></div>`;
};

VIEWS.edit = rt => {
  if (rt.id !== 'new') {
    const r = recipe(rt.id);
    if (!r) return '<div class="empty">Recipe not found.</div>';
    if (!UI.draft || UI.draft.id !== r.id) setDraft(JSON.parse(JSON.stringify(r)));
  }
  const d = UI.draft;
  if (!d) return '<div class="empty">Nothing to edit. <a href="#/add">Add a recipe</a></div>';
  const types = ['dinner', 'baking', 'dessert', 'breakfast', 'lunch', 'side', 'other'];
  const spice = [[0, 'none'], [1, '🌶 mild'], [2, '🌶🌶 medium'], [3, '🌶🌶🌶 hot']];
  const proteins = ['chicken', 'beef', 'pork', 'lamb', 'fish', 'seafood', 'veggie', 'vegan', 'mixed', 'none'];
  const units = ['', 'g', 'ml', 'tsp', 'tbsp', 'pc', 'clove', 'slice', 'tin', 'pack', 'bunch', 'pinch', 'kg', 'l'];
  const tags = Array.isArray(d.tags) ? d.tags.join(', ') : (d.tags || '');
  return `<h1>${d.id ? 'Edit recipe' : 'Check & save'}</h1>
    ${d.problem ? `<div class="card pantry"><b>Heads up:</b> ${esc(d.problem)}</div>` : ''}
    <div class="stack">
      <label class="field">Title<input data-in="draft" data-f="title" value="${esc(d.title)}"></label>
      <div>${d.image ? `<img src="${esc(d.image)}" alt="" style="border-radius:12px;max-height:220px;object-fit:cover;width:100%">` : ''}
        <div class="row" style="margin-top:6px"><input class="grow" data-in="draft" data-f="image" placeholder="Photo link" value="${esc(/^data:/.test(d.image || '') ? '(uploaded photo)' : d.image)}" style="width:auto">
        <label class="btn small">📷<input type="file" accept="image/*" data-ch="draftPhoto" hidden></label></div></div>
      <label class="field">Short description<input data-in="draft" data-f="description" value="${esc(d.description)}"></label>
      <div class="row">
        <label class="field grow">Type<select data-ch="draft" data-f="type">${types.map(t => `<option ${d.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field grow">Main protein<select data-ch="draft" data-f="protein">${proteins.map(t => `<option ${d.protein === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field grow">Spice<select data-ch="draft" data-f="spice">${spice.map(([v, l]) => `<option value="${v}" ${num(d.spice, 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label class="field grow">Amounts are for (portions)<input type="number" inputmode="numeric" data-in="draft" data-f="servings" value="${esc(d.servings)}"></label>
        <label class="field grow">Total time (min)<input type="number" inputmode="numeric" data-in="draft" data-f="time_mins" value="${esc(d.time_mins)}"></label>
      </div>
      <label class="field">Tags (comma separated)<input data-in="draft" data-f="tags" value="${esc(tags)}"></label>
      <h2>Ingredients</h2>
      <p class="muted small">Use plain shop names (“spring onion”, not “2 Gousto spring onions”) so the shopping list adds them up.</p>
      <datalist id="itemNames">${D.items.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>
      <div>${(d.ingredients || []).map((i, n) => `<div class="ingedit">
        <input data-in="ing" data-n="${n}" data-f="qty" inputmode="decimal" value="${esc(i.qty)}" placeholder="qty">
        <select data-ch="ing" data-n="${n}" data-f="unit">${units.concat(units.indexOf(i.unit) < 0 ? [i.unit] : []).map(u => `<option ${i.unit === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
        <input data-in="ing" data-n="${n}" data-f="item" list="itemNames" value="${esc(i.item)}" placeholder="ingredient">
        <button class="ghost small" data-act="ingDel" data-n="${n}" aria-label="Remove">✕</button>
        <span></span><span></span><input class="note" data-in="ing" data-n="${n}" data-f="note" value="${esc(i.note)}" placeholder="e.g. finely chopped">
      </div>`).join('')}</div>
      <button class="small" data-act="ingAdd">＋ ingredient</button>
      <label class="field">Method – one step per line<textarea data-in="draftLines" data-f="steps" style="min-height:200px">${esc((d.steps || []).join('\n'))}</textarea></label>
      <label class="field">Technique tips – one per line<textarea data-in="draftLines" data-f="tips">${esc((d.tips || []).join('\n'))}</textarea></label>
      <label class="field">Our notes<textarea data-in="draft" data-f="notes">${esc(d.notes)}</textarea></label>
      <label class="field">Original link<input data-in="draft" data-f="source_url" value="${esc(d.source_url)}"></label>
      <label class="field">Source – author or website<input data-in="draft" data-f="source_name" value="${esc(d.source_name)}" placeholder="e.g. Brian Lagerstrom, BBC Good Food"></label>
      <div class="row end"><button class="ghost" data-act="discardDraft">Cancel</button><button class="primary" data-act="saveDraft">Save recipe</button></div>
    </div>`;
};

VIEWS.history = () => {
  const st = stats();
  const rs = activeRecipes();
  const withS = rs.filter(r => st[r.id]);
  const staples = withS.filter(r => st[r.id].count >= 3 && st[r.id].avg >= 4).sort((a, b) => st[b.id].count - st[a.id].count);
  const most = withS.slice().sort((a, b) => st[b.id].count - st[a.id].count).slice(0, 10);
  const top = withS.filter(r => st[r.id].n).sort((a, b) => st[b.id].avg - st[a.id].avg || st[b.id].count - st[a.id].count).slice(0, 10);
  const lately = withS.filter(r => st[r.id].avg >= 4 && daysSince(st[r.id].last) >= 42).sort((a, b) => st[a.id].last.localeCompare(st[b.id].last));
  const never = withS.filter(r => st[r.id].n && st[r.id].avg <= 2);
  const maxCount = most.length ? st[most[0].id].count : 1;
  const yr = String(new Date().getFullYear());
  const log = D.log.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const chipList = (arr, extra) => arr.length ? arr.map(r => `<a class="tag" href="#/r/${r.id}" style="font-size:.85rem;padding:4px 9px">${esc(r.title)}${extra ? ' · ' + extra(r) : ''}</a>`).join('') : '<span class="muted small">none yet</span>';
  let month = '';
  return `<h1>What we've eaten</h1>
    <div class="tiles">
      <div class="tile"><b>${D.log.length}</b><span class="muted small">meals logged</span></div>
      <div class="tile"><b>${D.log.filter(l => String(l.date).startsWith(yr)).length}</b><span class="muted small">this year</span></div>
      <div class="tile"><b>${withS.length}</b><span class="muted small">different recipes</span></div>
    </div>
    <h2>⭐ Staples</h2><div>${chipList(staples, r => st[r.id].count + '×')}</div>
    <h2>⏳ Loved but not had lately</h2><div>${chipList(lately, r => ago(st[r.id].last))}</div>
    <h2>🔁 Most cooked</h2>
    ${most.map(r => `<a class="rank" href="#/r/${r.id}"><span>${esc(r.title)}</span><div class="bar" style="width:${Math.max(6, 90 * st[r.id].count / maxCount)}px"></div><b>${st[r.id].count}</b></a>`).join('') || '<span class="muted small">none yet</span>'}
    <h2>🏆 Top rated</h2>
    ${top.map(r => `<a class="rank" href="#/r/${r.id}"><span>${esc(r.title)}</span>${stars(st[r.id].avg)}<b>${st[r.id].avg.toFixed(1)}</b></a>`).join('') || '<span class="muted small">none yet</span>'}
    <h2>🚫 Never again</h2><div>${chipList(never)}</div>
    <div class="row" style="margin-top:1.4em"><h2 class="grow" style="margin:0">Diary</h2><button class="small" data-act="openPicker" data-kind="log">＋ Log a meal</button></div>
    ${log.slice(0, 150).map(l => {
      const m = nice(l.date, { month: 'long', year: 'numeric' });
      const head = m !== month ? `<h3 style="margin-top:14px" class="muted small">${(month = m)}</h3>` : '';
      return head + `<div class="li" data-act="editLog" data-id="${l.id}"><span class="muted small" style="width:3.2em">${nice(l.date, { day: 'numeric', month: 'short' })}</span>
        <span class="name">${esc((recipe(l.recipe_id) || {}).title || l.title)}${l.note ? `<span class="note">${esc(l.note)}</span>` : ''}</span>${stars(Number(l.rating))}</div>`;
    }).join('') || '<div class="empty">Tap “Ate it” on a planned meal to start the diary.</div>'}`;
};

VIEWS.items = () => `<h1>Items</h1>
  <p class="muted small">Everything that can go on the list. Different names for the same thing (aliases) are added up together.
  <b>Weekly</b> items are added to every new list; <b>staples</b> are asked about (“check you have”) instead of added. Both = asked about every week.</p>
  <div class="row"><div class="search grow"><input data-in="itemSearch" id="iq" placeholder="Search items"></div><button data-act="newItem">＋ New</button></div>
  <div id="iresults">${itemResults('')}</div>`;

function itemResults(q) {
  const k = normKey(q);
  const list = D.items.filter(i => !k || normKey(i.name + ' ' + (i.aliases || '')).includes(k))
    .sort((a, b) => aisleIdx(a.aisle) - aisleIdx(b.aisle) || a.name.localeCompare(b.name));
  let aisle = '';
  return list.map(i => (i.aisle !== aisle ? `<div class="aisle"><h3>${esc((aisle = i.aisle) || 'Other')}</h3></div>` : '') +
    `<div class="li" data-act="editItem" data-id="${i.id}"><span class="name">${esc(i.name)}${i.aliases ? `<span class="note">also: ${esc(i.aliases)}</span>` : ''}</span>
    ${yes(i.weekly) ? '<span class="badge good">weekly</span>' : ''}${yes(i.staple) ? '<span class="badge warn">staple</span>' : ''}</div>`).join('');
}

VIEWS.settings = () => {
  const c = cfg();
  const s = S();
  return `<h1>Settings</h1>
    <div class="stack">
      <h2>Household</h2>
      <div class="row">
        <label class="field grow">Default portions<input type="number" id="sPortions" value="${esc(s.default_portions || 7)}"></label>
        <label class="field grow">Dinners per week<input type="number" id="sDinners" value="${esc(s.dinners_per_week || 4)}"></label>
      </div>
      <label class="field">Email the list to (comma separated)<input id="sEmail" value="${esc(s.email_to)}" placeholder="you@gmail.com, partner@gmail.com"></label>
      <label class="field">Trusted cooks and sites, for AI ideas under 🎓 Classics<textarea id="sTrusted">${esc(s.trusted_sources)}</textarea></label>
      <label class="field">Shop sections, in walking order (one per line)<textarea id="sAisles" style="min-height:260px">${esc(D.aisles.join('\n'))}</textarea></label>
      <button class="primary" data-act="saveSettings">Save settings</button>
      <h2>Connection</h2>
      <p class="muted small">${c.api ? 'Connected to your Google Sheet.' : 'Demo mode: data is stored only on this device. Follow README.md to connect your Google Sheet.'}</p>
      <label class="field">Back-end URL<input id="cApi" value="${esc(c.api)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="field">App key<input id="cKey" value="${esc(c.key)}"></label>
      <div class="row"><button data-act="saveConn">Connect</button><button class="ghost" data-act="shareLink">Copy link for another phone</button></div>
      <h2>Other</h2>
      <div class="row"><a class="btn" href="#/items">Manage items</a><button data-act="reload">Reload data</button></div>
      <p class="muted small">Recipe Book · data lives in your Google Sheet; weekly backups go to Drive.</p>
    </div>`;
};

function demoBanner() {
  return cfg().api ? '' : '<div class="card small" style="margin-bottom:12px">👀 Demo mode – try things out. <a href="#/settings">Connect your Google Sheet</a> to keep real data.</div>';
}

// ------------------------------------------------------------ modals ---

function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><button class="ghost x" data-act="closeModal" aria-label="Close">✕</button>${html}</div>`;
  m.hidden = false;
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

let picker = { kind: 'dinner' };
function openPicker(kind) {
  picker = { kind };
  const title = { dinner: 'Add a dinner', baking: 'Add baking', other: 'Add a breakfast, lunch or side', log: 'What did you eat?' }[kind];
  openModal(`<h2 style="margin-top:0">${title}</h2>
    <div class="search"><input id="pq" data-in="pickerSearch" placeholder="Search recipes – or type anything" autocomplete="off"></div>
    <div id="presults" style="margin-top:8px">${pickerResults('')}</div>`);
  setTimeout(() => { const i = $('#pq'); if (i) i.focus(); }, 50);
}
function pickerResults(q) {
  const st = stats();
  const k = normKey(q);
  const want = picker.kind === 'log' ? () => true : r => groupOf(r.type) === picker.kind;
  let list = activeRecipes().filter(r => (k ? normKey(r.title + ' ' + (r.tags || '')).includes(k) : want(r)));
  list.sort((a, b) => ((st[b.id] || {}).avg || 3) - ((st[a.id] || {}).avg || 3));
  list = list.slice(0, 25);
  return (q.trim() ? `<button class="li" style="width:100%;border-radius:10px" data-act="pickFree" data-t="${esc(q.trim())}">＋ “${esc(q.trim())}” <span class="muted small">(no recipe, just a note)</span></button>` : '') +
    list.map(r => `<div class="li" data-act="pick" data-id="${r.id}">${thumb(r, 'thumb" style="width:44px;height:44px;font-size:1.1rem')}
      <span class="name">${esc(r.title)}<span class="note">${st[r.id] ? `${st[r.id].count}× · ${ago(st[r.id].last)}` : 'never cooked'}</span></span>${st[r.id] ? stars(st[r.id].avg) : ''}</div>`).join('') +
    (list.length ? '' : '<p class="muted small">No match – add it as a note above, or <a href="#/add" data-act="closeModal">import a recipe</a>.</p>');
}

let rating = {};
function openRate(r) {
  rating = Object.assign({ date: today(), rating: 0, note: '', portions: defPortions() }, r);
  const title = (recipe(rating.recipe_id) || {}).title || rating.title;
  openModal(`<h2 style="margin-top:0">How was it?</h2><p><b>${esc(title)}</b></p>
    <div class="bigstars">${[1, 2, 3, 4, 5].map(n => `<button data-act="setStar" data-n="${n}" class="${n <= rating.rating ? 'on' : ''}">★</button>`).join('')}</div>
    <p class="muted small" style="text-align:center">1–2 = never again · 3 = fine · 4 = good · 5 = family favourite</p>
    <div class="stack">
      <label class="field">Note (optional)<textarea id="rNote" style="min-height:70px" placeholder="kids loved it, less chilli next time…">${esc(rating.note)}</textarea></label>
      <label class="field">Date<input type="date" id="rDate" value="${esc(rating.date)}"></label>
      <div class="row end">${rating.id ? '<button class="ghost" data-act="delLog">Delete</button>' : ''}<button class="primary" data-act="saveRate">Save</button></div>
    </div>`);
}

/* 🎓 Classics: a hand-picked library of traditional dishes (classics.js), each linked to a cook
 * known for doing it properly. Asking the AI for more ideas is a fallback underneath. */
let cl = { kind: 'dinner', cuisine: '', seed: 1, all: false };
function openClassics(kind) { cl = { kind: kind || 'dinner', cuisine: '', seed: Math.random(), all: false, q: '' }; renderClassics(); }
function shuffleKey(id) { let h = Math.floor(cl.seed * 1e6); for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 1000003; return h; }
/** The classics matching the current filters; a search looks across every kind and cuisine. */
function classicsList() {
  const hidden = new Set(String(S().classics_hidden || '').split(',').filter(Boolean));
  const inBook = c => D.recipes.some(r => (c.url && r.source_url === c.url) || normKey(r.title) === normKey(c.dish));
  const q = normKey(cl.q || '');
  const pool = (window.CLASSICS || []).filter(c => !hidden.has(c.id) && (q || groupOf(c.type) === cl.kind));
  const list = pool.filter(c => q ? normKey([c.dish, c.cuisine, c.source, c.learn].join(' ')).includes(q) : !cl.cuisine || c.cuisine === cl.cuisine)
    .sort((a, b) => (inBook(a) - inBook(b)) || shuffleKey(a.id) - shuffleKey(b.id));
  return { list, inBook, cuisines: pool.map(c => c.cuisine).filter((x, i, a) => a.indexOf(x) === i).sort() };
}

function classicsCards() {
  const { list, inBook } = classicsList();
  const shown = cl.all || cl.q ? list : list.slice(0, 8);
  return `<div class="row"><span class="muted small grow">${list.length} ${cl.q ? 'found' : 'to choose from'}</span>${cl.q ? '' : '<button class="ghost small" data-act="clShuffle">🔀 Shuffle</button>'}</div>
    <div class="stack" style="margin-top:6px">${shown.map(c => `<div class="card">
      <div class="row"><b class="grow">${esc(c.dish)}</b>${inBook(c) ? '<span class="badge good">in your book</span>' : ''}</div>
      <div class="muted small">${esc(c.cuisine)} · ${esc(c.source)}${c.effort === 'weekend' ? ' · weekend project' : ''} ${chillies(c)}</div>
      <p class="small" style="margin:6px 0">You’ll learn: ${esc(c.learn)}</p>
      <div class="row"><button class="small primary" data-act="importIdea" data-url="${esc(c.url)}" data-src="${esc(c.source)}">＋ Add to week</button>
        <a class="btn small" href="${esc(c.url)}" target="_blank" rel="noopener">Read ↗</a>
        <button class="ghost small" data-act="clHide" data-id="${esc(c.id)}">Not for us</button></div></div>`).join('') || `<p class="muted">${cl.q ? 'No classic matches – try the AI search below.' : 'Nothing here yet.'}</p>`}</div>
    ${list.length > shown.length ? `<button style="width:100%;margin-top:10px" data-act="clAll">Show all ${list.length}</button>` : ''}`;
}

function renderClassics() {
  const { cuisines } = classicsList();
  const y = ($('#modal .sheet') || {}).scrollTop || 0;
  openModal(`<h2 style="margin-top:0">🎓 Learn a classic</h2>
    <p class="muted small">Traditional dishes, each from a cook known for doing it properly. Pick one to import it into your book and this week.</p>
    <div class="chips">${GROUPS.map(([k, l]) => `<button class="chip ${cl.kind === k ? 'on' : ''}" data-act="clKind" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="search" style="margin:8px 0"><input id="clq" data-in="clSearch" value="${esc(cl.q)}" placeholder="Search all classics… e.g. “curry”, “Italian”, “pastry”" autocomplete="off"></div>
    <div class="chips"><button class="chip ${cl.cuisine ? '' : 'on'}" data-act="clCuisine" data-k="">All</button>${cuisines.map(c => `<button class="chip ${cl.cuisine === c ? 'on' : ''}" data-act="clCuisine" data-k="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div id="clList">${classicsCards()}</div>
    <hr><b>Something else?</b> <span class="muted small">Ask the AI to find a traditional recipe from your trusted cooks (Settings).</span>
    <div class="stack" style="margin-top:8px"><input id="sHint" placeholder="e.g. “a proper French stew”, “uses leeks”, “Sunday roast”">
    <button data-act="runSurprise">Find ideas</button><div id="sResults"></div></div>`);
  const sheet = $('#modal .sheet');
  if (sheet) sheet.scrollTop = y;
}

function openBasics() {
  const onList = new Set(D.list.filter(l => !yes(l.checked)).map(l => l.item_id));
  const basics = D.items.filter(i => yes(i.weekly));
  openModal(`<h2 style="margin-top:0">Weekly basics</h2>
    <p class="muted small">Added automatically to every new list. Tap to add one now. Change which items are weekly in <a href="#/items" data-act="closeModal">Items</a>.</p>
    ${basics.map(i => `<div class="li"><span class="name">${esc(i.name)}</span>${onList.has(i.id) ? '<span class="badge good">on list</span>' : `<button class="small" data-act="addItemToList" data-id="${i.id}">＋ add</button>`}</div>`).join('') || '<p class="muted">No weekly items yet.</p>'}`);
}

function itemForm(i) {
  const others = D.items.filter(x => x.id !== i.id).sort((a, b) => a.name.localeCompare(b.name));
  openModal(`<h2 style="margin-top:0">${i.id ? 'Edit item' : 'New item'}</h2><div class="stack">
    <label class="field">Name<input id="iName" value="${esc(i.name)}"></label>
    <label class="field">Also called (comma separated)<input id="iAliases" value="${esc(i.aliases)}"></label>
    <label class="field">Shop section<select id="iAisle">${D.aisles.map(a => `<option ${i.aisle === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
    <label class="field">Usual amount (for weekly basics)<input id="iQty" value="${esc(i.default_qty)}" placeholder="e.g. 4 pints"></label>
    <label class="field">Weight of one, in grams (optional)<input id="iEach" type="number" inputmode="numeric" value="${esc(i.each_g)}" placeholder="e.g. 150 for an onion">
      <span class="muted small">Lets the list add up “2 onions” and “300 g onion”.</span></label>
    <label class="row"><input type="checkbox" id="iWeekly" ${yes(i.weekly) ? 'checked' : ''}> Weekly basic – add to every list</label>
    <label class="row"><input type="checkbox" id="iStaple" ${yes(i.staple) ? 'checked' : ''}> Store-cupboard staple – ask “do we have it?” instead of adding it</label>
    <button class="primary" data-act="saveItem" data-id="${esc(i.id || '')}">Save</button>
    ${i.id ? `<hr><label class="field">Same thing as… (merge)<select id="iMerge"><option value="">choose item</option>${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
      <button data-act="mergeItem" data-id="${i.id}">Merge into selected</button>` : ''}
  </div>`);
}

// ----------------------------------------------------------- actions ---

const ACT = {
  closeModal: () => closeModal(),

  // week
  weekMove: el => { UI.week = addDays(UI.week, Number(el.dataset.n)); render(); },
  suggestWeek: () => {
    const target = num(S().dinners_per_week, 4);
    const entries = weekEntries(UI.week);
    const need = target - entries.filter(e => kindOf(e) === 'dinner').length;
    const picks = suggest(need);
    if (!picks.length) { toast('Add a few recipes first, then I can suggest'); return; }
    savePlan(UI.week, entries.concat(picks.map(r => planEntry(r))));
  },
  swap: el => {
    const entries = weekEntries(UI.week);
    const e = entries.find(x => x.id === el.dataset.id);
    const [r] = suggest(1, [e.recipe_id]);
    if (!r) { toast('No other suggestions – add more recipes'); return; }
    Object.assign(e, { recipe_id: r.id, title: r.title });
    savePlan(UI.week, entries);
  },
  unplan: el => savePlan(UI.week, weekEntries(UI.week).filter(e => e.id !== el.dataset.id)),
  portions: el => {
    const entries = weekEntries(UI.week);
    const e = entries.find(x => x.id === el.dataset.id);
    e.portions = Math.max(1, num(e.portions, defPortions()) + Number(el.dataset.n));
    savePlan(UI.week, entries);
  },
  ateIt: el => {
    const e = D.plan.find(x => x.id === el.dataset.id);
    openRate({ recipe_id: e.recipe_id, title: e.title, portions: e.portions, plan_id: e.id });
  },
  openPicker: el => openPicker(el.dataset.kind),
  pick: el => pickDone(recipe(el.dataset.id), ''),
  pickFree: el => pickDone(null, el.dataset.t),
  buildList: () => buildList(),
  openClassics: el => openClassics(el.dataset.kind),
  clKind: el => { cl.kind = el.dataset.k; cl.cuisine = ''; cl.all = false; cl.q = ''; renderClassics(); },
  clCuisine: el => { cl.cuisine = el.dataset.k; cl.all = false; cl.q = ''; renderClassics(); },
  clShuffle: () => { cl.seed = Math.random(); renderClassics(); },
  clAll: () => { cl.all = true; renderClassics(); },
  clHide: async el => {
    const hidden = String(S().classics_hidden || '').split(',').filter(Boolean).concat([el.dataset.id]);
    D.settings.classics_hidden = hidden.join(',');
    renderClassics();
    const res = await run('settingsSave', { settings: { classics_hidden: D.settings.classics_hidden } });
    if (res) { D.settings = res.settings; saveCache(); }
  },
  grocSkip: el => {
    const entries = weekEntries(UI.week);
    const skipped = entries.find(e => e.kind === 'skip' && e.item_id === el.dataset.id);
    const it = D.items.find(i => i.id === el.dataset.id);
    savePlan(UI.week, skipped ? entries.filter(e => e !== skipped) : entries.concat([Object.assign(groceryEntry(it), { kind: 'skip' })]));
  },
  toggleBasics: () => { UI.basicsOpen = !UI.basicsOpen; store.set('basicsOpen', UI.basicsOpen); render(); },
  grocAdd: el => addGrocery(D.items.find(i => i.id === el.dataset.id), el.dataset.qty),
  runSurprise: async el => {
    el.disabled = true;
    $('#sResults').innerHTML = '<p class="muted"><span class="spinner"></span> Looking for ideas and checking each page…</p>';
    const ideas = await run('surprise', { hint: $('#sHint').value, kind: cl.kind });
    el.disabled = false;
    if (!ideas) { $('#sResults').innerHTML = ''; return; }
    $('#sResults').innerHTML = ideas.map((s, n) => `<div class="card">
      ${s.image ? `<img src="${esc(s.image)}" alt="" style="border-radius:10px;max-height:160px;width:100%;object-fit:cover;margin-bottom:8px">` : ''}
      <b>${esc(s.title)}</b> <span class="muted small">· ${esc(s.source)}</span>
      ${s.verified ? '<span class="badge good">✓ real recipe</span>' : '<span class="badge warn">couldn’t verify</span>'}
      <p class="small">${esc(s.why)}</p>${s.learn ? `<p class="small muted">You’ll learn: ${esc(s.learn)}</p>` : ''}
      <div class="row">${s.verified ? `<button class="small primary" data-act="importIdea" data-url="${esc(s.url)}">Import & add to week</button><a class="btn small" href="${esc(s.url)}" target="_blank" rel="noopener">Open ↗</a>`
        : `<a class="btn small" href="${esc(s.search_url)}" target="_blank" rel="noopener">Search for it ↗</a>`}</div></div>`).join('');
    $('#sResults').dataset.n = ideas.length;
  },
  importIdea: async el => {
    el.disabled = true;
    el.innerHTML = '<span class="spinner"></span> importing…';
    const draft = await run('importUrl', { url: el.dataset.url });
    if (!draft) { el.disabled = false; el.textContent = 'Import & add to week'; return; }
    draft.addToWeek = UI.week;
    if (el.dataset.src) {
      draft.source_name = el.dataset.src;
      draft.tags = [].concat(draft.tags || []).concat(['classic']);
    }
    setDraft(draft);
    closeModal();
    location.hash = '#/edit/new';
  },

  // shopping list
  tick: async el => {
    const l = D.list.find(x => x.id === el.dataset.id);
    l.checked = !yes(l.checked);
    saveCache();
    render();
    await run('listUpdate', { id: l.id, fields: { checked: l.checked } });
  },
  toggleTrolley: () => { UI.showTrolley = !UI.showTrolley; render(); },
  clearChecked: async () => {
    D.list = D.list.filter(l => !yes(l.checked));
    render();
    const list = await run('listClearChecked');
    if (list) { D.list = list; saveCache(); render(); }
  },
  addSugg: el => addToList({ item_id: el.dataset.id, qty: el.dataset.qty }),
  addNew: el => {
    const { name, qty, to } = el.dataset;
    openModal(`<h2 style="margin-top:0">Where is “${esc(name)}” in the shop?</h2><p class="muted small">Asked once – next time it’s remembered.</p>
      <div class="chips wrap">${D.aisles.map(a => `<button class="chip" data-act="addNewAisle" data-name="${esc(name)}" data-qty="${esc(qty)}" data-to="${esc(to)}" data-aisle="${esc(a)}">${esc(a)}</button>`).join('')}</div>`);
  },
  addNewAisle: async el => {
    const { name, qty, aisle, to } = el.dataset;
    closeModal();
    if (to !== 'week') { addToList({ name, qty, aisle }); return; }
    const items = await run('itemSave', { item: { name, aisle, aliases: '', staple: false, weekly: false, default_qty: '' } });
    if (!items) return;
    D.items = items;
    saveCache();
    addGrocery(findItem(name), qty);
  },
  addItemToList: el => { addToList({ item_id: el.dataset.id, qty: (D.items.find(i => i.id === el.dataset.id) || {}).default_qty || '' }); closeModal(); },
  setStatus: el => setStatus([el.dataset.id], el.dataset.s),
  allHome: () => setStatus(D.list.filter(l => !yes(l.checked) && l.status === 'check').map(l => l.id), 'home'),
  toggleHome: () => { UI.showHome = !UI.showHome; render(); },
  editRow: el => {
    const l = D.list.find(x => x.id === el.dataset.id);
    openModal(`<h2 style="margin-top:0">${esc(l.name)}</h2><div class="stack">
      <label class="field">Amount<input id="eQty" value="${esc([l.qty, l.unit].filter(Boolean).join(' '))}"></label>
      <label class="field">Note<input id="eNote" value="${esc(l.note)}"></label>
      <label class="field">Shop section (remembered for next time)<select id="eAisle">${D.aisles.map(a => `<option ${l.aisle === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <div class="row end"><button class="ghost" data-act="removeRow" data-id="${l.id}">Remove</button><button class="primary" data-act="saveRow" data-id="${l.id}">Save</button></div></div>`);
  },
  saveRow: async el => {
    const l = D.list.find(x => x.id === el.dataset.id);
    const fields = { qty: $('#eQty').value.trim(), unit: '', note: $('#eNote').value.trim(), aisle: $('#eAisle').value };
    const aisleChanged = fields.aisle !== l.aisle;
    Object.assign(l, fields);
    closeModal();
    render();
    await run('listUpdate', { id: l.id, fields });
    const it = D.items.find(i => i.id === l.item_id);
    if (aisleChanged && it) { it.aisle = fields.aisle; const items = await run('itemSave', { item: { id: it.id, aisle: it.aisle } }); if (items) D.items = items; }
    saveCache();
  },
  removeRow: async el => {
    D.list = D.list.filter(l => l.id !== el.dataset.id);
    closeModal();
    render();
    await run('listRemove', { ids: [el.dataset.id] });
    saveCache();
  },
  openBasics: () => openBasics(),
  emailList: async el => {
    el.disabled = true;
    const r = await run('emailList');
    el.disabled = false;
    if (r) toast('Sent to ' + r.sent_to);
  },

  // recipes
  rFilter: el => { UI.rFilter = el.dataset.k; render(); },
  rPortions: el => { UI.portions[el.dataset.id] = Math.max(1, (UI.portions[el.dataset.id] || defPortions()) + Number(el.dataset.n)); render(); },
  swapHint: el => { UI.swaps[el.dataset.k] = !UI.swaps[el.dataset.k]; render(); },
  gotIng: el => { const g = UI.got[el.dataset.id] || (UI.got[el.dataset.id] = {}); g[el.dataset.n] = !g[el.dataset.n]; render(); },
  step: el => { const n = Number(el.dataset.n); UI.step[el.dataset.id] = UI.step[el.dataset.id] === n ? undefined : n; render(); },
  addToWeek: el => {
    const r = recipe(el.dataset.id);
    UI.week = weekOf(new Date());
    savePlan(UI.week, weekEntries(UI.week).concat([planEntry(r, groupOf(r.type), UI.portions[r.id])]));
    toast('Added to this week');
  },
  wish: el => {
    const r = recipe(el.dataset.id);
    if (r.wish) { setWish(r, ''); toast('Removed from wishlist'); return; }
    const what = prompt('Saving for later. What for? (optional – e.g. next week, Christmas)', '');
    if (what === null) return;
    setWish(r, what.trim() || 'soon');
    toast('Saved to your wishlist ♥');
  },
  wishAdd: el => {
    const r = recipe(el.dataset.id);
    savePlan(UI.week, weekEntries(UI.week).concat([planEntry(r, groupOf(r.type))]));
    toast('Added – it leaves the wishlist once you’ve eaten it');
  },
  rateRecipe: el => openRate({ recipe_id: el.dataset.id, portions: UI.portions[el.dataset.id] }),
  wake: async () => {
    try {
      if (UI.wake) { await UI.wake.release(); UI.wake = null; } else { UI.wake = await navigator.wakeLock.request('screen'); UI.wake.addEventListener('release', () => { UI.wake = null; }); }
    } catch (e) { toast('This phone does not allow keeping the screen on', true); }
    UI.wantWake = !!UI.wake;
    render();
  },
  archive: async el => {
    if (!confirm('Archive this recipe? It disappears from lists but its history is kept (you can un-archive in the Sheet).')) return;
    const r = recipe(el.dataset.id);
    r.archived = true;
    saveCache();
    location.hash = '#/recipes';
    await run('recipeArchive', { id: r.id, archived: true });
  },

  // rating / log
  setStar: el => {
    rating.rating = Number(el.dataset.n);
    document.querySelectorAll('.bigstars button').forEach(b => b.classList.toggle('on', Number(b.dataset.n) <= rating.rating));
  },
  saveRate: async () => {
    rating.note = $('#rNote').value.trim();
    rating.date = $('#rDate').value || today();
    const entry = { date: rating.date, recipe_id: rating.recipe_id || '', title: (recipe(rating.recipe_id) || {}).title || rating.title, portions: rating.portions, rating: rating.rating || '', note: rating.note };
    closeModal();
    if (rating.id) {
      Object.assign(D.log.find(l => l.id === rating.id), entry);
      render();
      await run('logUpdate', { id: rating.id, fields: entry });
    } else {
      const planId = rating.plan_id;
      const saved = await run('logAdd', { entry, plan_id: planId });
      if (!saved) return;
      D.log.push(saved);
      const eaten = recipe(entry.recipe_id);
      if (eaten && eaten.wish) setWish(eaten, ''); // cooked it – off the wishlist
      if (planId) { const p = D.plan.find(x => x.id === planId); if (p) p.done = true; }
      toast(rating.rating >= 4 ? 'Lovely – noted!' : 'Noted');
      render();
    }
    saveCache();
  },
  editLog: el => openRate(Object.assign({}, D.log.find(l => l.id === el.dataset.id))),
  delLog: async () => {
    D.log = D.log.filter(l => l.id !== rating.id);
    closeModal();
    render();
    await run('logRemove', { id: rating.id });
    saveCache();
  },

  // import & edit
  importUrl: async el => {
    const url = $('#impUrl').value.trim();
    if (!url) return;
    await importWith(el, 'importUrl', { url });
  },
  importText: async el => {
    const text = $('#impText').value.trim();
    if (!text) return;
    await importWith(el, 'importText', { text, source_url: $('#impSrc').value.trim() });
  },
  importPhoto: async el => {
    const f = $('#impPhoto').files[0];
    if (!f) { toast('Choose a photo first'); return; }
    const image = await fileToDataUrl(f, 1600);
    await importWith(el, 'importText', { text: 'The recipe is in the attached photo.', image });
  },
  manualRecipe: () => {
    setDraft({ title: '', type: 'dinner', protein: 'none', servings: 4, ingredients: [{ qty: '', unit: '', item: '', note: '' }], steps: [], tips: [], tags: [], notes: '' });
    location.hash = '#/edit/new';
  },
  ingAdd: () => { UI.draft.ingredients.push({ qty: '', unit: '', item: '', note: '' }); setDraft(UI.draft); render(); },
  ingDel: el => { UI.draft.ingredients.splice(Number(el.dataset.n), 1); setDraft(UI.draft); render(); },
  discardDraft: () => { const id = UI.draft && UI.draft.id; setDraft(null); location.hash = id ? '#/r/' + id : '#/recipes'; },
  saveDraft: async el => {
    const d = UI.draft;
    if (!d.title.trim()) { toast('Give it a title', true); return; }
    el.disabled = true;
    el.innerHTML = '<span class="spinner"></span> saving…';
    const rec = Object.assign({}, d, {
      tags: Array.isArray(d.tags) ? d.tags.join(', ') : d.tags,
      servings: num(d.servings, 4), time_mins: num(d.time_mins, ''), spice: num(d.spice, 0),
      ingredients: d.ingredients.filter(i => String(i.item).trim()),
    });
    const addWeek = rec.addToWeek;
    delete rec.addToWeek;
    delete rec.problem;
    const res = await run('recipeSave', { recipe: rec });
    if (!res) { el.disabled = false; el.textContent = 'Save recipe'; return; }
    D.recipes = D.recipes.filter(r => r.id !== res.recipe.id).concat([res.recipe]);
    D.items = res.items;
    saveCache();
    setDraft(null);
    enrichNewItems();
    if (addWeek) savePlan(addWeek, weekEntries(addWeek).concat([planEntry(res.recipe, groupOf(res.recipe.type))]));
    location.hash = '#/r/' + res.recipe.id;
  },

  // items
  newItem: () => itemForm({ name: ($('#iq') || {}).value || '', aisle: 'Other' }),
  editItem: el => itemForm(D.items.find(i => i.id === el.dataset.id)),
  saveItem: async el => {
    const item = {
      id: el.dataset.id || undefined, name: $('#iName').value.trim().toLowerCase(), aliases: $('#iAliases').value.trim(),
      aisle: $('#iAisle').value, default_qty: $('#iQty').value.trim(), weekly: $('#iWeekly').checked, staple: $('#iStaple').checked,
      each_g: num($('#iEach').value, ''),
    };
    if (!item.name) return;
    closeModal();
    const items = await run('itemSave', { item });
    if (items) { D.items = items; saveCache(); render(); }
  },
  mergeItem: async el => {
    const into = $('#iMerge').value;
    if (!into) { toast('Choose the item to merge into'); return; }
    closeModal();
    const res = await run('itemMerge', { keep: into, drop: [el.dataset.id] });
    if (res) { Object.assign(D, res); saveCache(); render(); toast('Merged'); }
  },

  // settings
  saveSettings: async () => {
    const settings = {
      default_portions: num($('#sPortions').value, 7), dinners_per_week: num($('#sDinners').value, 4),
      email_to: $('#sEmail').value.trim(), trusted_sources: $('#sTrusted').value.trim(),
      app_url: location.origin + location.pathname,
    };
    const aisles = $('#sAisles').value.split('\n').map(s => s.trim()).filter(Boolean);
    const res = await run('settingsSave', { settings, aisles });
    if (res) { D.settings = res.settings; D.aisles = res.aisles; saveCache(); toast('Saved'); }
  },
  saveConn: () => {
    store.set('cfg', { api: $('#cApi').value.trim(), key: $('#cKey').value.trim() });
    D = null;
    store.set('cache', null);
    load();
  },
  shareLink: async () => {
    const c = cfg();
    const link = location.origin + location.pathname + '?api=' + encodeURIComponent(c.api) + '&key=' + encodeURIComponent(c.key) + '#/week';
    try { await navigator.clipboard.writeText(link); toast('Link copied – open it on the other phone'); } catch (e) { prompt('Copy this link', link); }
  },
  reload: () => load(),
};

async function pickDone(r, freeText) {
  const kind = picker.kind;
  closeModal();
  if (kind === 'log') { openRate({ recipe_id: r ? r.id : '', title: r ? r.title : freeText }); return; }
  const e = planEntry(r, kind);
  if (!r) e.title = freeText;
  await savePlan(UI.week, weekEntries(UI.week).concat([e]));
}

async function addToList(row) {
  const it = row.item_id ? D.items.find(i => i.id === row.item_id) : findItem(row.name);
  const payload = { rows: [{ item_id: it ? it.id : '', name: it ? it.name : row.name, aisle: row.aisle || (it && it.aisle) || 'Other', qty: row.qty || '', note: row.note || '', source: 'manual' }] };
  const q = $('#lq');
  if (q) q.value = '';
  const sugg = $('#lsugg');
  if (sugg) sugg.innerHTML = '';
  const res = await run('listAdd', payload);
  if (!res) return;
  D.list = D.list.concat(res.rows);
  D.items = res.items;
  saveCache();
  render();
  toast('Added ' + res.rows[0].name);
}

function addGrocery(item, qty) {
  if (!item) return;
  const q = $('#gq');
  if (q) q.value = '';
  const sugg = $('#gsugg');
  if (sugg) sugg.innerHTML = '';
  savePlan(UI.week, weekEntries(UI.week).concat([groceryEntry(item, qty)]));
  toast('Added ' + item.name);
}

async function setStatus(ids, status) {
  if (!ids.length) return;
  D.list.forEach(l => { if (ids.indexOf(l.id) >= 0) l.status = status; });
  saveCache();
  render();
  const list = await run('listStatus', { ids, status });
  if (list) { D.list = list; saveCache(); render(); }
}

async function importWith(btn, action, payload) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> reading the recipe…';
  const draft = await run(action, payload);
  btn.disabled = false;
  btn.textContent = label;
  if (!draft) return;
  setDraft(draft);
  location.hash = '#/edit/new';
}

function setDraft(d) {
  if (d && Array.isArray(d.ingredients)) d.ingredients.forEach(i => { if (i.qty == null) i.qty = ''; });
  UI.draft = d;
  store.set('draft', d);
}

function fileToDataUrl(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ------------------------------------------------------ input events ---

const IN = {
  recipeSearch: el => { UI.rq = el.value; $('#rresults').innerHTML = recipeResults(); },
  pickerSearch: el => { $('#presults').innerHTML = pickerResults(el.value); },
  itemSearch: el => { $('#iresults').innerHTML = itemResults(el.value); },
  listSearch: el => { $('#lsugg').innerHTML = itemSuggestions(el.value, 'addSugg', 'list'); },
  grocSearch: el => { $('#gsugg').innerHTML = itemSuggestions(el.value, 'grocAdd', 'week'); },
  draft: el => {
    const f = el.dataset.f;
    if (f === 'image' && el.value === '(uploaded photo)') return;
    UI.draft[f] = el.value;
    setDraft(UI.draft);
  },
  draftLines: el => { UI.draft[el.dataset.f] = el.value.split('\n').map(s => s.trim()).filter(Boolean); setDraft(UI.draft); },
  ing: el => { UI.draft.ingredients[Number(el.dataset.n)][el.dataset.f] = el.value; setDraft(UI.draft); },
};

/** Dropdown for "2 milk"-style typing: known items first, otherwise offer to add a new one. */
function itemSuggestions(raw, act, to) {
  const m = raw.match(/^\s*(\d+(?:[.,]\d+)?\s*(?:x|kg|g|l|ml|pints?|packs?)?)\s+(.+)$/i);
  const qty = m ? m[1].trim() : '';
  const q = (m ? m[2] : raw).trim();
  if (!q) return '';
  const hits = searchItems(q);
  const exact = hits.some(i => normKey(i.name) === normKey(q));
  return '<div class="sugg">' + hits.map(i => `<button data-act="${act}" data-id="${i.id}" data-qty="${esc(qty)}"><span>${esc(i.name)}</span><span class="muted small">${esc(i.aisle)}</span></button>`).join('') +
    (exact ? '' : `<button data-act="addNew" data-to="${to}" data-name="${esc(q.toLowerCase())}" data-qty="${esc(qty)}"><span>＋ Add “${esc(q)}”</span><span class="muted small">new</span></button>`) + '</div>';
}

const CH = {
  rSort: el => { UI.rSort = el.value; $('#rresults').innerHTML = recipeResults(); },
  draft: el => { UI.draft[el.dataset.f] = el.value; setDraft(UI.draft); },
  ing: el => { UI.draft.ingredients[Number(el.dataset.n)][el.dataset.f] = el.value; setDraft(UI.draft); },
  draftPhoto: async el => {
    const f = el.files[0];
    if (!f) return;
    UI.draft.image = await fileToDataUrl(f, 1400);
    setDraft(UI.draft);
    render();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) {
    if (el.tagName !== 'A' && el.type !== 'checkbox') e.preventDefault();
    ACT[el.dataset.act](el, e);
  } else if (e.target.id === 'modal') closeModal();
});
// Swipe left/right on the Week tab to go to the next/previous week (the plan is stored per week).
let swipe = null;
document.addEventListener('touchstart', e => {
  const t = e.touches[0];
  const busy = e.touches.length > 1 || route().name !== 'week' || !$('#modal').hidden || e.target.closest('input, textarea, select, .chips, .stepper');
  swipe = busy ? null : { x: t.clientX, y: t.clientY, at: Date.now() };
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!swipe) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  const ok = Math.abs(dx) > 70 && Math.abs(dy) < 50 && Date.now() - swipe.at < 700;
  swipe = null;
  if (!ok) return;
  UI.week = addDays(UI.week, dx < 0 ? 7 : -7);
  render();
  const v = $('#view');
  v.classList.remove('from-left', 'from-right');
  void v.offsetWidth; // restart the animation
  v.classList.add(dx < 0 ? 'from-right' : 'from-left');
}, { passive: true });

IN.clSearch = el => { cl.q = el.value; $('#clList').innerHTML = classicsCards(); };
document.addEventListener('input', e => { const el = e.target; if (el.dataset.in && IN[el.dataset.in]) IN[el.dataset.in](el); });
document.addEventListener('change', e => { const el = e.target; if (el.dataset.ch && CH[el.dataset.ch]) CH[el.dataset.ch](el); });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.target.id === 'lq' || e.target.id === 'gq')) {
    const first = document.querySelector(e.target.id === 'lq' ? '#lsugg button' : '#gsugg button');
    if (first) first.click();
  }
});

// ------------------------------------------------------------ router ---

function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'week';
  const [path, qs] = h.split('?');
  const parts = path.split('/');
  return { name: parts[0], id: parts[1], q: new URLSearchParams(qs || '') };
}

function render() {
  const rt = route();
  document.querySelectorAll('.tabs a').forEach(a => {
    const tab = a.dataset.tab;
    a.classList.toggle('on', tab === rt.name || (tab === 'recipes' && ['r', 'add', 'edit'].indexOf(rt.name) >= 0) || (tab === 'list' && rt.name === 'items'));
  });
  if (!D) { $('#view').innerHTML = '<div class="empty"><span class="spinner"></span></div>'; return; }
  const v = VIEWS[rt.name] || VIEWS.week;
  // keep the scroll position when re-rendering the same page
  const y = window.scrollY;
  const same = render.last === location.hash;
  $('#view').innerHTML = v(rt);
  if (same) window.scrollTo(0, y);
  render.last = location.hash;
}

window.addEventListener('hashchange', () => { closeModal(); render(); window.scrollTo(0, 0); });

// Keep the shopping list in sync between phones while it is open.
setInterval(async () => {
  if (!D || !cfg().api || document.hidden || route().name !== 'list' || !$('#modal').hidden) return;
  if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  try {
    const list = await api('listGet');
    if (JSON.stringify(list) !== JSON.stringify(D.list)) { D.list = list; saveCache(); render(); }
  } catch (e) { /* offline – try again next tick */ }
}, 12000);

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  if (UI.wake === null && route().name === 'r' && UI.wantWake) { try { UI.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }
  if (cfg().api) load();
});

// ------------------------------------------------------------- start ---

(function start() {
  const p = new URLSearchParams(location.search);
  if (p.get('api') && p.get('key')) store.set('cfg', { api: p.get('api'), key: p.get('key') });
  // Android share sheet → Add recipe
  const shared = [p.get('share_url'), p.get('share_text'), p.get('share_title')].filter(Boolean).join(' ');
  if (shared) {
    const url = (shared.match(/https?:\/\/\S+/) || [''])[0];
    const textOnly = shared.replace(url, '').trim();
    location.hash = url && textOnly.length < 80 ? '#/add?tab=link&url=' + encodeURIComponent(url)
      : '#/add?tab=text&text=' + encodeURIComponent(shared) + '&url=' + encodeURIComponent(url);
  }
  if (p.toString()) history.replaceState(null, '', location.pathname + location.hash);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  load();
})();
