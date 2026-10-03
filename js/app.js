// Экран игры: поле, кнопки, меню, таймер, сохранение в памяти телефона.

import { ROW, COL, BOX, DIGITS } from './core.js';
import { LEVELS, TECHNIQUES, TECH_BY_ID } from './logic.js';
import {
  newGame, prepare, setDigit, toggleNote, erase, undo,
  conflicts, digitCounts, DEFAULT_SETTINGS,
} from './game.js';

// ---------- память телефона ----------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('sudoku.' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('sudoku.' + key, JSON.stringify(value)); } catch { /* память недоступна */ }
  },
};

let settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
let stats = store.get('stats', {});
let stock = store.get('stock', {}); // запас готовых головоломок по уровням
let game = store.get('game', null);
if (!game || game.v !== 1 || !Array.isArray(game.values) || game.values.length !== 81) game = null;

let selected = -1;
let notesMode = false;
let paused = false;
let sheetOpen = false;
let sheetCanClose = true;
let installPrompt = null;

const saveGame = () => store.set('game', game);
const levelName = id => LEVELS.find(l => l.id === id)?.name ?? '';

// ---------- подборщик головоломок в фоне ----------

let worker = null;
let reqId = 0;
const pending = new Map();
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const cb = pending.get(e.data.id);
    pending.delete(e.data.id);
    cb?.(e.data.game);
  };
} catch {
  worker = null;
}

async function requestPuzzle(level) {
  if (worker) {
    return new Promise(resolve => {
      const id = ++reqId;
      pending.set(id, resolve);
      worker.postMessage({ level, id });
    });
  }
  const { generate } = await import('./generator.js');
  return generate(level);
}

let filling = false;
async function fillStock() {
  if (filling) return;
  filling = true;
  for (const L of LEVELS) {
    if (stock[L.id]) continue;
    const g = await requestPuzzle(L.id);
    if (g) { stock[L.id] = g; store.set('stock', stock); }
  }
  filling = false;
}

// ---------- поле ----------

const $ = sel => document.querySelector(sel);
const boardEl = $('#board');
const padEl = $('#pad');
const cells = [];
const baseCls = [];

for (let i = 0; i < 81; i++) {
  const el = document.createElement('div');
  baseCls[i] = 'cell' + (COL[i] % 3 === 2 && COL[i] < 8 ? ' br' : '') + (ROW[i] % 3 === 2 && ROW[i] < 8 ? ' bb' : '');
  el.className = baseCls[i];
  el.dataset.i = i;
  boardEl.appendChild(el);
  cells.push(el);
}

for (let d = 1; d <= 9; d++) {
  const b = document.createElement('button');
  b.className = 'key';
  b.dataset.d = d;
  b.innerHTML = `<span class="kd">${d}</span><span class="kc"></span>`;
  padEl.appendChild(b);
}

function notesHtml(mask, focus) {
  if (!mask) return '';
  let html = '<div class="notes">';
  for (let d = 1; d <= 9; d++) {
    const on = mask & (1 << (d - 1));
    html += `<span${on && d === focus ? ' class="hl"' : ''}>${on ? d : ''}</span>`;
  }
  return html + '</div>';
}

