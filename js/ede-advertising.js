import * as THREE from 'three/webgpu';

export const BEZOEK_EDE = Object.freeze({
  image: new URL('../assets/ede-visit-heath.jpg', import.meta.url).href,
  brand: 'Bezoek Ede', title: 'Ontdek Ede', detail: 'Van dorpshart tot heide', website: 'bezoek-ede.nl',
});

const layouts = { portrait: [512, 756], banner: [1536, 372] };
const displays = new Map();

export function paintEdeAd(ctx, width, height, artwork, image) {
  const portrait = width < height;
  ctx.fillStyle = '#21142e';
  ctx.fillRect(0, 0, width, height);
  if (image) {
    const left = !portrait && artwork.title ? width * 0.29 : 0;
    const scale = Math.max((width - left) / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, 0, width - left, height);
    ctx.clip();
    ctx.drawImage(image, left + (width - left - w) / 2, (height - h) * 0.58, w, h);
    ctx.restore();
  }
  if (artwork.title) {
    const fade = ctx.createLinearGradient(0, 0, portrait ? 0 : width * 0.71, portrait ? height * 0.54 : 0);
    fade.addColorStop(0, '#21142e');
    fade.addColorStop(portrait ? 0.41 : 0.48, '#21142ee8');
    fade.addColorStop(1, '#21142e00');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);
    const x = portrait ? 34 : 60;
    const textWidth = portrait ? width - 2 * x : width * 0.44;
    const text = (value, y, size, weight, color) => {
      if (!value) return;
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(value, x, y, textWidth);
    };
    text(artwork.brand, portrait ? 72 : 77, portrait ? 30 : 35, 750, '#ffcf77');
    text(artwork.title, portrait ? 162 : 192, portrait ? 77 : 106, 850, '#fff9ee');
    text(artwork.detail, portrait ? 213 : 254, portrait ? 28 : 36, 550, '#fff9ee');
    text(artwork.website, portrait ? 263 : 315, portrait ? 23 : 29, 700, '#ffcf77');
  }
}

function drawArtwork({ canvas, texture }, artwork, image) {
  paintEdeAd(canvas.getContext('2d'), canvas.width, canvas.height, artwork, image);
  texture.needsUpdate = true;
}

export function edeAdMaterial(layout) {
  if (!displays.has(layout)) {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = layouts[layout];
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicNodeMaterial({ map: texture, toneMapped: false });
    displays.set(layout, { canvas, texture, material, revision: 0 });
    void setEdeAdArtwork(layout, BEZOEK_EDE);
  }
  return displays.get(layout).material;
}

// Supply campaign text over an image, or just an already composed artwork URL.
export async function setEdeAdArtwork(layout, artwork) {
  if (!displays.has(layout)) edeAdMaterial(layout);
  const display = displays.get(layout);
  const revision = ++display.revision;
  if (!artwork.image) {
    drawArtwork(display, artwork);
    return true;
  }
  if (revision === 1) drawArtwork(display, artwork);
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = artwork.image;
  try { await image.decode(); }
  catch { return false; }
  if (display.revision !== revision) return false;
  drawArtwork(display, artwork, image);
  return true;
}
