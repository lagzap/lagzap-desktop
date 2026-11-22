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

/** The flag alone, its transparent margin in the sprite cut away, so it
 * fills a box edge to edge (rounded corners and sizing are the caller's). */
const trimmed = new Map<string, Promise<string>>();

export function flagImageTrimmed(country: string): Promise<string> {
  const code = country.trim().toLowerCase();
  if (!code) return Promise.resolve("");
  let found = trimmed.get(code);
  if (!found) {
    found = flagImage(code).then(trimFlag);
    trimmed.set(code, found);
  }
  return found;
}

async function trimFlag(url: string): Promise<string> {
  if (!url) return "";
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return url;
    ctx.drawImage(image, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let top = height, left = width, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Solid pixels only: the sprite's soft edge and shadow are left out.
        if (data[(y * width + x) * 4 + 3] > 200) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < left || bottom < top) return url;
    const out = document.createElement("canvas");
    out.width = right - left + 1;
    out.height = bottom - top + 1;
    out.getContext("2d")?.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  } catch {
    return url;
  }
}