function render() {
  const bad = game && settings.showConflicts ? conflicts(game) : new Set();
  const focus = game && selected >= 0 ? game.values[selected] : 0;
  for (let i = 0; i < 81; i++) {
    const el = cells[i];
    const v = game ? game.values[i] : 0;
    let cls = baseCls[i];
    if (game) {
      if (game.givens[i]) cls += ' given';
      else if (v) cls += ' user';
      if (i === selected) cls += ' sel';
      else if (selected >= 0 && (ROW[i] === ROW[selected] || COL[i] === COL[selected] || BOX[i] === BOX[selected])) cls += ' peer';
      if (focus && v === focus && i !== selected) cls += ' same';
      if (bad.has(i)) cls += ' bad';
    }
    el.className = cls;
    const notes = game ? game.notes[i] : 0;
    const key = v ? 'v' + v : 'n' + notes + ':' + (notes & (1 << (focus - 1)) ? focus : 0);
    if (el._key !== key) {
      el._key = key;
      el.innerHTML = v ? `<span class="d">${v}</span>` : notesHtml(notes, focus);
    }
  }

  const counts = game ? digitCounts(game) : new Array(10).fill(0);
  for (const b of padEl.children) {
    const d = +b.dataset.d;
    const left = 9 - counts[d];
    b.querySelector('.kc').textContent = game ? left : '';
    b.classList.toggle('done', !!game && left <= 0);
  }
  padEl.classList.toggle('pad-notes', notesMode);

  $('#btn-notes').setAttribute('aria-pressed', notesMode);
  $('#notes-badge').textContent = notesMode ? 'вкл' : 'выкл';
  $('#btn-undo').disabled = !game || game.done || !game.history.length;
  $('#level-name').textContent = game ? levelName(game.level) : 'Судоку';
  boardEl.classList.toggle('hide', paused);
  $('#paused').hidden = !paused;
  document.body.classList.toggle('is-paused', paused);
  $('#timer').classList.toggle('off', !settings.showTimer || !game);
  renderTimer();
}

function flash(list, kind) {
  for (const i of list) {
    const el = cells[i];
    el.removeAttribute('data-flash');
    void el.offsetWidth; // перезапуск анимации
    el.dataset.flash = kind;
    setTimeout(() => { if (el.dataset.flash === kind) el.removeAttribute('data-flash'); }, 1200);
  }
}

// ---------- время ----------

let runningSince = null;

function shouldRun() {
  return !!game && !game.done && !paused && !sheetOpen && document.visibilityState === 'visible';
}

function syncTimer() {
  const run = shouldRun();
  if (run && runningSince === null) runningSince = performance.now();
  if (!run && runningSince !== null) {
    game.elapsed += performance.now() - runningSince;
    runningSince = null;
    saveGame();
  }
}

