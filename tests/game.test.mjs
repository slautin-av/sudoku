// Автоматика игры: пары в заметки, девятая цифра, дорешивание, отмена.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, prepare, setDigit, toggleNote, erase, undo, conflicts, DEFAULT_SETTINGS } from '../js/game.js';
import { DIGITS, bit } from '../js/core.js';

const SOL = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const S = { ...DEFAULT_SETTINGS };
const without = cells => SOL.split('').map((ch, i) => (cells.includes(i) ? '.' : ch)).join('');
const make = (cells, settings = S) => {
  const g = newGame({ puzzle: without(cells), solution: SOL, level: 3, rating: 3, used: [] });
  prepare(g, settings);
  return g;
};
const notes = (g, i) => DIGITS[g.notes[i]];
const box0 = [0, 1, 2, 9, 10, 11, 18, 19, 20];

const NOTES_ONLY = { ...S, autoLastDigit: false, autoPairResolve: false, autoPairThird: false };

test('две пустые клетки в строке и в столбце — пара сама пишется в заметки', () => {
  const s = NOTES_ONLY;
  const g = make(box0, s);
  assert.deepEqual(g.notes.filter(Boolean), [], 'на старте пар нет');
  setDigit(g, 0, 5, s);
  assert.deepEqual(notes(g, 1), [3, 4]); // строка 0: не хватает 3 и 4
  assert.deepEqual(notes(g, 2), [3, 4]);
  assert.deepEqual(notes(g, 9), [1, 6]); // столбец 0: не хватает 6 и 1
  assert.deepEqual(notes(g, 18), [1, 6]);
});

test('свои вычёркивания игрока внутри пары сохраняются', () => {
  const s = NOTES_ONLY;
  const g = make(box0, s);
  toggleNote(g, 1, 3); // игрок сам решил, что в клетке 1 только 3
  setDigit(g, 0, 5, s);
  assert.deepEqual(notes(g, 1), [3]);
  assert.deepEqual(notes(g, 2), [3, 4]);
});

test('восьмая тройка поставлена — девятая встаёт сама', () => {
  const g = make([...Array(18).keys()]); // пустые строки 0 и 1
  const r = setDigit(g, 1, 3, S);
  assert.deepEqual(r.autoPlaced, [15]); // в строке 1 тройка в столбце 6
  assert.equal(g.values[15], 3);
});

test('отмена откатывает ход целиком, вместе с автоматикой', () => {
  const g = make([...Array(18).keys()]);
  setDigit(g, 1, 3, S);
  undo(g);
  assert.equal(g.values[1], 0);
  assert.equal(g.values[15], 0);
});

test('осталось 5 клеток — игра дорешивает сама', () => {
  const s = { ...S, autoLastDigit: false };
  const g = make([0, 10, 20, 30, 40, 50], s);
  const r = setDigit(g, 0, 5, s);
  assert.equal(r.autoPlaced.length, 5);
  assert.ok(g.done);
});

test('при видимом повторе дорешивания нет', () => {
  const s = { ...S, autoLastDigit: false };
  const g = make([0, 10, 20, 30, 40, 50], s);
  setDigit(g, 0, 3, s); // 3 уже есть в строке 0 — повтор
  assert.ok(conflicts(g).size > 0);
  assert.equal(g.values[10], 0);
  assert.ok(!g.done);
});

test('ошибка рукой ничем не наказывается: повторное нажатие убирает цифру, есть стереть и отмена', () => {
  const g = make([...Array(18).keys()]);
  setDigit(g, 0, 7, S);
  setDigit(g, 0, 7, S);
  assert.equal(g.values[0], 0);
  setDigit(g, 0, 7, S);
  erase(g, 0);
  assert.equal(g.values[0], 0);
});

test('поставил цифру — она уходит из заметок соседей', () => {
  const s = NOTES_ONLY;
  const g = make(box0, s);
  toggleNote(g, 19, 5);
  toggleNote(g, 19, 8);
  setDigit(g, 0, 5, s);
  assert.deepEqual(notes(g, 19), [8]);
});

test('пары, которые уже есть на старте, пишутся сразу', () => {
  const g = make([...Array(18).keys()]); // пустые строки 0 и 1 — в каждом столбце по две пустые
  assert.deepEqual(notes(g, 5), [5, 8]);
  assert.deepEqual(notes(g, 14), [5, 8]);
});

const ONLY = extra => ({ ...S, autoLastDigit: false, autoFinish: false, autoPairResolve: false, autoPairThird: false, ...extra });

test('пара 5/3 в строке, а в столбце одной клетки уже есть 5 — обе цифры встают сами', () => {
  const s = ONLY({ autoPairResolve: true });
  const g = make([0, 1, 2], s);
  const r = setDigit(g, 2, 4, s); // в строке остались клетки 0 и 1: не хватает 5 и 3
  assert.equal(g.values[1], 3); // в столбце клетки 1 уже стоит 5
  assert.equal(g.values[0], 5);
  assert.deepEqual(r.autoPlaced.sort((a, b) => a - b), [0, 1]);
});

test('в строке три пустые, две из них — пара из квадрата: третья заполняется сама', () => {
  const s = ONLY({ autoPairThird: true });
  const g = make([0, 1, 5, 7], s); // в квадрате 0 пустые клетки 0 и 1 (пара 5/3)
  assert.equal(g.values[5], 0, 'пока в строке четыре пустые — ничего не ставится');
  setDigit(g, 7, 1, s);
  assert.equal(g.values[5], 8); // в строке не хватает 5, 3, 8; пара забирает 5 и 3
});

test('и наоборот: пара из строки внутри квадрата, в квадрате три пустые — третья заполняется сама', () => {
  const s = ONLY({ autoPairThird: true });
  const g = make([0, 1, 8, 11], s);
  setDigit(g, 8, 2, s); // в строке 0 остались 0 и 1 (пара 5/3), обе в квадрате 0
  assert.equal(g.values[11], 2);
});

test('новая автоматика выключается в настройках', () => {
  const s = ONLY({});
  const g = make([0, 1, 2], s);
  setDigit(g, 2, 4, s);
  assert.equal(g.values[0], 0);
  assert.equal(g.values[1], 0);
});
