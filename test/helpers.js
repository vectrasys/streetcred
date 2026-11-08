// Растрирование кадра камеры в PNG — как это сделала бы камера.
import { Resvg } from '@resvg/resvg-js';
import { renderFrame } from '../src/scenes-photo.js';

export const png = (spotId, opts) => new Resvg(renderFrame(spotId, opts)).render().asPng();

/** Три кадра заявки. Шум сенсора и время в подписи у каждого кадра свои. */
export const frames = (spotId, token, { light = 1, done = true, qr = token } = {}) => ({
  before: png(spotId, { seed: 11, when: Date.UTC(2026, 9, 3, 14, 20, 5) }),
  qr: png(spotId, { qrToken: qr, seed: 12, when: Date.UTC(2026, 9, 3, 14, 31, 40) }),
  after: png(spotId, { done, light, seed: 13, when: Date.UTC(2026, 9, 3, 15, 2, 17) }),
});
