/**
 * The whole studio works with a single vertical 9:16 frame: 1080×1920.
 * Use these helpers whenever an image/export must be resized to that frame.
 */
export const VERTICAL_FRAME_WIDTH = 1080;
export const VERTICAL_FRAME_HEIGHT = 1920;
export const VERTICAL_FRAME_LABEL = '9:16 · 1080×1920';

export type VerticalFitMode = 'contain' | 'cover';

/**
 * Draws any image/canvas into a 1080×1920 frame.
 * `contain` keeps the whole image visible (letterbox), `cover` fills the frame (crops edges).
 */
export function renderVerticalFrame(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  mode: VerticalFitMode = 'contain',
  background?: string
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = VERTICAL_FRAME_WIDTH;
  canvas.height = VERTICAL_FRAME_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);
  const scale =
    mode === 'cover'
      ? Math.max(canvas.width / sw, canvas.height / sh)
      : Math.min(canvas.width / sw, canvas.height / sh);
  const dw = sw * scale;
  const dh = sh * scale;

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  return canvas;
}
