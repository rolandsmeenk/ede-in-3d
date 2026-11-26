import { createCoverageIndex } from './ede-boundary-index.js';
import { buildCanopyGeometry, buildTerrainGeometry, packLandscapeGeometry } from './ede-landscape-geometry.js?v=20261126-motorway-grades';
import { createTerrainSampler } from './terrain.js';

let canopyBoundary;

self.onmessage = ({ data: { type, buffer, tile, context, boundary, napOrigin } }) => {
  try {
    const sampler = createTerrainSampler(context);
    if (boundary?.length) canopyBoundary = createCoverageIndex(boundary);
    if (type === 'canopy') {
      const { geometry, mask, outlines } = buildCanopyGeometry(buffer, tile, {
        napOrigin,
        terrainHeightAt: sampler.terrainHeightAt,
        containsPlayablePoint: canopyBoundary?.contains,
        playableBoundsCovered: canopyBoundary?.coversBounds,
        playableBoundsOverlap: canopyBoundary?.overlapsBounds,
      });
      const mesh = packLandscapeGeometry(geometry);
      self.postMessage({ mesh, mask, outlines }, [
        mesh.index.buffer, ...mesh.attributes.map(({ array }) => array.buffer), mask.buffer,
      ]);
    } else {
      const expansion = sampler.getExpansionTerrain();
      const geometry = buildTerrainGeometry(buffer, { ...tile, detail: tile.detail ? expansion.detail : null },
        sampler.getTerrain(), expansion.field, sampler.expansionSeamOffset);
      const mesh = packLandscapeGeometry(geometry);
      self.postMessage({ mesh }, [mesh.index.buffer, ...mesh.attributes.map(({ array }) => array.buffer)]);
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
