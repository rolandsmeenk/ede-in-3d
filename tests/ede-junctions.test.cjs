const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const asset = name => JSON.parse(readFileSync(join(__dirname, '../assets/ede-' + name + '.json')));

test('node restrictions preserve vehicle exceptions and via-way restrictions track the whole approach', async () => {
  const { indexEdeTurnRestrictions } = await import('../js/ede-turn-restrictions.js');
  const { BUS, CAR, BICYCLE, MOTOR } = await import('../js/road-access.js');
  const turns = indexEdeTurnRestrictions({
    nodes: { 1: [2, 3], 2: [4, 4], 3: [6, 5] },
    rules: [
      [1, 'only_right_turn', CAR | BICYCLE, ['from', 'right'], [1]],
      [2, 'no_straight_on', MOTOR, ['right', 'via', 'across'], [2, 3]],
      [3, 'no_u_turn', MOTOR, ['across', 'across'], [3]]
    ]
  });
  const move = (from, at, to, via = at, reverse = false) => ({ osmTurn: [from, at, to, via, reverse] });
  const wrong = move('from', 1, 'left');
  assert.equal(turns.nodeAt('from', 2, 3), 1);
  assert.equal(turns.nodeAt('elsewhere', 2, 3), undefined);
  assert.equal(turns.step(null, wrong, CAR), null);
  assert.equal(turns.step(null, wrong, BUS).key, '');
  assert.equal(turns.step(null, move('from', 2, 'left'), BICYCLE).key, '');
  assert.equal(turns.step(null, move('across', 3, 'across', 3, true), CAR), null);
  assert.equal(turns.step(null, move('across', 3, 'across'), CAR).key, '');
  const entered = turns.step(null, move('right', 2, 'via'), BUS);
  assert.ok(entered.key);
  const interior = turns.step(entered, move('via', undefined, 'via'), BUS);
  assert.equal(interior.key, entered.key);
  assert.equal(turns.step(interior, move('via', 3, 'across'), BUS), null);
  assert.equal(turns.step(null, move('via', 3, 'across'), BUS).key, '');
  assert.equal(turns.step(interior, move('via', 3, 'side'), BUS).key, '');
});

test('Stadspoort bans the mapped turn and restrictions survive on roundabout lane movements', async () => {
  const { buildRoadNetwork } = await import('../js/road-network.js');
  const { CAR, VAN, BUS } = await import('../js/road-access.js');
  const network = buildRoadNetwork([], [], [], asset('grade'));
  const approach = network.edges.find(e => e.wayId === 'w45020194' && e.osmEnd === 44886123);
  assert.ok(approach?.moves.length);
  for (const moves of [approach.moves, approach.ambientMoves, approach.vanMoves]) {
    assert.ok(moves.every(move => move.to.wayId !== 'w1055722522'));
  }

  const from = network.edges.find(e => e.wayId === 'w6954982' && e.osmEnd === 44901674);
  const first = from.moves.find(m => m.to.wayId === 'w6954985');
  const second = first.to.moves.find(m => m.to.wayId === 'w6954984');
  const exit = first.to.moves.find(m => m.to.wayId !== 'w6954984');
  for (const mode of [CAR, VAN, BUS]) {
    const history = network.turnRestrictionState(null, first, mode);
    assert.ok(history.key);
    assert.equal(network.turnRestrictionState(history, second, mode), null);
    assert.ok(network.turnRestrictionState(null, second, mode));
    assert.ok(network.turnRestrictionState(history, exit, mode));
  }
});

test('the station and Stadspoort active corridors connect at portals and keep overlapping levels separate', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { buildEdeActiveTravel } = await import('../js/ede-active-travel.js');
  const router = buildEdeActiveTravel(EDE_DATA, asset('grade'));
  const check = (mode, x, z, radius, ...ways) => {
    const tracks = [];
    router[mode](x, z, radius, tracks);
    const crossing = (a, b) => tracks.filter(t => t.wayId === a).some(t => t.links.flat().some(path => path.at(-1).track.wayId === b));
    for (let i = 1; i < ways.length; i++) {
      assert.ok(crossing(ways[i - 1], ways[i]), ways.join(' → '));
      assert.ok(crossing(ways[i], ways[i - 1]), ways.join(' ← '));
    }
    return { tracks, crossing };
  };
  const hartog = ['w1254180468', 'w1363871988', 'w1549067719'];
  check('bikes', 170, 2100, 130, ...hartog);
  check('foot', 170, 2100, 130, ...hartog);
  const oost = check('foot', 175, 2100, 155, 'w1091698001', 'w1507807928', 'w1507807929', 'w1410324046');
  assert.ok(!oost.crossing('w1507807928', 'w1409776591'));
  assert.ok(!oost.crossing('w1507807928', 'w1254109253'));
  assert.ok(oost.tracks.some(t => t.wayId === 'w1409776591' && t.layer === 0));

  const promenade = check('foot', -1460, 3130, 135, 'w956231553', 'w262752271', 'w956231554');
  assert.ok(!promenade.crossing('w262752271', 'w25546150'));
  assert.ok(!promenade.crossing('w262752271', 'w25546158'));
  for (const mode of ['bikes', 'foot']) {
    check(mode, -1460, 3130, 135, 'w1055722527', 'w25546150', 'w25546151');
    check(mode, -1460, 3130, 135, 'w24831845', 'w25546158', 'w25546159');
  }
});

test('the updated timetable retains matched boarding on the forecourt and at Stadspoort', () => {
  const stops = asset('bus-routes').variants.flatMap(variant => variant.stops);
  const forecourt = stops.filter(stop => stop.x >= 84 && stop.x <= 260 && stop.z >= 2138 && stop.z <= 2255);
  const stadspoort = stops.filter(stop => Math.hypot(stop.x + 1460, stop.z - 3110) < 220);
  for (const [expected, nearby] of [
    [['3237550', '3237551', '3956461', '3956462', '3956463', '3956464',
      '3956465', '3956466', '3956467', '3956468', '4032034'], forecourt],
    [['3906282', '3906304', '3906305'], stadspoort],
  ]) {
    const matched = new Set(nearby.filter(stop => stop.matched).map(stop => stop.id));
    for (const id of expected) assert.ok(matched.has(id), `No boarding match for stop ${id}`);
    assert.deepEqual(matched, new Set(nearby.map(stop => stop.id)));
  }
});
