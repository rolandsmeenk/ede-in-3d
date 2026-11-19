const assert = require('node:assert/strict');
const test = require('node:test');

function makeRoads({ CAR, BUS, MOTOR }) {
  const road = (id, x, z, modes = MOTOR) => ({
    id, len: 50, to: { x, z }, modes, laneModes: [modes], moves: [], ambientMoves: []
  });
  const turn = (from, to, modes = MOTOR) => {
    const move = { from, to, modes, out: [0] };
    from.moves.push(move);
    if (modes & CAR) from.ambientMoves.push(move);
    return move;
  };

  const entry = road('entry', 0, 0);
  const shortcut = road('shortcut', 50, 0);
  const sideStreet = road('side-street', 0, 50);
  const busLane = road('bus-lane', 25, 0, BUS);
  const destination = road('destination', 100, 0);
  const viaShortcut = turn(entry, shortcut);
  const viaSideStreet = turn(entry, sideStreet);
  const viaBusLane = turn(entry, busLane, BUS);
  turn(shortcut, destination);
  turn(sideStreet, destination);
  turn(busLane, destination, BUS);
  return { entry, shortcut, sideStreet, busLane, destination, viaShortcut, viaSideStreet, viaBusLane };
}

test('the lane planner obeys access and detours around a current closure or restricted turn', async () => {
  const { findRoadTrip } = await import('../js/ede-trips.js');
  const modes = await import('../js/road-access.js');
  const { CAR, BUS } = modes;
  const { entry, shortcut, sideStreet, busLane, destination, viaShortcut, viaSideStreet, viaBusLane } = makeRoads(modes);
  const start = { edge: entry, lane: 0, s: 2 };
  const goals = [{ edge: destination, lane: 0, at: 20, x: 95, z: 0 }];
  const open = { isClosed: () => false };
  const closed = { isClosed: edge => edge === shortcut || edge === busLane };
  assert.equal(findRoadTrip({}, open, start, goals, CAR).steps[0].move, viaShortcut);
  assert.equal(findRoadTrip({}, closed, start, goals, CAR).steps[0].move, viaSideStreet);

  const restricted = {
    turnRestrictionState: (history, move) => move.from === shortcut && history?.key === 'from-entry'
      ? null
      : { key: move === viaShortcut ? 'from-entry' : '' }
  };
  assert.equal(findRoadTrip(restricted, open, start, goals, CAR).steps[0].move, viaSideStreet);
  const busCorridor = { isClosed: edge => edge === shortcut || edge === sideStreet };
  assert.equal(findRoadTrip({}, busCorridor, start, goals, CAR), null);
  assert.equal(findRoadTrip({}, busCorridor, start, goals, BUS).steps[0].move, viaBusLane);
  busLane.limits = { height: 3.1 };
  assert.equal(findRoadTrip({}, busCorridor, start, goals, BUS), null);
});

test('trip demand follows Amsterdam weekday, summer time and overnight hours', async () => {
  const { destinationWeights } = await import('../js/ede-trips.js');
  const get = iso => destinationWeights(Date.parse(iso));
  assert.ok(get('2026-07-03T05:00:00Z').school > get('2026-07-03T03:59:00Z').school);
  assert.equal(get('2026-07-04T07:00:00Z').school, 0);
  assert.equal(get('2026-11-19T06:00:00Z').school, get('2026-07-03T05:00:00Z').school);
  assert.ok(get('2026-11-19T23:00:00Z').homes > get('2026-11-19T23:00:00Z').shops);
});
