const assert = require('node:assert/strict');
const test = require('node:test');

test('lane counts, turns and bus access use the surveyed width in travel order', async () => {
  const { resolveEdeRoadLanes, permittedTurn } = await import('../js/ede-road-lanes.js');
  const { BUS, MOTOR } = await import('../js/road-access.js');
  const [forward, backward] = resolveEdeRoadLanes({
    width: 15, bgtWidth: 12, kind: 'secondary',
    laneTags: { lanes: '4', 'lanes:forward': '3', 'lanes:backward': '1',
      'turn:lanes:forward': 'left|through|right', 'motor_vehicle:lanes:forward': 'yes|yes|no',
      'bus:lanes:forward': 'yes|yes|designated' }
  }, [MOTOR, MOTOR]);
  assert.equal(forward.source, 'osm-direction');
  assert.equal(forward.confidence, 'high');
  assert.equal(forward.widthSource, 'bgt');
  assert.equal(forward.count, 3);
  assert.deepEqual(forward.lanes.map(lane => lane.offset), [-1.5, 1.5, 4.5]);
  assert.deepEqual(backward.lanes.map(lane => lane.offset), [4.5]);
  assert.deepEqual(forward.lanes.map(lane => lane.permissions), [MOTOR, MOTOR, BUS]);
  assert.ok(permittedTurn(forward.lanes[0], 'L', -1));
  assert.equal(permittedTurn(forward.lanes[0], 'S', 0), false);
});

test('shared center lanes, WEGGEG and bicycle strips preserve distinct evidence and space', async () => {
  const { resolveEdeRoadLanes } = await import('../js/ede-road-lanes.js');
  const { BICYCLE, MOTOR } = await import('../js/road-access.js');
  const dedicated = { offset: 4, width: 1.5, allowed: [true, false], kind: 'lane' };
  const advisory = { offset: -4, width: 1.5, allowed: [false, true], kind: 'advisory' };
  const road = { width: 9, kind: 'primary', laneTags: { lanes: '3', 'lanes:both_ways': '1' },
    cycle: [dedicated], cycleAdvisory: [advisory] };
  const [a, b] = resolveEdeRoadLanes(road, [MOTOR, MOTOR]);
  assert.equal(a.source, 'osm-split');
  assert.equal(a.totalCount, 3);
  assert.equal(a.centers.length, 1);
  assert.equal(a.bikes[0].permissions, BICYCLE);
  assert.equal(a.bikes[0].kind, 'lane');
  assert.equal(b.bikes[0].kind, 'advisory');
  assert.equal(a.lanes[0].offset + a.lanes[0].width / 2, a.bikes[0].offset - dedicated.width / 2);
  const [, opposite] = resolveEdeRoadLanes({ width: 11, kind: 'motorway', oneway: true, reverse: true,
    laneTags: { lanes: '2' } }, [0, MOTOR], [null, { lanes: 3 }]);
  assert.equal(opposite.source, 'weggeg');
  assert.equal(opposite.count, 3);
});
