const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('browser, offline and live inputs share the stored geographic affine', async () => {
  const { SCENE_NAP_ORIGIN, projectLonLatInto, unprojectScene } = await import('../js/ede-scene-coordinates.js');
  const { EDE_DATA, projectLonLat } = await import('../js/city-config.js');
  const { lonLatAffine, geographicBounds } = EDE_DATA.meta;
  const [south, west, north, east] = geographicBounds;
  const input = [[lonLatAffine.lon0, lonLatAffine.lat0],
    [west, north], [east, north], [west, south], [east, south],
    [5.671245344841541, 52.04606512985389], [5.6629353, 52.0368761],
    [5.6741136, 52.0274114], [5.66582, 52.04691]];
  // Exercise affine terms that happen to be zero in the current north-up map.
  const rotated = { ...lonLatAffine, x: [13, lonLatAffine.x[1], 27], z: [-9, -42, lonLatAffine.z[2]] };
  const result = JSON.parse(execFileSync('python3', ['-B', '-c', `
import json
from runpy import run_path
import sys

sys.path.insert(0, 'tools')
from ede_map import load_scene
from ede_scene import SceneAffine, SCENE_NAP_ORIGIN
from ede_live_buses import local_map
from ede_traffic_geometry import RoadGraph

points, rotated = json.load(sys.stdin)
base = load_scene(include_shorelines=False)['meta']
frame = SceneAffine(base['lonLatAffine'])
gps = SceneAffine(local_map()[1])
graph = RoadGraph(dict(base, edges=[]))
gtfs = run_path('tools/import-ede-gtfs.py')['load_projection']()
def evaluate(frame):
    results = []
    for lon, lat in points:
        world = frame.lon_lat_to_scene(lon, lat)
        results.append([world, frame.scene_to_lon_lat(*world)])
    return results
print(json.dumps(dict(
    nap=SCENE_NAP_ORIGIN, map=evaluate(frame), rotated=evaluate(SceneAffine(rotated)),
    bus_train_gps=[gps.lon_lat_to_scene(*p) for p in points],
    road_graph=[graph.project(*p) for p in points], gtfs=[gtfs(*p) for p in points],
)))
`], {
    cwd: join(__dirname, '..'),
    input: JSON.stringify([input, rotated]),
    encoding: 'utf-8',
  }));
  assert.equal(SCENE_NAP_ORIGIN, result.nap);
  const close = (a, b, tolerance) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance);
  for (const [affine, reference] of [[lonLatAffine, result.map], [rotated, result.rotated]]) {
    for (let i = 0; i < input.length; i++) {
      const [lon, lat] = input[i];
      const target = { y: 14.25 };
      assert.equal(projectLonLatInto(affine, lon, lat, target), target);
      assert.equal(target.y, 14.25);
      const xy = [target.x, target.z];
      close(xy, reference[i][0], 1e-10);
      const reverse = unprojectScene(affine, ...xy);
      const ll = [reverse.lon, reverse.lat];
      close(ll, reference[i][1], 1e-12);
      close(ll, input[i], 1e-12);
      if (affine === lonLatAffine) {
        assert.deepEqual(projectLonLat(lon, lat), { x: target.x, z: target.z });
        close(xy, result.bus_train_gps[i], 1e-10);
        close(xy, result.road_graph[i], 1e-10);
        close(xy, result.gtfs[i], Math.SQRT2 * 0.005);
      }
    }
  }
});
