const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

class MinHeap {
  values = [];

  push(item) {
    const values = this.values;
    let index = values.length;
    values.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (values[parent][0] <= item[0]) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = item;
  }

  pop() {
    const values = this.values;
    const head = values[0];
    const tail = values.pop();
    if (!values.length) return head;
    let index = 0;
    while (index * 2 + 1 < values.length) {
      let child = index * 2 + 1;
      if (values[child + 1]?.[0] < values[child][0]) child++;
      if (values[child][0] >= tail[0]) break;
      values[index] = values[child];
      index = child;
    }
    values[index] = tail;
    return head;
  }
}

// Some road and rail features end a metre apart at a tile or feature boundary.
// Snap those junctions together, keeping the source coordinates in the guide.
function buildNetwork(lines, snap, step, canTravel) {
  const nodes = [];
  const buckets = new Map();
  function nodeAt(point) {
    const x = Math.floor(point[0] / snap);
    const z = Math.floor(point[1] / snap);
    for (let ix = x - 1; ix <= x + 1; ix++) {
      for (let iz = z - 1; iz <= z + 1; iz++) {
        const hit = buckets.get(`${ix}:${iz}`)?.find((id) => distance(nodes[id].point, point) < snap);
        if (hit !== undefined) return hit;
      }
    }
    const id = nodes.length;
    const key = `${x}:${z}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(id);
    nodes.push({ point, edges: new Map(), incoming: new Map() });
    return id;
  }
  function connect(from, to, weight) {
    const edge = Math.min(weight, nodes[from].edges.get(to) ?? Infinity);
    nodes[from].edges.set(to, edge);
    nodes[to].incoming.set(from, edge);
  }
  for (const { points, multiplier = 1, oneWay } of lines) {
    let previous = nodeAt(points[0]);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const parts = Math.max(1, Math.ceil(distance(a, b) / step));
      for (let j = 1; j <= parts; j++) {
        const t = j / parts;
        const next = nodeAt([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        if (next === previous) continue;
        const from = nodes[previous].point;
        const to = nodes[next].point;
        if (!canTravel || canTravel(from, to)) {
          const weight = distance(from, to) * multiplier;
          connect(previous, next, weight);
          if (!oneWay) connect(next, previous, weight);
        }
        previous = next;
      }
    }
  }
  return nodes;
}

function search(nodes, start, ends, reverse = false) {
  const costs = new Float64Array(nodes.length).fill(Infinity);
  const paths = new Int32Array(nodes.length).fill(-1);
  const queue = new MinHeap();
  const candidates = new Map(ends.map(({ id, offset }) => [id, offset]));
  costs[start] = 0;
  queue.push([0, start]);
  let best;
  while (queue.values.length) {
    const [cost, id] = queue.pop();
    if (cost > costs[id]) continue;
    if (best && cost > best.cost) break;
    const offset = candidates.get(id);
    if (offset !== undefined && (!best || cost + 6 * offset < best.cost)) best = { id, cost: cost + 6 * offset };
    for (const [next, weight] of reverse ? nodes[id].incoming : nodes[id].edges) {
      if (cost + weight >= costs[next]) continue;
      costs[next] = cost + weight;
      paths[next] = id;
      queue.push([costs[next], next]);
    }
  }
  if (!best) return null;
  const path = [];
  for (let id = best.id; id !== -1; id = paths[id]) path.push(id);
  return { cost: best.cost, path: path.reverse() };
}

export function traceRoute(lines, stations, kind, canTravel) {
  const rail = kind === "rail";
  const nodes = buildNetwork(lines, rail ? 2.4 : 1.9, rail ? 9 : 11, canTravel);
  const candidates = stations.map((station) => nodes.map(({ point }, id) => ({
    id,
    offset: distance(point, station.point),
  })).filter(({ offset }) => offset < (station.radius ?? (rail ? 52 : 92)))
    .sort((a, b) => a.offset - b.offset).slice(0, rail ? 28 : 18));

  let best;
  const [first, middle, last] = candidates;
  for (const m of middle) {
    const north = search(nodes, m.id, first, true);
    const south = search(nodes, m.id, last);
    if (!north || !south) continue;
    const cost = north.cost + south.cost + 12 * m.offset;
    if (!best || cost < best.cost) best = { cost, north, south };
  }
  if (!best) throw new Error(`No continuous ${kind} route through all three stops`);
  const { north, south } = best;
  const ids = [...north.path.toReversed(), ...south.path.slice(1)];
  const track = ids.map((id) => nodes[id].point.map((value) => Math.round(value * 100) / 100));
  const stopIndices = [0, north.path.length - 1, ids.length - 1];
  const length = track.slice(1).reduce((sum, point, i) => sum + distance(track[i], point), 0);
  console.log(kind, Math.round(length), "metres", stopIndices.map((i) => track[i]));
  return { track, stopIndices };
}
