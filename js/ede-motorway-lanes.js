let motorwayWays = {};

export function setEdeMotorwayLanes(data) {
  if (data?.version !== 1 || !data.ways) throw new Error('Invalid Ede motorway lane data');
  motorwayWays = data.ways;
}

export async function loadEdeMotorwayLanes() {
  const response = await fetch(new URL('../assets/ede-motorway-lanes.json', import.meta.url));
  if (!response.ok) throw new Error(`Motorway lane data ${response.status}`);
  const data = await response.json();
  setEdeMotorwayLanes(data);
  return data;
}

function wayMeasures(pts, from, to) {
  let length = 0;
  const projected = [from, to].map(point => ({ point, metre: 0, distance: Infinity }));
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x = pts[i], z = pts[i + 1];
    const dx = pts[i + 2] - x, dz = pts[i + 3] - z;
    const span = Math.hypot(dx, dz);
    if (!span) continue;
    for (const hit of projected) {
      const along = ((hit.point.x - x) * dx + (hit.point.z - z) * dz) / (span * span);
      const t = Math.max(0, Math.min(1, along));
      const distance = Math.hypot(hit.point.x - x - t * dx, hit.point.z - z - t * dz);
      if (distance >= hit.distance) continue;
      hit.metre = length + t * span;
      hit.distance = distance;
    }
    length += span;
  }
  return [Math.min(projected[0].metre, projected[1].metre), Math.max(projected[0].metre, projected[1].metre), length];
}

// A directed run can use an official count only where accepted intervals cover the run.
export function motorwayLanesAt(road, directionIndex, from, to) {
  const definitions = motorwayWays[road.id.slice(1)];
  if (!definitions) return null;
  const [start, end, wayLength] = wayMeasures(road.pts, from, to);
  if (end <= start) return null;
  const direction = directionIndex === 0 ? 'forward' : 'backward';
  const tolerance = Math.min(3, (end - start) * 0.12);
  const intervals = definitions.filter(row => row.direction === direction
    && row.start * wayLength < end - tolerance && row.end * wayLength > start + tolerance)
    .sort((a, b) => a.start - b.start);
  if (!intervals.length) return null;
  const first = intervals[0];
  const records = new Set();
  let confidence = 1;
  let covered = start;
  for (const row of intervals) {
    if (row.lanes !== first.lanes || row.start * wayLength - covered > tolerance) return null;
    covered = Math.max(covered, row.end * wayLength);
    confidence = Math.min(confidence, row.confidence ?? 1);
    for (const record of row.records) records.add(record);
  }
  if (end - covered > tolerance) return null;
  return { lanes: first.lanes, source: 'weggeg', confidence, records: [...records] };
}
