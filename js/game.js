// Правила игры без экрана: ходы, заметки, отмена и автоматика, экономящая время.
// Всё состояние — простой объект, который целиком сохраняется в памяти телефона.

import { ALL, UNITS, CELL_UNITS, PEERS, BOX, POP, DIGITS, bit } from './core.js';

export const DEFAULT_SETTINGS = {
  autoRemoveNotes: true, // поставил цифру — она исчезает из заметок соседей
  autoPairNotes: true, // в строке/столбце/квадрате две пустые клетки — пара пишется в заметки
  autoPairResolve: true, // одной цифре пары клетке мешает такая же цифра на доске — пара встаёт на места
  autoPairThird: true, // пара из квадрата лежит в линии с тремя пустыми — третья клетка заполняется (и наоборот)
  autoLastDigit: true, // восемь одинаковых цифр стоят — девятая встаёт сама
  autoFinish: true, // осталось мало клеток — игра дорешивает сама
  autoFinishAt: 5,
  showConflicts: true, // повтор цифры в строке/столбце/квадрате — красным
  showTimer: true,
};

const HISTORY_LIMIT = 500;

export function newGame(g) {
  const values = Array.from(g.puzzle, ch => (ch === '.' ? 0 : +ch));
  const game = {
    v: 1,
    puzzle: g.puzzle,
    solution: g.solution,
    level: g.level,
    rating: g.rating,
    used: g.used,
    givens: values.map(Boolean),
    values,
    notes: new Array(81).fill(0),
    elapsed: 0,
    done: false,
    history: [],
  };
  return game;
}

// Автоматика на старте (пары в заметки, девятая цифра) — без записи в историю.
export function prepare(game, settings) {
  const mv = begin(game);
  const placed = [];
  for (let i = 0; i < 81; i++) if (game.values[i]) placed.push(i);
  const res = settle(mv, placed, settings, true);
  game.history = [];
  return res;
}

// ---------- запись хода (для отмены) ----------

function begin(game) {
  return { game, changes: new Map() };
}

function write(mv, i, value, notes) {
  const g = mv.game;
  if (!mv.changes.has(i)) mv.changes.set(i, [g.values[i], g.notes[i]]);
  g.values[i] = value;
  g.notes[i] = notes;
}

function commit(mv) {
  const g = mv.game;
  const list = [];
  for (const [i, [v, n]] of mv.changes) if (g.values[i] !== v || g.notes[i] !== n) list.push([i, v, n]);
  if (!list.length) return false;
  g.history.push(list);
  if (g.history.length > HISTORY_LIMIT) g.history.shift();
  return true;
}

// ---------- проверки ----------

export function conflicts(game) {
  const bad = new Set();
  for (const cells of UNITS) {
    const seen = new Map();
    for (const i of cells) {
      const v = game.values[i];
      if (!v) continue;
      if (seen.has(v)) { bad.add(i); bad.add(seen.get(v)); } else seen.set(v, i);
    }
  }
  return bad;
}

export function digitCounts(game) {
  const counts = new Array(10).fill(0);
  for (const v of game.values) if (v) counts[v]++;
  return counts;
}

export function emptyCount(game) {
  let n = 0;
  for (const v of game.values) if (!v) n++;
  return n;
}

export function isSolved(game) {
  return emptyCount(game) === 0 && conflicts(game).size === 0;
}

// Какие цифры уже стоят в группе.
function presentMask(game, u) {
  let m = 0;
  for (const i of UNITS[u]) if (game.values[i]) m |= bit(game.values[i]);
  return m;
}

// Если в группе ровно две пустые клетки — маска двух недостающих цифр, иначе 0.
function pairMask(game, u) {
  let empty = 0;
  for (const i of UNITS[u]) if (!game.values[i]) empty++;
  if (empty !== 2) return 0;
  const missing = ALL & ~presentMask(game, u);
  return POP[missing] === 2 ? missing : 0;
}