function elapsedNow() {
  if (!game) return 0;
  return game.elapsed + (runningSince !== null ? performance.now() - runningSince : 0);
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function renderTimer() {
  $('#timer').textContent = fmtTime(elapsedNow());
}

setInterval(() => { if (runningSince !== null) renderTimer(); }, 500);
// Раз в 15 секунд время записывается в память — на случай, если телефон закроет игру.
setInterval(() => {
  if (runningSince === null) return;
  const now = performance.now();
  game.elapsed += now - runningSince;
  runningSince = now;
  saveGame();
}, 15000);

document.addEventListener('visibilitychange', () => { syncTimer(); render(); });

// ---------- действия ----------

function select(i) {
  if (!game || paused) return;
  selected = i;
  render();
}

function afterMove(res) {
  if (!res) return;
  flash(res.autoPlaced, 'digit');
  flash(res.pairCells, 'notes');
  if (game.done) win();
  else saveGame();
}

function inputDigit(d) {
  if (!game || game.done || paused || selected < 0) return;
  if (notesMode) {
    if (toggleNote(game, selected, d)) saveGame();
    render();
    return;
  }
  const res = setDigit(game, selected, d, settings);
  render();
  afterMove(res);
}

function doErase() {
  if (!game || paused || selected < 0) return;
  if (erase(game, selected)) saveGame();
  render();
}

function doUndo() {
  if (!game || paused) return;
  const changed = undo(game);
  if (!changed) return;
  saveGame();
  render();
  flash(changed, 'undo');
}

function toggleNotesMode() {
  notesMode = !notesMode;
  render();
}

function togglePause() {
  if (!game || game.done) return;
  paused = !paused;
  syncTimer();
  render();
}

function win() {
  syncTimer();
  const s = stats[game.level] || { played: 0, solved: 0, best: null, total: 0 };
  s.solved++;
  s.total += game.elapsed;
  const isBest = s.best === null || game.elapsed < s.best;
  if (isBest) s.best = game.elapsed;
  stats[game.level] = s;
  store.set('stats', stats);
  saveGame();
  setTimeout(() => showWin(isBest), 900);
}

async function startGame(level) {
  let g = stock[level];
  if (g) {
    delete stock[level];
    store.set('stock', stock);
  } else {
    showSheet(`<div class="center"><div class="spinner"></div><p>Подбираю головоломку…</p></div>`, false);
    g = await requestPuzzle(level);
    if (!g) {
      showSheet(`<h2>Не получилось</h2><p>Не удалось подобрать головоломку. Попробуй ещё раз.</p>
        <div class="btn-row"><button class="btn primary" data-act="levels">К уровням</button></div>`, false);
      return;
    }
  }
  game = newGame(g);
  const res = prepare(game, settings);
  selected = -1;
  notesMode = false;
  paused = false;
  const s = stats[level] || { played: 0, solved: 0, best: null, total: 0 };
  s.played++;
  stats[level] = s;
  store.set('stats', stats);
  saveGame();
  closeSheet();
  render();
  flash(res.autoPlaced, 'digit');
  flash(res.pairCells, 'notes');
  fillStock();
}

// ---------- всплывающая панель ----------

const sheetEl = $('#sheet');
const panelEl = $('#sheet-panel');
const backIcon = '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>';

function showSheet(html, canClose = true) {
  panelEl.innerHTML = html;
  panelEl.scrollTop = 0;
  sheetEl.hidden = false;
  sheetOpen = true;
  sheetCanClose = canClose;
  syncTimer();
}

function closeSheet() {
  sheetEl.hidden = true;
  sheetOpen = false;
  syncTimer();
  render();
}

function levelTechs(L) {
  const prev = LEVELS[LEVELS.indexOf(L) - 1];
  const lo = prev ? prev.max : 0;
  return TECHNIQUES.filter(t => t.rating > lo && t.rating <= L.max).map(t => t.name);
}

function showMenu() {
  const hasGame = game && !game.done;
  showSheet(`
    <h2>Судоку</h2>
    <p class="sub">Без рекламы. Без угадывания.</p>
    <div class="list">
      ${hasGame ? `<button class="row-btn primary" data-act="close"><div class="grow"><div class="t">Продолжить</div>
        <div class="s">${levelName(game.level)} · ${fmtTime(elapsedNow())}</div></div></button>` : ''}
      <button class="row-btn" data-act="levels"><div class="grow"><div class="t">Новая игра</div><div class="s">Выбрать уровень</div></div></button>
      <button class="row-btn" data-act="stats"><div class="grow"><div class="t">Статистика</div></div></button>
      <button class="row-btn" data-act="settings"><div class="grow"><div class="t">Настройки</div><div class="s">Автоматика, подсветка, время</div></div></button>
      <button class="row-btn" data-act="about"><div class="grow"><div class="t">Как устроены уровни</div></div></button>
      ${installPrompt ? `<button class="row-btn" data-act="install"><div class="grow"><div class="t">Установить на главный экран</div>
        <div class="s">Значок как у приложения, работает без интернета</div></div></button>` : ''}
    </div>`, !!game);
}

function showLevels() {
  const hasGame = game && !game.done;
  showSheet(`
    <button class="back" data-act="menu">${backIcon}Меню</button>
    <h2>Новая игра</h2>
    <p class="sub">${hasGame ? `Текущая игра (${levelName(game.level)}, ${fmtTime(elapsedNow())}) будет заменена.` : 'Каждая головоломка решается логикой, без догадок.'}</p>
    <div class="list">
      ${LEVELS.map(L => `
        <button class="row-btn" data-act="start" data-level="${L.id}">
          <span class="lv">${L.id}</span>
          <div class="grow"><div class="t">${L.name}</div>
          <div class="s">${L.id === 1 ? '' : '+ '}${levelTechs(L).join(', ')}</div></div>
        </button>`).join('')}
    </div>`, !!game);
}

function showStats() {
  const rows = LEVELS.map(L => {
    const s = stats[L.id] || { played: 0, solved: 0, best: null, total: 0 };
    const avg = s.solved ? fmtTime(s.total / s.solved) : '—';
    return `<tr><td>${L.name}</td><td>${s.played}</td><td>${s.solved}</td><td>${s.best !== null ? fmtTime(s.best) : '—'}</td><td>${avg}</td></tr>`;
  }).join('');
  showSheet(`
    <button class="back" data-act="menu">${backIcon}Меню</button>
    <h2>Статистика</h2>
    <table class="stats">
      <tr><th>Уровень</th><th>Начато</th><th>Решено</th><th>Лучшее</th><th>Среднее</th></tr>
      ${rows}
    </table>`);
}

const SETTINGS_TEXT = [
  ['autoPairNotes', 'Пары в заметки сами', 'В строке, столбце или квадрате осталось две пустые клетки — обе недостающие цифры пишутся в заметки этих клеток.'],
  ['autoPairResolve', 'Пара встаёт сама', 'Две пустые клетки, две недостающие цифры, и одной из них в клетке мешает такая же цифра в строке, столбце или квадрате — обе цифры ставятся на места.'],
  ['autoPairThird', 'Третья клетка сама', 'В строке или столбце три пустые клетки, и две из них — пара из одного квадрата: третья заполняется сама. И наоборот: пара из строки внутри квадрата заполняет третью клетку квадрата.'],
  ['autoLastDigit', 'Девятая цифра сама', 'Восемь одинаковых цифр стоят — девятая встаёт на своё место.'],
  ['autoFinish', 'Дорешать конец', 'Пустых клеток осталось столько или меньше — игра заполняет очевидное сама.'],
  ['autoRemoveNotes', 'Убирать цифру из заметок', 'Поставил цифру — она исчезает из заметок в своей строке, столбце и квадрате.'],
  ['showConflicts', 'Подсвечивать повторы', 'Одинаковые цифры в строке, столбце или квадрате — красным. Ошибки не считаются, игра из-за них не заканчивается.'],
  ['showTimer', 'Показывать время', 'Время всё равно идёт в статистику.'],
];

function showSettings() {
  showSheet(`
    <button class="back" data-act="menu">${backIcon}Меню</button>
    <h2>Настройки</h2>
    <div>
      ${SETTINGS_TEXT.map(([k, t, s]) => `
        <label class="setting">
          <div class="grow"><div class="t">${t}</div><div class="s">${s}</div>
          ${k === 'autoFinish' ? `<div class="stepper">
            <button data-act="finish-minus" aria-label="Меньше">−</button><b id="finish-at">${settings.autoFinishAt}</b>
            <button data-act="finish-plus" aria-label="Больше">+</button></div>` : ''}
          </div>
          <input type="checkbox" class="switch" data-setting="${k}" ${settings[k] ? 'checked' : ''}>
        </label>`).join('')}
    </div>`);
}

function showAbout() {
  showSheet(`
    <button class="back" data-act="menu">${backIcon}Меню</button>
    <h2>Как устроены уровни</h2>
    <p>Перед тем как показать головоломку, игра решает её сама — только логическими приёмами, как решает человек.
      Если без догадки не обойтись, головоломка выбрасывается. Так отсеивается примерно каждая четвёртая.</p>
    <p>Решение всегда одно. Уровень определяется самым трудным приёмом, который понадобился.</p>
    ${LEVELS.map(L => `<h3>${L.id}. ${L.name}</h3><div class="chips">${levelTechs(L).map(n => `<span class="chip">${n}</span>`).join('')}</div>`).join('')}
    <p style="margin-top:20px">На каждом уровне могут понадобиться и все приёмы предыдущих.</p>`);
}

function showWin(isBest) {
  const names = TECHNIQUES.filter(t => game.used.includes(t.id)).map(t => t.name);
  showSheet(`
    <div class="center">
      <h2>Решено!</h2>
      <div class="big-time">${fmtTime(game.elapsed)}</div>
      <p class="sub">${levelName(game.level)}${isBest ? ' · лучшее время на уровне' : ''}</p>
    </div>
    <h3>Понадобились приёмы</h3>
    <div class="chips">${names.map(n => `<span class="chip">${n}</span>`).join('')}</div>
    <div class="btn-row">
      <button class="btn" data-act="levels">Другой уровень</button>
      <button class="btn primary" data-act="start" data-level="${game.level}">Ещё ${levelName(game.level).toLowerCase()}</button>
    </div>`);
}

panelEl.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close') closeSheet();
  else if (act === 'menu') showMenu();
  else if (act === 'levels') showLevels();
  else if (act === 'stats') showStats();
  else if (act === 'settings') showSettings();
  else if (act === 'about') showAbout();
  else if (act === 'start') startGame(+el.dataset.level);
  else if (act === 'install' && installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    showMenu();
  } else if (act === 'finish-minus' || act === 'finish-plus') {
    e.preventDefault();
    const n = settings.autoFinishAt + (act === 'finish-plus' ? 1 : -1);
    settings.autoFinishAt = Math.min(15, Math.max(1, n));
    store.set('settings', settings);
    $('#finish-at').textContent = settings.autoFinishAt;
  }
});

