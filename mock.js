'use strict';
/* Demo back end: mirrors the Apps Script actions over localStorage so the app
 * can be tried before the Google Sheet is connected. Not used once connected. */

const Mock = (() => {
  const KEY = 'rb_mockdb2';
  const id = () => Math.random().toString(36).slice(2, 10);
  const pad = n => String(n).padStart(2, '0');
  const day = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

  const AISLES = ['Fruit & veg', 'Bakery', 'Meat & fish', 'Dairy & eggs', 'Chilled', 'Tins & jars', 'Pasta, rice & grains',
    'Baking', 'Herbs, spices & sauces', 'Breakfast', 'Snacks & drinks', 'Frozen', 'Household', 'Other'];

  function seed() {
    const items = [
      ['milk', 'Dairy & eggs', 0, 1, 'semi-skimmed milk'], ['bread', 'Bakery', 0, 1, 'loaf'], ['egg', 'Dairy & eggs', 0, 1, 'eggs, free range egg', 60],
      ['banana', 'Fruit & veg', 0, 1, ''], ['butter', 'Dairy & eggs', 1, 0, ''], ['onion', 'Fruit & veg', 0, 0, 'brown onion', 150],
      ['garlic', 'Fruit & veg', 0, 0, 'garlic clove'], ['carrot', 'Fruit & veg', 0, 0, '', 80], ['spring onion', 'Fruit & veg', 0, 0, 'salad onion'],
      ['chicken breast', 'Meat & fish', 0, 0, 'chicken breast portion', 150], ['beef mince', 'Meat & fish', 0, 0, 'minced beef'],
      ['white long grain rice', 'Pasta, rice & grains', 1, 0, 'rice'], ['spaghetti', 'Pasta, rice & grains', 1, 0, ''],
      ['tinned chopped tomatoes', 'Tins & jars', 1, 0, 'chopped tomatoes'], ['panko breadcrumbs', 'Baking', 1, 0, 'panko'],
      ['curry powder', 'Herbs, spices & sauces', 1, 0, ''], ['soy sauce', 'Herbs, spices & sauces', 1, 0, ''],
      ['vegetable oil', 'Herbs, spices & sauces', 1, 0, 'sunflower oil'], ['plain flour', 'Baking', 1, 0, 'flour'],
      ['self-raising flour', 'Baking', 1, 0, ''], ['caster sugar', 'Baking', 1, 0, 'sugar'], ['strawberry jam', 'Tins & jars', 0, 0, 'jam'],
      ['salmon fillet', 'Meat & fish', 0, 0, 'salmon'], ['broccoli', 'Fruit & veg', 0, 0, ''], ['lemon', 'Fruit & veg', 0, 0, '', 100],
      ['toilet roll', 'Household', 0, 0, 'loo roll'], ['parmesan', 'Dairy & eggs', 0, 0, 'italian hard cheese'],
    ].map(([name, aisle, staple, weekly, aliases, each]) => ({ id: id(), name, aisle, staple: !!staple, weekly: !!weekly, aliases, default_qty: '', each_g: each || '' }));
    const I = n => items.find(i => i.name === n);
    const ing = (qty, unit, name, note) => ({ item_id: I(name).id, item: name, qty, unit, note: note || '' });
    const recipes = [
      {
        id: id(), title: 'Chicken katsu curry', type: 'dinner', protein: 'chicken', tags: 'japanese, kid-friendly', servings: 4, time_mins: 45,
        source_name: 'Gousto', source_url: 'https://www.gousto.co.uk/cookbook/chicken-recipes/chicken-katsu-curry',
        description: 'Crunchy panko chicken with a mild, sweet curry sauce and fluffy rice.',
        ingredients: [ing(4, 'pc', 'chicken breast'), ing(80, 'g', 'panko breadcrumbs'), ing(1, 'pc', 'egg', 'beaten'), ing(260, 'g', 'white long grain rice'),
          ing(300, 'g', 'carrot', 'grated'), ing(2, 'tbsp', 'curry powder'), ing(2, 'tbsp', 'soy sauce'), ing(1, 'pc', 'onion', 'finely chopped'), ing(2, 'tbsp', 'plain flour')],
        steps: ['Take the chicken out of the fridge 15 min before cooking.', 'Cook the rice, covered, on a very low heat for 12–15 min, then leave to steam with the lid on.',
          'Soften the onion and carrot in a little oil for 8 min, stir in the flour and curry powder, then add water and soy sauce and simmer until thick.',
          'Dip the chicken in egg, then panko, and fry 5–6 min per side until golden and cooked through.', 'Slice the chicken and serve over rice with the sauce.'],
        tips: ['Letting chicken come to room temperature helps it cook evenly, so the crumb does not burn before the middle is done.'],
        notes: '', created: day(-300), archived: false, image: '',
      },
      {
        id: id(), title: 'Spaghetti bolognese', type: 'dinner', protein: 'beef', tags: 'italian, freezer-friendly', servings: 4, time_mins: 60,
        source_name: 'BBC Good Food', source_url: '', description: 'The family classic, slow-simmered.',
        ingredients: [ing(500, 'g', 'beef mince'), ing(1, 'pc', 'onion', 'finely chopped'), ing(2, 'clove', 'garlic', 'crushed'), ing(1, 'pc', 'carrot', 'finely diced'),
          ing(2, 'tin', 'tinned chopped tomatoes'), ing(400, 'g', 'spaghetti'), ing(30, 'g', 'parmesan', 'grated')],
        steps: ['Brown the mince well in batches in a hot pan.', 'Soften the onion, carrot and garlic in the same pan for 10 min.', 'Add the tomatoes, return the mince and simmer gently for 40 min.', 'Cook the spaghetti and toss with the sauce. Top with parmesan.'],
        tips: ['Browning mince in batches stops it stewing – the brown bits are where the flavour comes from.'], notes: 'Kids like it with extra cheese.', created: day(-400), archived: false, image: '',
      },
      {
        id: id(), title: 'Lemon salmon with broccoli', type: 'dinner', protein: 'fish', tags: 'quick', servings: 4, time_mins: 25,
        source_name: '', source_url: '', description: 'Quick traybake for busy nights.',
        ingredients: [ing(4, 'pc', 'salmon fillet'), ing(1, 'pc', 'broccoli', 'in florets'), ing(1, 'pc', 'lemon'), ing(260, 'g', 'white long grain rice')],
        steps: ['Heat the oven to 200°C.', 'Roast the broccoli for 8 min, add the salmon with lemon slices and roast 12 min more.', 'Serve with rice.'],
        tips: [], notes: '', created: day(-100), archived: false, image: '',
      },
      {
        id: id(), title: 'Victoria sponge', type: 'baking', protein: 'none', tags: 'cake, classic', servings: 10, time_mins: 50,
        source_name: '', source_url: '', description: 'Two light sponges with jam.',
        ingredients: [ing(200, 'g', 'butter', 'soft'), ing(200, 'g', 'caster sugar'), ing(4, 'pc', 'egg'), ing(200, 'g', 'self-raising flour'), ing(4, 'tbsp', 'strawberry jam')],
        steps: ['Heat the oven to 190°C (fan 170°C) and line two 20 cm tins.', 'Beat the butter and sugar until pale and fluffy, then beat in the eggs one at a time.', 'Fold in the flour, divide between the tins and bake 20 min until springy.', 'Cool, then sandwich with jam.'],
        tips: ['Beating butter and sugar traps air – that is what makes the sponge rise light.'], notes: '', created: day(-30), archived: false, image: '',
      },
    ];
    const [katsu, bol, salmon] = recipes;
    const log = [
      [katsu, -9, 5, 'everyone loved it'], [bol, -16, 4, ''], [katsu, -30, 5, ''], [salmon, -23, 2, 'kids not keen'],
      [bol, -45, 4, ''], [katsu, -60, 4, ''], [bol, -70, 5, ''],
    ].map(([r, off, rating, note]) => ({ id: id(), date: day(off), recipe_id: r.id, title: r.title, portions: 7, rating, note }));
    return {
      recipes, items, aisles: AISLES, log, plan: [], list: [],
      settings: { default_portions: 7, dinners_per_week: 4, email_to: '', trusted_sources: 'Felicity Cloake (The Guardian), Delia Smith, BBC Food, Serious Eats', classics_hidden: '' },
    };
  }

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch (e) { return seed(); } }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } }
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/s\b/g, '').trim();
  function ensureItem(d, name, aisle, staple) {
    const k = norm(name);
    let it = d.items.find(i => norm(i.name) === k || String(i.aliases || '').split(',').some(a => a.trim() && norm(a) === k));
    if (!it) { it = { id: id(), name: String(name).toLowerCase().trim(), aliases: '', aisle: aisle || 'Other', staple: !!staple, weekly: false, default_qty: '' }; d.items.push(it); }
    return it;
  }
  const needsBackend = () => { throw new Error('Importing and AI ideas need the Google back end – see Settings → Connection.'); };

  const A = {
    bootstrap: d => d,
    recipeSave: (d, { recipe }) => {
      const r = Object.assign({}, recipe);
      if (!r.id) { r.id = id(); r.created = day(0); }
      r.ingredients = (r.ingredients || []).map(i => { const it = ensureItem(d, i.item, i.aisle, i.staple); return { item_id: it.id, item: it.name, qty: i.qty === '' ? '' : Number(i.qty) || '', unit: i.unit || '', note: i.note || '' }; });
      d.recipes = d.recipes.filter(x => x.id !== r.id).concat([r]);
      return { recipe: r, items: d.items };
    },
    recipeArchive: (d, { id: rid, archived }) => { d.recipes.find(r => r.id === rid).archived = archived; return true; },
    planSave: (d, { week, entries }) => {
      const rows = entries.map((e, i) => Object.assign({}, e, { id: e.id || id(), week, order: i }));
      d.plan = d.plan.filter(p => p.week !== week).concat(rows);
      return rows;
    },
    logAdd: (d, { entry, plan_id }) => {
      const e = Object.assign({ id: id() }, entry);
      d.log.push(e);
      const p = d.plan.find(x => x.id === plan_id);
      if (p) p.done = true;
      return e;
    },
    logUpdate: (d, { id: lid, fields }) => Object.assign(d.log.find(l => l.id === lid), fields),
    logRemove: (d, { id: lid }) => { d.log = d.log.filter(l => l.id !== lid); return true; },
    listGet: d => d.list,
    listAdd: (d, { rows }) => {
      const out = rows.map(r => {
        const it = (r.item_id && d.items.find(i => i.id === r.item_id)) || ensureItem(d, r.name, r.aisle);
        return Object.assign({ qty: '', unit: '', note: '', source: 'manual' }, r, { id: id(), item_id: it.id, name: it.name, aisle: r.aisle || it.aisle, checked: false, added: day(0) });
      });
      d.list = d.list.concat(out);
      return { rows: out, items: d.items };
    },
    listUpdate: (d, { id: lid, fields }) => Object.assign(d.list.find(l => l.id === lid) || {}, fields),
    listStatus: (d, { ids, status }) => { d.list.forEach(l => { if (ids.indexOf(l.id) >= 0) l.status = status; }); return d.list; },
    listRemove: (d, { ids }) => { d.list = d.list.filter(l => ids.indexOf(l.id) < 0); return true; },
    listClearChecked: d => { d.list = d.list.filter(l => !l.checked); return d.list; },
    listBuild: (d, { rows }) => {
      d.list = d.list.filter(l => !l.checked && ['recipe', 'basic'].indexOf(l.source) < 0)
        .concat(rows.map(r => Object.assign({ qty: '', unit: '', note: '' }, r, { id: id(), checked: false, added: day(0) })));
      return d.list;
    },
    emailList: () => { throw new Error('Email needs the Google back end – see Settings → Connection.'); },
    itemSave: (d, { item }) => {
      const ex = item.id && d.items.find(i => i.id === item.id);
      if (ex) Object.assign(ex, item); else d.items.push(Object.assign({ id: id() }, item));
      return d.items;
    },
    itemMerge: (d, { keep, drop }) => {
      const k = d.items.find(i => i.id === keep);
      d.items.filter(i => drop.indexOf(i.id) >= 0).forEach(x => { k.aliases = [k.aliases, x.name, x.aliases].filter(Boolean).join(', '); });
      d.items = d.items.filter(i => drop.indexOf(i.id) < 0);
      d.recipes.forEach(r => (r.ingredients || []).forEach(i => { if (drop.indexOf(i.item_id) >= 0) { i.item_id = k.id; i.item = k.name; } }));
      d.list.forEach(l => { if (drop.indexOf(l.item_id) >= 0) { l.item_id = k.id; l.name = k.name; } });
      return { items: d.items, recipes: d.recipes, list: d.list };
    },
    settingsSave: (d, { settings, aisles }) => { Object.assign(d.settings, settings); if (aisles) d.aisles = aisles; return { settings: d.settings, aisles: d.aisles }; },
    importUrl: needsBackend,
    importText: needsBackend,
    surprise: needsBackend,
  };

  return {
    async call(action, payload) {
      const d = load();
      const fn = A[action];
      if (!fn) throw new Error('Unknown action ' + action);
      const out = fn(d, payload || {});
      save(d);
      return JSON.parse(JSON.stringify(out));
    },
  };
})();
