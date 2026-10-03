// «Решатель как человек»: решает головоломку только логическими приёмами,
// от простых к сложным. Каждый шаг — один приём. Если приёмов не хватает,
// головоломка в игру не попадает: значит, человеку пришлось бы угадывать.

import { ALL, UNITS, CELL_UNITS, PEERS, ROW, COL, BOX, POP, DIGITS, bit, sees } from './core.js';

const LINES = [...Array(18).keys()]; // строки 0–8 и столбцы 9–17

export function createState(grid) {
  const values = Uint8Array.from(grid);
  const cand = new Uint16Array(81);
  for (let i = 0; i < 81; i++) {
    if (values[i]) continue;
    let m = ALL;
    for (const p of PEERS[i]) if (values[p]) m &= ~bit(values[p]);
    cand[i] = m;
  }
  return { values, cand };
}

function place(st, i, d) {
  st.values[i] = d;
  st.cand[i] = 0;
  const b = ~bit(d);
  for (const p of PEERS[i]) st.cand[p] &= b;
}

// Ячейки группы, где цифра ещё может стоять (маска по позициям 0–8 внутри группы).
function positions(st, u, b) {
  let m = 0;
  const cells = UNITS[u];
  for (let k = 0; k < 9; k++) if (st.cand[cells[k]] & b) m |= 1 << k;
  return m;
}

function placedIn(st, u, d) {
  for (const i of UNITS[u]) if (st.values[i] === d) return true;
  return false;
}

function combos(arr, k, start = 0, acc = [], out = []) {
  if (acc.length === k) { out.push(acc.slice()); return out; }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    combos(arr, k, i + 1, acc, out);
    acc.pop();
  }
  return out;
}

// Собирает вычёркивания: [клетка, маска убираемых цифр], только реально существующие.
function elims(st, list) {
  const out = [];
  for (const [i, m] of list) {
    const real = st.cand[i] & m;
    if (real) out.push([i, real]);
  }
  return out;
}

// ---------- Одиночки ----------

function hiddenSingle(st) {
  for (let u = 0; u < 27; u++) {
    for (let d = 1; d <= 9; d++) {
      const pos = positions(st, u, bit(d));
      if (POP[pos] === 1 && !placedIn(st, u, d)) {
        return { place: [[UNITS[u][31 - Math.clz32(pos)], d]] };
      }
    }
  }
  return null;
}

function nakedSingle(st) {
  for (let i = 0; i < 81; i++) {
    if (!st.values[i] && POP[st.cand[i]] === 1) return { place: [[i, DIGITS[st.cand[i]][0]]] };
  }
  return null;
}

// ---------- Пересечения квадрата и линии ----------

function pointing(st) {
  for (let x = 0; x < 9; x++) {
    const u = 18 + x;
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      const cells = UNITS[u].filter(i => st.cand[i] & b);
      if (cells.length < 2) continue;
      for (const lineOf of [ROW, COL]) {
        const line = lineOf[cells[0]];
        if (cells.every(i => lineOf[i] === line)) {
          const lineUnit = lineOf === ROW ? line : 9 + line;
          const e = elims(st, UNITS[lineUnit].filter(i => BOX[i] !== x).map(i => [i, b]));
          if (e.length) return { elim: e };
        }
      }
    }
  }
  return null;
}

function claiming(st) {
  for (const u of LINES) {
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      const cells = UNITS[u].filter(i => st.cand[i] & b);
      if (cells.length < 2) continue;
      const x = BOX[cells[0]];
      if (cells.every(i => BOX[i] === x)) {
        const e = elims(st, UNITS[18 + x].filter(i => !UNITS[u].includes(i)).map(i => [i, b]));
        if (e.length) return { elim: e };
      }
    }
  }
  return null;
}

// ---------- Открытые и скрытые группы (пары, тройки, четвёрки) ----------

function nakedSubset(k) {
  return st => {
    for (let u = 0; u < 27; u++) {
      const pool = UNITS[u].filter(i => !st.values[i] && POP[st.cand[i]] >= 2 && POP[st.cand[i]] <= k);
      if (pool.length < k) continue;
      for (const set of combos(pool, k)) {
        let m = 0;
        for (const i of set) m |= st.cand[i];
        if (POP[m] !== k) continue;
        const e = elims(st, UNITS[u].filter(i => !st.values[i] && !set.includes(i)).map(i => [i, m]));
        if (e.length) return { elim: e };
      }
    }
    return null;
  };
}

