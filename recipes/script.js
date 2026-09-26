/* ---------- storage ---------- */
const STORE_KEY = 'pantryPlanner.recipes';

function getRecipes() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch { return []; }
}
function saveRecipes(list) {
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
}

/* ---------- caption parsing ---------- */
const UNIT_WORDS = [
  'cups?','tbsp','tablespoons?','tsp','teaspoons?','grams?','g','kg','kilograms?',
  'ml','millilitres?','milliliters?','l','litres?','liters?','oz','ounces?',
  'lb','lbs','pounds?','pinch(es)?','to taste','as needed','cloves?','slices?',
  'pieces?','pkt','packet','cans?','handful(s)?','sprigs?','stalks?'
];
const UNIT_RE = new RegExp('\\b(' + UNIT_WORDS.join('|') + ')\\b', 'gi');

const FRACTION_CHARS = '½¼¾⅓⅔⅛⅜⅝⅞';
const QUANTITY_START_RE = new RegExp(`^[\\d${FRACTION_CHARS}]`);
const INGREDIENTS_HEADING_RE = /^ingredients\s*:?/i;
const METHOD_HEADING_RE = /^(method|instructions?|directions?|steps?|procedure|preparation)\b/i;
const NUTRITION_HEADING_RE = /^(nutrition(al)?(\s*(info|facts))?)\b/i;
const RECIPE_BY_RE = /recipe\s*by/i;
const DECORATIVE_RE = /^[-=_*]{3,}$/;
const ADD_TAIL_RE = /\badd:?\s+(.+)$/i;
const INSTRUCTION_STARTERS = [
  'to','then','now','once','mix','fry','remove','transfer','garnish','cover',
  'bring','let','cook','blend','heat','pour','whisk','simmer','reduce','season','serve','set','add'
];
const STARTER_RE = new RegExp('^(' + INSTRUCTION_STARTERS.join('|') + ')\\b', 'i');

// Real captions mix short ingredient-style lines ("200g Greek yogurt") with
// full instruction sentences, sometimes in the same line ("To a bowl add
// 500g chicken thighs"). This classifies one line at a time rather than
// assuming a clean, separately-headed ingredients block.
function classifyLine(line) {
  const addMatch = line.match(ADD_TAIL_RE);
  if (addMatch && addMatch[1].trim()) {
    // "To a pan add 500g X" -> keep just "500g X"
    return { type: 'ingredient', text: addMatch[1].trim() };
  }
  if (/:$/.test(line)) return { type: 'instruction', text: line }; // header lines like "Then add:"
  if (QUANTITY_START_RE.test(line)) return { type: 'ingredient', text: line };

  const endsWithTerminal = /[.!?]$/.test(line);
  const wordCount = line.split(/\s+/).length;
  if (!endsWithTerminal && wordCount <= 8 && !STARTER_RE.test(line)) {
    return { type: 'ingredient', text: line };
  }
  return { type: 'instruction', text: line };
}

function parseCaption(rawInput) {
  // markdown links like [@user](https://instagram.com/user) -> @user
  const raw = rawInput.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !DECORATIVE_RE.test(l));
  if (lines.length === 0) return { name: '', credit: '', ingredients: '', instructions: '' };

  const name = lines[0];

  let creditIdx = lines.findIndex(l => RECIPE_BY_RE.test(l));
  let credit = '';
  let searchFrom = 1;

  if (creditIdx !== -1) {
    const stripped = lines[creditIdx].replace(new RegExp('.*' + RECIPE_BY_RE.source + '[:\\-]?\\s*', 'i'), '').trim();
    if (stripped) {
      credit = stripped;
      searchFrom = creditIdx + 1;
    } else if (lines[creditIdx + 1]) {
      credit = lines[creditIdx + 1];
      searchFrom = creditIdx + 2;
    } else {
      searchFrom = creditIdx + 1;
    }
  }

  // explicit "Ingredients" heading, if the caption has one
  let ingStart = searchFrom;
  const headingIdx = lines.findIndex((l, i) => i >= searchFrom && INGREDIENTS_HEADING_RE.test(l));
  if (headingIdx !== -1) ingStart = headingIdx + 1;

  // stop scanning for ingredients at a Method/Instructions heading or a
  // Nutrition section, whichever comes first
  const methodIdx = lines.findIndex((l, i) => i >= ingStart && METHOD_HEADING_RE.test(l));
  const nutritionIdx = lines.findIndex((l, i) => i >= ingStart && NUTRITION_HEADING_RE.test(l));
  const stops = [methodIdx, nutritionIdx].filter(i => i !== -1);
  const blockEnd = stops.length ? Math.min(...stops) : lines.length;

  const ingredients = [];
  const instructions = [];

  lines.slice(ingStart, blockEnd).forEach(line => {
    if (INGREDIENTS_HEADING_RE.test(line)) return;
    const { type, text } = classifyLine(line);
    if (text) (type === 'ingredient' ? ingredients : instructions).push(text);
  });

  // a caption with an explicit Method/Instructions heading: trust that
  // section as-is rather than re-classifying it
  if (methodIdx !== -1 && (nutritionIdx === -1 || methodIdx < nutritionIdx)) {
    const methodEnd = nutritionIdx !== -1 ? nutritionIdx : lines.length;
    lines.slice(methodIdx + 1, methodEnd).forEach(l => instructions.push(l));
  }

  return {
    name,
    credit,
    ingredients: ingredients.join('\n'),
    instructions: instructions.join('\n')
  };
}

