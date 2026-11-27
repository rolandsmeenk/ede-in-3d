import * as THREE from 'three/webgpu';

export function surveyPanelTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'));
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 4;
  return map;
}

function panelCorners(wall, u, v, lo, hi, offset) {
  return [...wall.point(u, lo, offset), ...wall.point(v, lo, offset),
    ...wall.point(v, hi, offset), ...wall.point(u, hi, offset)];
}

function panelMesh(positions, uv, indices, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

export function texturedSurveyPanel(wall, u, v, lo, hi, material, { offset = 0.045, repeat = 1 } = {}) {
  return panelMesh(panelCorners(wall, u, v, lo, hi, offset),
    [0, 0, repeat, 0, repeat, 1, 0, 1], [0, 1, 2, 0, 2, 3], material);
}

export function surveyedWindowBatch({ columns, frame, glazing }) {
  const size = 128, frameWidth = 2.5, frameHeight = 3.5;
  const width = glazing.length * size;
  const map = surveyPanelTexture(width, size, ctx => {
    ctx.fillStyle = frame;
    ctx.fillRect(0, 0, width, size);
    for (const [index, color] of glazing.entries()) {
      ctx.fillStyle = color;
      const widthPerColumn = (size - frameWidth) / columns;
      for (let column = 0; column < columns; column++) {
        ctx.fillRect(index * size + frameWidth + column * widthPerColumn, frameHeight,
          widthPerColumn - frameWidth, size - 2 * frameHeight);
      }
    }
  });

  const positions = [], uv = [], indices = [];
  return {
    add(wall, u, v, lo, hi, tint = 0) {
      const index = positions.length / 3;
      const left = (tint * size + 0.5) / width, right = ((tint + 1) * size - 0.5) / width;
      positions.push(...panelCorners(wall, u, v, lo, hi, 0.045));
      uv.push(left, 0, right, 0, right, 1, left, 1);
      indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
    },
    mesh() {
      const material = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.57 });
      const mesh = panelMesh(positions, uv, indices, material);
      mesh.name = 'Filtered façade windows';
      mesh.userData.nearDetail = true;
      return mesh;
    },
  };
}