function hiddenSubset(k) {
  return st => {
    for (let u = 0; u < 27; u++) {
      const pos = [];
      const ds = [];
      for (let d = 1; d <= 9; d++) {
        const p = positions(st, u, bit(d));
        if (POP[p] >= 2 && POP[p] <= k) { ds.push(d); pos[d] = p; }
      }
      if (ds.length < k) continue;
      for (const set of combos(ds, k)) {
        let cellsMask = 0;
        let digitMask = 0;
        for (const d of set) { cellsMask |= pos[d]; digitMask |= bit(d); }
        if (POP[cellsMask] !== k) continue;
        const list = [];
        for (let c = 0; c < 9; c++) if (cellsMask & (1 << c)) list.push([UNITS[u][c], ~digitMask & ALL]);
        const e = elims(st, list);
        if (e.length) return { elim: e };
      }
    }
    return null;
  };
}

// ---------- «Рыбы»: X-Wing, Swordfish, Jellyfish ----------

function fish(k) {
  return st => {
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      for (const base of [0, 9]) { // 0 — опора на строки, 9 — на столбцы
        const cover = base === 0 ? 9 : 0;
        const lines = [];
        const masks = [];
        for (let l = 0; l < 9; l++) {
          const p = positions(st, base + l, b);
          if (POP[p] >= 2 && POP[p] <= k) { lines.push(l); masks[l] = p; }
        }
        if (lines.length < k) continue;
        for (const set of combos(lines, k)) {
          let m = 0;
          for (const l of set) m |= masks[l];
          if (POP[m] !== k) continue;
          const list = [];
          for (let c = 0; c < 9; c++) {
            if (!(m & (1 << c))) continue;
            for (const i of UNITS[cover + c]) {
              const lineIdx = base === 0 ? ROW[i] : COL[i];
              if (!set.includes(lineIdx)) list.push([i, b]);
            }
          }
          const e = elims(st, list);
          if (e.length) return { elim: e };
        }
      }
    }
    return null;
  };
}

// ---------- Крылья: XY-Wing, XYZ-Wing, W-Wing ----------

function xyWing(st) {
  for (let p = 0; p < 81; p++) {
    const pm = st.cand[p];
    if (POP[pm] !== 2) continue;
    const wings = PEERS[p].filter(i => POP[st.cand[i]] === 2 && POP[st.cand[i] & pm] === 1);
    for (let a = 0; a < wings.length; a++) {
      for (let c = a + 1; c < wings.length; c++) {
        const am = st.cand[wings[a]];
        const cm = st.cand[wings[c]];
        const z = am & cm & ~pm;
        if (POP[z] !== 1) continue;
        if (((am | cm) & pm) !== pm || (am & pm) === (cm & pm)) continue;
        const list = [];
        for (let i = 0; i < 81; i++) {
          if (i !== wings[a] && i !== wings[c] && sees(i, wings[a]) && sees(i, wings[c])) list.push([i, z]);
        }
        const e = elims(st, list);
        if (e.length) return { elim: e };
      }
    }
  }
  return null;
}

function xyzWing(st) {
  for (let p = 0; p < 81; p++) {
    const pm = st.cand[p];
    if (POP[pm] !== 3) continue;
    const wings = PEERS[p].filter(i => POP[st.cand[i]] === 2 && (st.cand[i] & ~pm) === 0);
    for (let a = 0; a < wings.length; a++) {
      for (let c = a + 1; c < wings.length; c++) {
        const am = st.cand[wings[a]];
        const cm = st.cand[wings[c]];
        const z = am & cm;
        if (POP[z] !== 1 || (am | cm) !== pm) continue;
        const list = [];
        for (let i = 0; i < 81; i++) {
          if (i === p || i === wings[a] || i === wings[c]) continue;
          if (sees(i, p) && sees(i, wings[a]) && sees(i, wings[c])) list.push([i, z]);
        }
        const e = elims(st, list);
        if (e.length) return { elim: e };
      }
    }
  }
  return null;
}

// Сильные связи: группы, где цифра может стоять ровно в двух клетках.
function strongLinks(st, b) {
  const links = [];
  for (let u = 0; u < 27; u++) {
    const cells = UNITS[u].filter(i => st.cand[i] & b);
    if (cells.length === 2) links.push({ u, a: cells[0], b: cells[1] });
  }
  return links;
}

