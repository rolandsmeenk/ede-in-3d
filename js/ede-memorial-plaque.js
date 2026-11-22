import * as THREE from 'three/webgpu';

// A single textured face keeps the inscription and the surface finish together.
export function createMemorialPlaque({ name, x, y, z, heading, width, height, base, ink,
  border, outline, lines, decorations, metalness = 0 }) {
  const material = new THREE.MeshStandardNodeMaterial({
    color: base, roughness: metalness ? 0.53 : 0.88, metalness,
  });
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const w = canvas.width = 512, h = canvas.height = Math.round(w * height / width);
    const ctx = canvas.getContext('2d');
    ctx.save();
    if (outline) {
      ctx.beginPath();
      outline.forEach(([u, v], i) => i ? ctx.lineTo(u * w, v * h) : ctx.moveTo(u * w, v * h));
      ctx.closePath();
      ctx.clip();
    }
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // Fixed positions give the material a fine, reproducible grain.
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff14' : '#0000001e';
      ctx.fillRect((i * 163.27) % w, (i * i * 0.00337 + i * 139.49) % h, 2 + i % 3, 1 + i % 2);
    }
    if (border) {
      ctx.lineWidth = w * 0.012;
      ctx.strokeStyle = border;
      ctx.strokeRect(8, 8, w - 16, h - 16);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    for (const [label, v, size, u = 0.5, maxWidth = 0.88] of lines) {
      ctx.font = `600 ${Math.round(h * size)}px sans-serif`;
      ctx.fillText(label, w * u, h * v, w * maxWidth);
    }
    decorations?.(ctx, w, h);
    ctx.restore();
    material.map = new THREE.CanvasTexture(canvas);
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.color.set(0xffffff);
    if (outline) material.alphaTest = 0.5;
  }

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(x, y + height / 2, z);
  mesh.rotation.y = heading;
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.userData.nearDetail = 65;
  return mesh;
}
