// Проверка экрана в настоящем браузере размером с телефон: нажимаем, как пальцем, и фотографируем.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_ = process.argv[2] || 'http://localhost:8480/';
const out = 'tests/screens';
mkdirSync(out, { recursive: true });
const problems = [];
const check = (ok, msg) => { console.log((ok ? '  ✔ ' : '  ✖ ') + msg); if (!ok) problems.push(msg); };

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true,
    colorScheme: scheme, locale: 'ru-RU',
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push('ошибка на странице: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  await page.goto(URL_);
  await page.waitForSelector('#sheet:not([hidden])');
  await page.screenshot({ path: `${out}/${scheme}-1-levels.png` });
  if (scheme === 'dark') { await page.click('[data-act="start"][data-level="4"]'); await page.waitForSelector('#sheet[hidden]', { state: 'attached' }); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/dark-2-game.png` }); await ctx.close(); continue; }

  console.log('Старт уровня «Эксперт»');
  await page.tap('[data-act="start"][data-level="4"]');
  await page.waitForFunction(() => window.__sudoku.game && document.querySelector('#sheet').hidden);
  const g = await page.evaluate(() => ({ puzzle: window.__sudoku.game.puzzle, solution: window.__sudoku.game.solution, level: window.__sudoku.game.level }));
  check(g.level === 4, 'уровень 4 «Эксперт»');
  check((g.puzzle.match(/\./g) || []).length > 50, 'пустых клеток больше 50 (минимальная головоломка)');

  const cell = i => `#board .cell[data-i="${i}"]`;
  const key = d => `#pad .key[data-d="${d}"]`;
  const empties = [...g.puzzle].map((ch, i) => (ch === '.' ? i : -1)).filter(i => i >= 0);

  // Ставим верную цифру, проверяем подсветку
  const first = empties[0];
  await page.tap(cell(first));
  await page.tap(key(+g.solution[first]));
  const cls = await page.getAttribute(cell(first), 'class');
  check(cls.includes('user') && cls.includes('sel'), 'цифра поставлена, клетка выделена');
  await page.screenshot({ path: `${out}/light-2-move.png` });

  // Заметки
  const second = empties[1];
  await page.tap('#btn-notes');
  await page.tap(cell(second));
  await page.tap(key(1)); await page.tap(key(2));
  const notes = await page.$$eval(`${cell(second)} .notes span`, s => s.map(x => x.textContent).join(''));
  check(notes === '12', 'заметки 1 и 2 записаны в клетку');
  await page.tap('#btn-notes');

  // Ошибка рукой — повтор подсвечен, ничего не заканчивается, отмена убирает
  const wrong = [...'123456789'].map(Number).find(d => d !== +g.solution[second]);
  await page.tap(key(wrong));
  await page.tap('#btn-undo');
  check(await page.evaluate(i => window.__sudoku.game.values[i] === 0, second), 'отмена убрала ошибочную цифру');

  // Решаем почти до конца: проверяем, что пары и девятые цифры появляются сами, а конец дорешивается
  let autoSeen = 0, pairSeen = 0;
  for (const i of empties.slice(1)) {
    const state = await page.evaluate(i => ({ v: window.__sudoku.game.values[i], done: window.__sudoku.game.done }), i);
    if (state.done) break;
    if (state.v) { autoSeen++; continue; }
    const before = await page.evaluate(() => window.__sudoku.game.notes.filter(Boolean).length);
    await page.tap(cell(i));
    await page.tap(key(+g.solution[i]));
    const flashed = await page.$$eval('#board .cell[data-flash="notes"]', s => s.length);
    if (flashed) pairSeen++;
    if (pairSeen === 1 && flashed) { await page.screenshot({ path: `${out}/light-3-pairs.png` }); pairSeen++; }
  }
  check(autoSeen > 0, `цифры, поставленные игрой самой (девятые и дорешивание): ${autoSeen}`);
  console.log(`  · пары в заметках появлялись ${pairSeen} раз (часто сразу раскладываются в цифры — это проверяют тесты)`);
  await page.waitForSelector('#sheet:not([hidden])', { timeout: 3000 });
  const winText = await page.textContent('#sheet-panel');
  check(winText.includes('Решено'), 'экран «Решено!» показан');
  await page.screenshot({ path: `${out}/light-4-win.png` });

  // Меню, настройки, уровни
  await page.tap('[data-act="levels"]');
  await page.screenshot({ path: `${out}/light-5-new.png` });
  await page.tap('[data-act="menu"]');
  await page.tap('[data-act="settings"]');
  await page.screenshot({ path: `${out}/light-6-settings.png` });
  await page.tap('[data-act="finish-plus"]');
  const s = await page.evaluate(() => window.__sudoku.settings);
  check(s.autoFinishAt === 6 && s.autoFinish === true, 'кнопка «+» меняет число и не выключает переключатель');
  await page.tap('[data-act="menu"]');
  await page.tap('[data-act="stats"]');
  await page.screenshot({ path: `${out}/light-7-stats.png` });

  // Сохранение: перезагрузка не теряет игру
  await page.tap('[data-act="menu"]');
  await page.tap('[data-act="levels"]');
  await page.tap('[data-act="start"][data-level="5"]');
  await page.waitForFunction(() => window.__sudoku.game.level === 5 && document.querySelector('#sheet').hidden);
  const p5 = await page.evaluate(() => window.__sudoku.game.puzzle);
  await page.reload();
  await page.waitForFunction(() => window.__sudoku && window.__sudoku.game);
  check(await page.evaluate(p => window.__sudoku.game.puzzle === p, p5), 'после перезагрузки игра на месте');
  await ctx.close();
}
await browser.close();
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}):\n` + problems.join('\n') : '\nВсё в порядке');
process.exit(problems.length ? 1 : 0);