function wWing(st) {
  const bivalue = [];
  for (let i = 0; i < 81; i++) if (POP[st.cand[i]] === 2) bivalue.push(i);
  for (let a = 0; a < bivalue.length; a++) {
    for (let c = a + 1; c < bivalue.length; c++) {
      const p = bivalue[a], q = bivalue[c];
      const m = st.cand[p];
      if (st.cand[q] !== m || sees(p, q)) continue;
      for (const x of DIGITS[m]) {
        const bx = bit(x);
        const y = m & ~bx;
        for (const L of strongLinks(st, bx)) {
          if ([L.a, L.b].some(i => i === p || i === q)) continue;
          const ok = (sees(L.a, p) && sees(L.b, q)) || (sees(L.a, q) && sees(L.b, p));
          if (!ok) continue;
          const list = [];
          for (let i = 0; i < 81; i++) {
            if (i !== p && i !== q && sees(i, p) && sees(i, q)) list.push([i, y]);
          }
          const e = elims(st, list);
          if (e.length) return { elim: e };
        }
      }
    }
  }
  return null;
}

// ---------- Цепочки по одной цифре: небоскрёб, воздушный змей, рыба-тюрбо ----------

const unitKind = u => (u < 9 ? 'row' : u < 18 ? 'col' : 'box');

function turbot(st) {
  const found = { sky: null, kite: null, turbot: null };
  for (let d = 1; d <= 9; d++) {
    const b = bit(d);
    const links = strongLinks(st, b);
    for (let s = 0; s < links.length; s++) {
      for (let t = 0; t < links.length; t++) {
        if (s === t) continue;
        const L1 = links[s], L2 = links[t];
        for (const [a1, a2] of [[L1.a, L1.b], [L1.b, L1.a]]) {
          for (const [b1, b2] of [[L2.a, L2.b], [L2.b, L2.a]]) {
            const cells = new Set([a1, a2, b1, b2]);
            if (cells.size !== 4 || !sees(a2, b1)) continue;
            const list = [];
            for (let i = 0; i < 81; i++) {
              if (i !== a1 && i !== b2 && sees(i, a1) && sees(i, b2)) list.push([i, b]);
            }
            const e = elims(st, list);
            if (!e.length) continue;
            const k1 = unitKind(L1.u), k2 = unitKind(L2.u);
            const parallel = (k1 === 'row' && k2 === 'row' && COL[a2] === COL[b1]) ||
              (k1 === 'col' && k2 === 'col' && ROW[a2] === ROW[b1]);
            const crossed = k1 !== k2 && k1 !== 'box' && k2 !== 'box' && BOX[a2] === BOX[b1];
            if (parallel) { if (!found.sky) found.sky = e; }
            else if (crossed) { if (!found.kite) found.kite = e; }
            else if (!found.turbot) found.turbot = e;
          }
        }
      }
    }
  }
  return found;
}

const skyscraper = st => { const f = turbot(st).sky; return f ? { elim: f } : null; };
const kite = st => { const f = turbot(st).kite; return f ? { elim: f } : null; };
const turbotFish = st => { const f = turbot(st).turbot; return f ? { elim: f } : null; };

// ---------- Раскраска по одной цифре ----------

function coloring(st) {
  for (let d = 1; d <= 9; d++) {
    const b = bit(d);
    const adj = new Map();
    for (const L of strongLinks(st, b)) {
      if (!adj.has(L.a)) adj.set(L.a, new Set());
      if (!adj.has(L.b)) adj.set(L.b, new Set());
      adj.get(L.a).add(L.b);
      adj.get(L.b).add(L.a);
    }
    const color = new Map();
    for (const start of adj.keys()) {
      if (color.has(start)) continue;
      const groups = [[], []];
      const queue = [start];
      color.set(start, 0);
      while (queue.length) {
        const i = queue.shift();
        groups[color.get(i)].push(i);
        for (const j of adj.get(i)) {
          if (!color.has(j)) { color.set(j, 1 - color.get(i)); queue.push(j); }
        }
      }
      if (groups[0].length + groups[1].length < 3) continue;
      // Цвет, две клетки которого видят друг друга, ложный: цифры там нет.
      for (const g of [0, 1]) {
        const cells = groups[g];
        let clash = false;
        for (let x = 0; x < cells.length && !clash; x++) {
          for (let y = x + 1; y < cells.length; y++) if (sees(cells[x], cells[y])) { clash = true; break; }
        }
        if (clash) return { elim: elims(st, cells.map(i => [i, b])) };
      }
      // Клетка вне цепочки, которая видит оба цвета, цифру содержать не может.
      const comp = new Set(groups[0].concat(groups[1]));
      const list = [];
      for (let i = 0; i < 81; i++) {
        if (!(st.cand[i] & b) || comp.has(i)) continue;
        if (groups[0].some(c => sees(i, c)) && groups[1].some(c => sees(i, c))) list.push([i, b]);
      }
      const e = elims(st, list);
      if (e.length) return { elim: e };
    }
  }
  return null;
}