/* ---------- ingredient normalising & matching ---------- */
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/\d+([\/.]\d+)?/g, ' ')
    .replace(UNIT_RE, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ingredientMatches(pantryTerm, recipeIngredientLine) {
  const a = normalize(pantryTerm);
  const b = normalize(recipeIngredientLine);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const aWords = a.split(' ').filter(w => w.length > 2);
  return aWords.some(w => b.split(' ').includes(w));
}

function scoreRecipe(recipe, pantryItems) {
  const ingList = recipe.ingredients.split('\n').map(l => l.trim()).filter(Boolean);
  const have = [];
  const missing = [];
  ingList.forEach(ing => {
    const hit = pantryItems.some(p => ingredientMatches(p, ing));
    (hit ? have : missing).push(ing);
  });
  const total = ingList.length || 1;
  return { have, missing, ratio: have.length / total };
}

/* ---------- tabs ---------- */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'plan') renderPlanResults();
    if (btn.dataset.tab === 'library') renderLibrary();
  });
});

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- pantry chips ---------- */
let pantry = [];

const pantryForm = document.getElementById('pantry-form');
const pantryInput = document.getElementById('pantry-input');
const pantryChips = document.getElementById('pantry-chips');

pantryForm.addEventListener('submit', e => {
  e.preventDefault();
  const val = pantryInput.value.trim();
  if (!val) return;
  val.split(',').map(v => v.trim()).filter(Boolean).forEach(item => {
    if (!pantry.some(p => p.toLowerCase() === item.toLowerCase())) pantry.push(item);
  });
  pantryInput.value = '';
  renderChips();
  renderPlanResults();
});

function renderChips() {
  pantryChips.innerHTML = '';
  pantry.forEach((item, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(item)} <button type="button" aria-label="Remove ${escapeHtml(item)}">&times;</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      pantry.splice(i, 1);
      renderChips();
      renderPlanResults();
    });
    pantryChips.appendChild(chip);
  });
}

