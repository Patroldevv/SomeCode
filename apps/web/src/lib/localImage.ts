const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp)$/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * The file path an agent's markdown image points at (`![x](/home/me/shot.png)` or `file:///…`), or null for anything
 * else. Only absolute paths of pictures count; the server decides whether it may read them.
 */
export function localImagePath(src: string): string | null {
  if (src.length === 0 || src.length > 2000 || CONTROL.test(src) || src.trim() !== src) return null;
  let path = src;
  if (/^file:\/\//i.test(src)) {
    try {
      path = decodeURIComponent(src.slice('file://'.length));
    } catch {
      return null;
    }
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || !IMAGE_EXT.test(path)) return null;
  return path;
}
