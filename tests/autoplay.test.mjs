// Робот играет верными ходами в случайном порядке. Каждая цифра, поставленная игрой самой,
// должна совпасть с настоящим ответом — иначе автоматика где-то ошибается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, shuffle } from '../js/core.js';
import { generate } from '../js/generator.js';
import { newGame, prepare, setDigit, DEFAULT_SETTINGS } from '../js/game.js';

test('автоматика не ставит ни одной неверной цифры (300 партий, все уровни)', () => {
  const rng = makeRng(31);
  const share = {};
  for (let n = 0; n < 300; n++) {
    const level = 1 + (n % 5);
    const p = generate(level, rng);
    const g = newGame(p);
    const holes = [...p.puzzle].filter(ch => ch === '.').length;
    let auto = prepare(g, DEFAULT_SETTINGS).autoPlaced.length;
    for (const i of shuffle([...Array(81).keys()], rng)) {
      if (g.done) break;
      if (g.values[i]) continue;
      auto += setDigit(g, i, +p.solution[i], DEFAULT_SETTINGS).autoPlaced.length;
      for (let k = 0; k < 81; k++) {
        if (g.values[k]) assert.equal(g.values[k], +p.solution[k], `уровень ${level}, клетка ${k}`);
      }
    }
    assert.ok(g.done, 'партия должна завершиться');
    (share[level] ||= []).push(auto / holes);
  }
  for (const [lv, arr] of Object.entries(share)) {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    console.log(`  уровень ${lv}: автоматика заполнила в среднем ${(avg * 100).toFixed(0)}% пустых клеток`);
  }
});
