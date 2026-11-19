/** A country's flag as an image URL, for places that draw images (charts).
 * The flags component paints flags from one sprite through CSS (the .flag
 * and .f-xx classes it loads); this cuts the country's piece of it out
 * onto a canvas. Empty when the flags' CSS is not loaded or the country is
 * unknown. */
const cache = new Map<string, Promise<string>>();

export function flagImage(country: string): Promise<string> {
  const code = country.trim().toLowerCase();
  if (!code) return Promise.resolve("");
  let found = cache.get(code);
  if (!found) {
    found = cutFlag(code);
    cache.set(code, found);
  }
  return found;
}

async function cutFlag(code: string): Promise<string> {
  const probe = document.createElement("span");
  probe.className = `flag f-${code}`;
  probe.style.cssText = "position:absolute;left:-9999px;top:-9999px";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const image = style.backgroundImage;
  const [x, y] = style.backgroundPosition.split(" ").map((v) => parseFloat(v) || 0);
  const width = parseFloat(style.width) || 52;
  const height = parseFloat(style.height) || 39;
  probe.remove();
  const url = /^url\("?(.*?)"?\)$/.exec(image)?.[1];
  if (!url) return "";
  try {
    const sprite = new Image();
    sprite.src = url;
    await sprite.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(sprite, -x, -y, width, height, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}
