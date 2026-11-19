import { EDE_TURN_RESTRICTION_DATA } from './ede-turn-restriction-data.js';

const EMPTY = { key: '', pending: [] };

export function indexEdeTurnRestrictions({ nodes, rules }) {
  const pointsByWay = new Map(), approaches = new Map(), viaWays = new Set();
  const key = (way, node) => way + '/' + node;
  function addPoint(way, node) {
    if (!pointsByWay.has(way)) pointsByWay.set(way, new Map());
    pointsByWay.get(way).set(nodes[node].join(','), node);
  }
  for (const [index, [, kind, modes, ways, via]] of rules.entries()) {
    const start = key(ways[0], via[0]);
    if (!approaches.has(start)) approaches.set(start, []);
    approaches.get(start).push({ index, kind, only: kind.startsWith('only_'), modes, ways, via });
    for (const [i, node] of via.entries()) {
      addPoint(ways[i], node);
      addPoint(ways[i + 1], node);
    }
    for (const way of ways.slice(1, -1)) viaWays.add(way);
  }
  const fromRules = (way, via) => approaches.get(key(way, via)) ?? [];
  const follows = (rule, i, to, at, reverse) => {
    if (to !== rule.ways[i + 1] || at !== rule.via[i]) return false;
    return rule.ways[i] !== to || !(rule.kind.endsWith('_u_turn')) || reverse;
  };

  function allowed(turn, modes) {
    if (!turn || !turn[1]) return modes;
    const [from, via, to, at, reverse] = turn;
    for (const rule of fromRules(from, via)) {
      const matches = follows(rule, 0, to, at, reverse);
      if (rule.only ? !matches : matches && rule.ways.length === 2) modes &= ~rule.modes;
    }
    return modes;
  }

  function step(previous, move, mode) {
    if (move.modes !== undefined && !(move.modes & mode)) return null;
    const turn = move.osmTurn;
    if (!(allowed(turn, mode) & mode)) return null;
    if (!turn || !turn[1] && !previous?.pending.length) return EMPTY;
    const [from, via, to, at, reverse] = turn;
    const pending = [];
    for (const [rule, i] of previous?.pending || []) {
      if (!(rule.modes & mode) || from !== rule.ways[i]) continue;
      if (via !== rule.via[i] && from === to && !reverse) {
        pending.push([rule, i]);
      } else if (follows(rule, i, to, at, reverse)) {
        if (i + 2 < rule.ways.length) pending.push([rule, i + 1]);
        else if (!rule.only) return null;
      } else if (rule.only) return null;
    }
    for (const rule of fromRules(from, via)) {
      if (rule.modes & mode && rule.ways.length > 2 && follows(rule, 0, to, at, reverse)) pending.push([rule, 1]);
    }
    pending.sort(([a, i], [b, j]) => a.index - b.index || i - j);
    return pending.length ? { pending, key: pending.map(([rule, i]) => rule.index + '/' + i).join(',') } : EMPTY;
  }

  return { nodeAt: (way, x, z) => pointsByWay.get(way)?.get(x + ',' + z), viaWays, allowed, step };
}

export const EDE_TURN_RESTRICTIONS = indexEdeTurnRestrictions(EDE_TURN_RESTRICTION_DATA);