// Девятая цифра: где ей быть, если восемь таких уже стоят без повторов. Иначе -1.
function lastDigitCell(game, d) {
  let count = 0;
  for (const v of game.values) if (v === d) count++;
  if (count !== 8) return -1;
  const missingIn = base => {
    let found = -1;
    for (let k = 0; k < 9; k++) {
      if (UNITS[base + k].some(i => game.values[i] === d)) continue;
      if (found >= 0) return -2; // не хватает в двух местах — значит где-то повтор
      found = k;
    }
    return found;
  };
  const r = missingIn(0), c = missingIn(9), x = missingIn(18);
  if (r < 0 || c < 0 || x < 0) return -1;
  const t = r * 9 + c;
  return BOX[t] === x && !game.values[t] ? t : -1;
}

// Может ли цифра стоять в клетке, судя по цифрам на доске.
const allowed = (game, c, d) => PEERS[c].every(p => game.values[p] !== d);

// Выводы из пар — только по цифрам на доске, не по заметкам: случайное касание
// в заметках никогда не приведёт к неверной автоматической цифре.
// Возвращает список [клетка, цифра] или null.
function pairStep(game, s) {
  for (let u = 0; u < 27; u++) {
    const pair = pairMask(game, u);
    if (!pair) continue;
    const [c1, c2] = UNITS[u].filter(i => !game.values[i]);
    const [a, b] = DIGITS[pair];
    if (s.autoPairResolve) {
      // Клетке c1 мешает a → в ней b, а в c2 — a (и наоборот).
      const ok1 = [a, b].filter(d => allowed(game, c1, d));
      const ok2 = [a, b].filter(d => allowed(game, c2, d));
      if (ok1.length && ok2.length && (ok1.length === 1 || ok2.length === 1)) {
        const d1 = ok1.length === 1 ? ok1[0] : (ok2[0] === a ? b : a);
        const d2 = d1 === a ? b : a;
        if (ok1.includes(d1) && ok2.includes(d2)) return [[c1, d1], [c2, d2]];
      }
    }
    if (s.autoPairThird) {
      // Обе клетки пары лежат ещё в одной группе, где пустых три: третья получает оставшуюся цифру.
      for (const v of CELL_UNITS[c1]) {
        if (v === u || !CELL_UNITS[c2].includes(v)) continue;
        const empty = UNITS[v].filter(i => !game.values[i]);
        if (empty.length !== 3) continue;
        const missing = ALL & ~presentMask(game, v);
        const rest = missing & ~pair;
        const t = empty.find(i => i !== c1 && i !== c2);
        if ((missing & pair) === pair && POP[rest] === 1 && allowed(game, t, DIGITS[rest][0])) {
          return [[t, DIGITS[rest][0]]];
        }
      }
    }
  }
  return null;
}

// Дорешивание: на копии доски ставим очевидные цифры (у клетки один вариант или
// у цифры одно место). Принимаем, только если доска заполнилась целиком без противоречий.
function finishPlan(game) {
  const vals = game.values.slice();
  const plan = [];
  for (;;) {
    let step = null;
    for (let i = 0; i < 81 && !step; i++) {
      if (vals[i]) continue;
      let m = ALL;
      for (const p of PEERS[i]) if (vals[p]) m &= ~bit(vals[p]);
      if (POP[m] === 0) return null;
      if (POP[m] === 1) step = [i, DIGITS[m][0]];
    }
    for (let u = 0; u < 27 && !step; u++) {
      for (let d = 1; d <= 9 && !step; d++) {
        if (UNITS[u].some(i => vals[i] === d)) continue;
        const spots = UNITS[u].filter(i => !vals[i] && PEERS[i].every(p => vals[p] !== d));
        if (spots.length === 1) step = [spots[0], d];
      }
    }
    if (!step) break;
    vals[step[0]] = step[1];
    plan.push(step);
  }
  return vals.every(Boolean) ? plan : null;
}

