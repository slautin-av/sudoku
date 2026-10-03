// Решатель проверяется на тысячах случайных головоломок: каждый его шаг сверяется
// с настоящим решением. Одна неверная постановка или вычёркивание — тест падает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, randomSolution, digPuzzle, countSolutions, parseGrid } from '../js/core.js';
import { grade, LEVELS } from '../js/logic.js';
import { generate } from '../js/generator.js';

const N = +process.env.SUDOKU_N || 3000;

test(`решатель не ошибается ни в одном шаге на ${N} головоломках`, () => {
  const rng = makeRng(2026);
  const stats = {};
  for (let n = 0; n < N; n++) {
    const sol = randomSolution(rng);
    const puz = digPuzzle(sol, rng, 0);
    const g = grade(puz, sol); // бросает ошибку при любом неверном шаге
    stats[g.level] = (stats[g.level] || 0) + 1;
  }
  console.log('  распределение по уровням (0 = нужна догадка, в игру не идёт):', stats);
});

test('каждый уровень: единственное решение, решается без угадывания, уровень совпадает', () => {
  const rng = makeRng(7);
  for (const L of LEVELS) {
    for (let k = 0; k < 20; k++) {
      const g = generate(L.id, rng);
      assert.ok(g, `уровень ${L.name} не подобран`);
      const puz = parseGrid(g.puzzle);
      assert.equal(countSolutions(puz, 2), 1, 'решение должно быть единственным');
      const r = grade(puz, parseGrid(g.solution));
      assert.ok(r.solved, 'должна решаться приёмами');
      assert.equal(r.level, L.id);
      assert.ok(r.maxRating <= L.max);
    }
  }
});

test('известная головоломка с X-Wing решается и требует его', () => {
  // классический пример X-Wing (sudokuwiki.org)
  const p = parseGrid('1.....569492.561.8.561.924...964.8.1.64.1....218.356.4.4.5...169.5.614.2621.....5');
  const sol = new Uint8Array(81);
  assert.equal(countSolutions(p, 2, sol), 1);
  const r = grade(p, sol);
  assert.ok(r.solved);
  assert.ok(r.used.includes('xw'), 'должен понадобиться X-Wing, понадобились: ' + r.used);
});
