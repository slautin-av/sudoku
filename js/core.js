// Основа: устройство поля 9×9, быстрый перебор (для проверки единственности решения)
// и генератор. Клетка i = строка*9 + столбец. Кандидаты хранятся битовой маской:
// цифра d — бит 1 << (d-1), все девять цифр — ALL.

export const ALL = 0x1ff;
export const ROW = new Uint8Array(81);
export const COL = new Uint8Array(81);
export const BOX = new Uint8Array(81);
export const UNITS = []; // 27 групп по 9 клеток: 0–8 строки, 9–17 столбцы, 18–26 квадраты
export const CELL_UNITS = []; // для клетки — номера её строки, столбца, квадрата
export const PEERS = []; // для клетки — 20 клеток, которые она «видит»
export const SEES = new Uint8Array(81 * 81);
export const POP = new Uint8Array(512); // сколько цифр в маске
export const DIGITS = []; // маска → список цифр

for (let i = 0; i < 81; i++) {
  ROW[i] = (i / 9) | 0;
  COL[i] = i % 9;
  BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
}
for (let u = 0; u < 27; u++) UNITS.push([]);
for (let i = 0; i < 81; i++) {
  UNITS[ROW[i]].push(i);
  UNITS[9 + COL[i]].push(i);
  UNITS[18 + BOX[i]].push(i);
  CELL_UNITS.push([ROW[i], 9 + COL[i], 18 + BOX[i]]);
}
for (let i = 0; i < 81; i++) {
  const peers = [];
  for (let j = 0; j < 81; j++) {
    if (j !== i && (ROW[i] === ROW[j] || COL[i] === COL[j] || BOX[i] === BOX[j])) {
      peers.push(j);
      SEES[i * 81 + j] = 1;
    }
  }
  PEERS.push(peers);
}
for (let m = 0; m < 512; m++) {
  const ds = [];
  for (let d = 1; d <= 9; d++) if (m & (1 << (d - 1))) ds.push(d);
  POP[m] = ds.length;
  DIGITS.push(ds);
}

export const bit = d => 1 << (d - 1);
export const sees = (a, b) => SEES[a * 81 + b] === 1;

export function parseGrid(str) {
  const g = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = str[i];
    g[i] = ch >= '1' && ch <= '9' ? ch.charCodeAt(0) - 48 : 0;
  }
  return g;
}

export const gridToString = g => Array.from(g, v => (v ? String(v) : '.')).join('');

// Генератор псевдослучайных чисел с зерном — чтобы банк задач можно было воспроизвести.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Перебор с отсечением. Считает решения до limit (обычно 2 — «одно или больше одного»).
// out — сюда кладётся первое найденное решение. rng — случайный порядок цифр (для генератора).
export function countSolutions(grid, limit = 2, out = null, rng = null) {
  const g = Uint8Array.from(grid);
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  for (let i = 0; i < 81; i++) {
    const v = g[i];
    if (!v) continue;
    const b = bit(v);
    if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) return 0; // повтор в данных
    rows[ROW[i]] |= b;
    cols[COL[i]] |= b;
    boxes[BOX[i]] |= b;
  }
  let count = 0;

  function search() {
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & ALL;
      const n = POP[m];
      if (n === 0) return false;
      if (n < bestN) {
        best = i;
        bestMask = m;
        bestN = n;
        if (n === 1) break;
      }
    }
    if (best < 0) {
      count++;
      if (out && count === 1) out.set(g);
      return count >= limit;
    }
    const ds = rng ? shuffle(DIGITS[bestMask].slice(), rng) : DIGITS[bestMask];
    const r = ROW[best], c = COL[best], x = BOX[best];
    for (const d of ds) {
      const b = bit(d);
      g[best] = d;
      rows[r] |= b; cols[c] |= b; boxes[x] |= b;
      if (search()) return true;
      rows[r] ^= b; cols[c] ^= b; boxes[x] ^= b;
    }
    g[best] = 0;
    return false;
  }

  search();
  return count;
}

export function solve(grid) {
  const out = new Uint8Array(81);
  return countSolutions(grid, 2, out) === 1 ? out : null;
}

export function randomSolution(rng) {
  const out = new Uint8Array(81);
  countSolutions(new Uint8Array(81), 1, out, rng);
  return out;
}

// Убирает цифры в случайном порядке, пока решение остаётся единственным.
// minGivens — остановиться, когда открытых цифр осталось столько (0 — до упора, «минимальная» задача).
export function digPuzzle(solution, rng, minGivens = 0) {
  const puz = Uint8Array.from(solution);
  let givens = 81;
  for (const i of shuffle([...Array(81).keys()], rng)) {
    if (givens <= minGivens) break;
    const v = puz[i];
    puz[i] = 0;
    if (countSolutions(puz, 2) !== 1) puz[i] = v;
    else givens--;
  }
  return puz;
}
