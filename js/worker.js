// Фоновый подборщик: создаёт головоломку, не подвешивая экран.
import { generate } from './generator.js';

self.onmessage = e => {
  const { level, id } = e.data;
  self.postMessage({ id, level, game: generate(level) });
};
