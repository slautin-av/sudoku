// Большая проверка: N головоломок, каждый шаг решателя сверяется с решением,
// заодно считаем, сколько раз сработал каждый приём (редкие тоже должны пройти проверку).
import { makeRng, randomSolution, digPuzzle } from '../js/core.js';
import { grade, TECHNIQUES } from '../js/logic.js';
const N = +process.argv[2] || 30000;
const rng = makeRng(+process.argv[3] || 99);
const used = {}, levels = {};
for (let n = 0; n < N; n++) {
  const sol = randomSolution(rng);
  const g = grade(digPuzzle(sol, rng, 0), sol);
  levels[g.level] = (levels[g.level] || 0) + 1;
  for (const id of g.used) used[id] = (used[id] || 0) + 1;
}
console.log(`проверено ${N}, ошибок 0`);
console.log('уровни:', levels);
for (const t of TECHNIQUES) console.log(`  ${t.name}: ${used[t.id] || 0}`);