// ---------- Приёмы по возрастанию трудности ----------
// rating — шкала в духе Sudoku Explainer: чем больше, тем труднее заметить.

export const TECHNIQUES = [
  { id: 'hs', name: 'Скрытая одиночка', rating: 1.5, fn: hiddenSingle },
  { id: 'ns', name: 'Последний кандидат', rating: 2.3, fn: nakedSingle },
  { id: 'pt', name: 'Указывающая пара', rating: 2.6, fn: pointing },
  { id: 'cl', name: 'Блок и линия', rating: 2.8, fn: claiming },
  { id: 'np', name: 'Открытая пара', rating: 3.0, fn: nakedSubset(2) },
  { id: 'xw', name: 'X-Wing', rating: 3.2, fn: fish(2) },
  { id: 'hp', name: 'Скрытая пара', rating: 3.4, fn: hiddenSubset(2) },
  { id: 'nt', name: 'Открытая тройка', rating: 3.6, fn: nakedSubset(3) },
  { id: 'sf', name: 'Swordfish', rating: 3.8, fn: fish(3) },
  { id: 'ht', name: 'Скрытая тройка', rating: 4.0, fn: hiddenSubset(3) },
  { id: 'xy', name: 'XY-Wing', rating: 4.2, fn: xyWing },
  { id: 'xz', name: 'XYZ-Wing', rating: 4.4, fn: xyzWing },
  { id: 'nq', name: 'Открытая четвёрка', rating: 5.0, fn: nakedSubset(4) },
  { id: 'jf', name: 'Jellyfish', rating: 5.2, fn: fish(4) },
  { id: 'hq', name: 'Скрытая четвёрка', rating: 5.4, fn: hiddenSubset(4) },
  { id: 'sk', name: 'Небоскрёб', rating: 5.6, fn: skyscraper },
  { id: 'kt', name: 'Воздушный змей', rating: 5.6, fn: kite },
  { id: 'tf', name: 'Рыба-тюрбо', rating: 5.8, fn: turbotFish },
  { id: 'ww', name: 'W-Wing', rating: 5.9, fn: wWing },
  { id: 'co', name: 'Раскраска', rating: 6.0, fn: coloring },
];

export const TECH_BY_ID = Object.fromEntries(TECHNIQUES.map(t => [t.id, t]));

// Уровни: потолок трудности самого сложного приёма, который понадобился.
export const LEVELS = [
  { id: 1, name: 'Лёгкий', max: 1.5 },
  { id: 2, name: 'Средний', max: 2.8 },
  { id: 3, name: 'Сложный', max: 4.0 },
  { id: 4, name: 'Эксперт', max: 5.4 },
  { id: 5, name: 'Мастер', max: 6.0 },
];

export function levelOf(rating) {
  for (const L of LEVELS) if (rating <= L.max) return L.id;
  return 0;
}

// Решает головоломку приёмами. solution — если передано, каждый шаг сверяется с
// настоящим решением (так тесты ловят ошибку в любом приёме).
export function grade(grid, solution = null) {
  const st = createState(grid);
  const used = new Map();
  let maxRating = 0;
  let steps = 0;
  for (;;) {
    let empty = 0;
    for (let i = 0; i < 81; i++) if (!st.values[i]) empty++;
    if (!empty) break;
    let step = null;
    let tech = null;
    for (const t of TECHNIQUES) {
      step = t.fn(st);
      if (step) { tech = t; break; }
    }
    if (!step) {
      return { solved: false, maxRating: Infinity, level: 0, used: [...used.keys()], steps };
    }
    steps++;
    used.set(tech.id, (used.get(tech.id) || 0) + 1);
    if (tech.rating > maxRating) maxRating = tech.rating;
    if (step.place) {
      for (const [i, d] of step.place) {
        if (solution && solution[i] !== d) throw new Error(`${tech.id}: ставит ${d} в клетку ${i}, а должно быть ${solution[i]}`);
        place(st, i, d);
      }
    }
    if (step.elim) {
      for (const [i, m] of step.elim) {
        if (solution && m & bit(solution[i])) throw new Error(`${tech.id}: вычёркивает верную цифру ${solution[i]} в клетке ${i}`);
        st.cand[i] &= ~m;
      }
    }
  }
  return { solved: true, maxRating, level: levelOf(maxRating), used: [...used.keys()], steps };
}
