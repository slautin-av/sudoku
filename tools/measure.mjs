// Замер: сколько головоломок какого уровня получается и сколько это стоит по времени.
import { makeRng, randomSolution, digPuzzle } from '../js/core.js';
import { grade, TECH_BY_ID } from '../js/logic.js';
const N = +process.argv[2] || 300, minGivens = +process.argv[3] || 0;
const rng = makeRng(12345);
const byLevel = {}, techCount = {};
let tGen = 0, tGrade = 0, givensSum = 0;
for (let n = 0; n < N; n++) {
  let t = performance.now();
  const sol = randomSolution(rng);
  const puz = digPuzzle(sol, rng, minGivens);
  tGen += performance.now() - t;
  givensSum += puz.filter(Boolean).length;
  t = performance.now();
  const g = grade(puz, sol);
  tGrade += performance.now() - t;
  byLevel[g.level] = (byLevel[g.level] || 0) + 1;
  for (const id of g.used) techCount[id] = (techCount[id] || 0) + 1;
}
console.log('уровни (0 = не решается приёмами):', byLevel);
console.log('приёмы:', Object.entries(techCount).map(([k, v]) => `${TECH_BY_ID[k].name} ${v}`).join(', '));
console.log(`среднее открытых: ${(givensSum / N).toFixed(1)}; генерация ${(tGen / N).toFixed(1)} мс, оценка ${(tGrade / N).toFixed(1)} мс на задачу`);