panelEl.addEventListener('change', e => {
  const k = e.target.dataset.setting;
  if (!k) return;
  settings[k] = e.target.checked;
  store.set('settings', settings);
  render();
});

$('#sheet-backdrop').addEventListener('click', () => { if (sheetCanClose) closeSheet(); });

// ---------- кнопки и клавиатура ----------

boardEl.addEventListener('click', e => {
  const c = e.target.closest('.cell');
  if (c) select(+c.dataset.i);
});
padEl.addEventListener('click', e => {
  const b = e.target.closest('.key');
  if (b) inputDigit(+b.dataset.d);
});
$('#btn-undo').addEventListener('click', doUndo);
$('#btn-erase').addEventListener('click', doErase);
$('#btn-notes').addEventListener('click', toggleNotesMode);
$('#btn-menu').addEventListener('click', showMenu);
$('#btn-pause').addEventListener('click', togglePause);
$('#btn-resume').addEventListener('click', togglePause);

document.addEventListener('keydown', e => {
  if (sheetOpen) {
    if (e.key === 'Escape' && sheetCanClose) closeSheet();
    return;
  }
  if (e.key >= '1' && e.key <= '9') inputDigit(+e.key);
  else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') doErase();
  else if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') toggleNotesMode();
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'я')) doUndo();
  else if (e.key.startsWith('Arrow') && game) {
    const i = selected < 0 ? 40 : selected;
    const r = ROW[i] + (e.key === 'ArrowDown') - (e.key === 'ArrowUp');
    const c = COL[i] + (e.key === 'ArrowRight') - (e.key === 'ArrowLeft');
    select(((r + 9) % 9) * 9 + ((c + 9) % 9));
    e.preventDefault();
  }
});

// ---------- установка как приложение ----------

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Пришла новая версия — сохраняем игру и перезапускаемся уже на ней.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (game && runningSince !== null) {
      game.elapsed += performance.now() - runningSince;
      runningSince = performance.now();
    }
    if (game) saveGame();
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ---------- старт ----------

render();
syncTimer();
if (!game) showLevels();
else if (game.done) showMenu();
fillStock();

// Для проверки из тестов: доступ к состоянию.
window.__sudoku = { get game() { return game; }, get settings() { return settings; }, DIGITS };