// После постановки цифр прогоняет всю автоматику, пока она что-то меняет.
// Возвращает, какие клетки заполнены автоматически и где появились заметки-пары.
function settle(mv, placed, s, initial = false) {
  const game = mv.game;
  const autoPlaced = [];
  const pairCells = new Set();
  const queue = placed.slice();
  const unitsToCheck = new Set();

  const autoPlace = (t, d) => { write(mv, t, d, 0); autoPlaced.push(t); queue.push(t); };

  const run = () => {
    while (queue.length) {
      const c = queue.shift();
      const d = game.values[c];
      if (!d) continue;
      if (s.autoRemoveNotes) {
        const b = bit(d);
        for (const p of PEERS[c]) {
          if (!game.values[p] && game.notes[p] & b) write(mv, p, 0, game.notes[p] & ~b);
        }
      }
      for (const u of CELL_UNITS[c]) unitsToCheck.add(u);
      if (s.autoLastDigit) {
        const t = lastDigitCell(game, d);
        if (t >= 0) autoPlace(t, d);
      }
    }
  };

  run();
  if (initial && s.autoLastDigit) {
    for (let d = 1; d <= 9; d++) {
      const t = lastDigitCell(game, d);
      if (t >= 0) autoPlace(t, d);
    }
    run();
  }

  // Пары раскладываются и третьи клетки заполняются, пока есть что делать.
  // При видимом повторе на доске — не трогаем ничего: сначала игрок исправит свою цифру.
  if (s.autoPairResolve || s.autoPairThird) {
    for (let guard = 0; guard < 81 && conflicts(game).size === 0; guard++) {
      const step = pairStep(game, s);
      if (!step) break;
      for (const [t, d] of step) autoPlace(t, d);
      run();
    }
  }

  if (s.autoFinish && emptyCount(game) <= s.autoFinishAt && emptyCount(game) > 0 && conflicts(game).size === 0) {
    const plan = finishPlan(game);
    if (plan) {
      for (const [i, d] of plan) { write(mv, i, d, 0); autoPlaced.push(i); }
    }
  }

  if (s.autoPairNotes && emptyCount(game) > 0) {
    const units = initial ? [...Array(27).keys()] : [...unitsToCheck];
    for (const u of units) {
      const pair = pairMask(game, u);
      if (!pair) continue;
      for (const c of UNITS[u]) {
        if (game.values[c]) continue;
        let m = pair;
        for (const u2 of CELL_UNITS[c]) {
          const p2 = u2 === u ? 0 : pairMask(game, u2);
          if (p2 && m & p2) m &= p2;
        }
        // Если игрок уже сам вычеркнул одну из цифр пары — его вычёркивание сохраняем.
        const own = game.notes[c] & m;
        if (game.notes[c] && own) m = own;
        if (game.notes[c] !== m) { write(mv, c, 0, m); pairCells.add(c); }
      }
    }
  }

  if (emptyCount(game) === 0 && conflicts(game).size === 0) game.done = true;
  return { autoPlaced, pairCells: [...pairCells] };
}

// ---------- действия игрока ----------

export function setDigit(game, i, d, s) {
  if (game.done || game.givens[i]) return null;
  const mv = begin(game);
  if (game.values[i] === d) {
    write(mv, i, 0, 0); // повторное нажатие той же цифры — убрать её
    commit(mv);
    return { autoPlaced: [], pairCells: [] };
  }
  write(mv, i, d, 0);
  const res = settle(mv, [i], s);
  commit(mv);
  return res;
}

export function toggleNote(game, i, d) {
  if (game.done || game.values[i]) return false;
  const mv = begin(game);
  write(mv, i, 0, game.notes[i] ^ bit(d));
  return commit(mv);
}

export function erase(game, i) {
  if (game.done || game.givens[i]) return false;
  if (!game.values[i] && !game.notes[i]) return false;
  const mv = begin(game);
  write(mv, i, 0, 0);
  return commit(mv);
}

export function undo(game) {
  if (game.done || !game.history.length) return null;
  const list = game.history.pop();
  for (const [i, v, n] of list) {
    game.values[i] = v;
    game.notes[i] = n;
  }
  return list.map(x => x[0]);
}
