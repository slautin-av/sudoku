// Подбор головоломки нужного уровня: создаём случайную, проверяем «решателем как человек»,
// берём только ту, что решается приёмами этого уровня. Остальные — в брак.

import { randomSolution, digPuzzle, gridToString } from './core.js';
import { grade } from './logic.js';

export function generate(level, rng = Math.random, maxTries = 20000) {
  for (let t = 0; t < maxTries; t++) {
    const sol = randomSolution(rng);
    // Лёгкий — с запасом подсказок (36 открытых цифр), остальные — до упора.
    const puz = digPuzzle(sol, rng, level === 1 ? 36 : 0);
    let g;
    try {
      g = grade(puz, sol);
    } catch {
      continue; // ошибка в приёме — такую задачу не выдаём
    }
    if (g.solved && g.level === level) {
      return {
        puzzle: gridToString(puz),
        solution: gridToString(sol),
        level,
        rating: g.maxRating,
        used: g.used,
        tries: t + 1,
      };
    }
  }
  return null;
}