/* ---------- plan results ---------- */
function renderPlanResults() {
  const container = document.getElementById('plan-results');
  const recipes = getRecipes();

  if (recipes.length === 0) {
    container.innerHTML = `<p class="empty-note">No recipes saved yet — head to "Add a recipe" and paste in a caption from @ral.livezy to get started.</p>`;
    return;
  }
  if (pantry.length === 0) {
    container.innerHTML = `<p class="empty-note">Add a few ingredients above and matching recipes will show up here.</p>`;
    return;
  }

  const scored = recipes
    .map(r => ({ recipe: r, ...scoreRecipe(r, pantry) }))
    .filter(s => s.have.length > 0)
    .sort((a, b) => b.ratio - a.ratio);

  if (scored.length === 0) {
    container.innerHTML = `<p class="empty-note">Nothing matches yet with what you've listed. Try adding a few more staples.</p>`;
    return;
  }

  container.innerHTML = scored.map(s => {
    const pct = Math.round(s.ratio * 100);
    return `
      <article class="result-card">
        <div class="result-head">
          <h3>${escapeHtml(s.recipe.name)}</h3>
          <span class="match-score ${pct === 100 ? 'full' : ''}">${pct}% · ${s.have.length}/${s.have.length + s.missing.length}</span>
        </div>
        ${s.recipe.credit ? `<p class="credit">Recipe by ${escapeHtml(s.recipe.credit)}</p>` : ''}
        <div class="ing-lists">
          <div class="have">
            <h4>You have</h4>
            <ul>${s.have.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
          </div>
          ${s.missing.length ? `<div class="missing"><h4>Still need</h4><ul>${s.missing.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>` : ''}
        </div>
      </article>`;
  }).join('');
}

/* ---------- add recipe: parse + review ---------- */
const captionInput = document.getElementById('caption-input');
const reviewForm = document.getElementById('review-form');

document.getElementById('parse-btn').addEventListener('click', () => {
  const raw = captionInput.value;
  if (!raw.trim()) { toast('Paste a caption first'); return; }
  const parsed = parseCaption(raw);
  document.getElementById('f-name').value = parsed.name;
  document.getElementById('f-credit').value = parsed.credit;
  document.getElementById('f-ingredients').value = parsed.ingredients;
  document.getElementById('f-instructions').value = parsed.instructions;
  document.getElementById('f-link').value = '';
  reviewForm.classList.remove('hidden');
  reviewForm.dataset.editId = '';
  reviewForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

document.getElementById('discard-btn').addEventListener('click', () => {
  reviewForm.classList.add('hidden');
  captionInput.value = '';
});

reviewForm.addEventListener('submit', e => {
  e.preventDefault();
  const recipe = {
    id: reviewForm.dataset.editId || String(Date.now()),
    name: document.getElementById('f-name').value.trim(),
    credit: document.getElementById('f-credit').value.trim(),
    ingredients: document.getElementById('f-ingredients').value.split('\n').map(l => l.trim()).filter(Boolean).join('\n'),
    instructions: document.getElementById('f-instructions').value.trim(),
    link: document.getElementById('f-link').value.trim()
  };
  if (!recipe.name || !recipe.ingredients) { toast('Add a name and at least one ingredient'); return; }

  const list = getRecipes();
  const existingIdx = list.findIndex(r => r.id === recipe.id);
  if (existingIdx !== -1) list[existingIdx] = recipe; else list.push(recipe);
  saveRecipes(list);

  toast(existingIdx !== -1 ? 'Recipe updated' : 'Recipe saved');
  reviewForm.classList.add('hidden');
  reviewForm.reset();
  captionInput.value = '';
  renderLibrary();
});

/* ---------- library ---------- */
function renderLibrary() {
  const list = getRecipes();
  document.getElementById('recipe-count').textContent = list.length;
  const search = document.getElementById('library-search').value.trim().toLowerCase();
  const filtered = search ? list.filter(r => r.name.toLowerCase().includes(search)) : list;
  const container = document.getElementById('library-list');

  if (list.length === 0) {
    container.innerHTML = `<p class="empty-note">Nothing saved yet. Paste your first caption under "Add a recipe."</p>`;
    return;
  }
  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty-note">No recipes match "${escapeHtml(search)}".</p>`;
    return;
  }

  container.innerHTML = filtered.map(r => `
    <div class="library-card" data-id="${r.id}">
      <div class="info">
        <h3>${escapeHtml(r.name)}</h3>
        ${r.credit ? `<p class="credit">Recipe by ${escapeHtml(r.credit)}</p>` : ''}
      </div>
      <div class="actions">
        <button type="button" class="edit-btn">Edit</button>
        <button type="button" class="delete-btn">Delete</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.library-card').dataset.id;
      const r = getRecipes().find(x => x.id === id);
      if (!r) return;
      document.querySelector('.tab-btn[data-tab="add"]').click();
      document.getElementById('f-name').value = r.name;
      document.getElementById('f-credit').value = r.credit;
      document.getElementById('f-ingredients').value = r.ingredients;
      document.getElementById('f-instructions').value = r.instructions;
      document.getElementById('f-link').value = r.link || '';
      reviewForm.classList.remove('hidden');
      reviewForm.dataset.editId = id;
      captionInput.value = '';
    });
  });

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.library-card').dataset.id;
      if (!confirm('Delete this recipe?')) return;
      saveRecipes(getRecipes().filter(r => r.id !== id));
      renderLibrary();
      toast('Recipe deleted');
    });
  });
}

document.getElementById('library-search').addEventListener('input', renderLibrary);

/* ---------- export / import ---------- */
document.getElementById('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(getRecipes(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pantry-planner-recipes.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('import-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      if (!Array.isArray(incoming)) throw new Error('bad format');
      const existing = getRecipes();
      const ids = new Set(existing.map(r => r.id));
      incoming.forEach(r => { if (!ids.has(r.id)) existing.push(r); });
      saveRecipes(existing);
      renderLibrary();
      toast('Backup imported');
    } catch {
      toast('That file doesn\'t look like a valid backup');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------- helpers ---------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- init ---------- */
renderLibrary();
renderPlanResults();
