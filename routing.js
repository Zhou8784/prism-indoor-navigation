const GRAPH_CACHE = new Map(); // floor -> nodes

function getNodeId(p, floor) {
  return `${p[0].toFixed(2)}_${p[1].toFixed(2)}_${floor}`;
}

function buildGraphFromCorridors(floor) {
  if (GRAPH_CACHE.has(floor)) return GRAPH_CACHE.get(floor);

  const nodes = [];
  const nodeMap = new Map();

  function getOrCreateNode(p) {
    const id = getNodeId(p, floor);
    if (!nodeMap.has(id)) {
      const node = { id, pos: [p[0], p[1], floor], edges: [] };
      nodeMap.set(id, node);
      nodes.push(node);
    }
    return nodeMap.get(id);
  }

  const corridorData = MAP_DATA.corridors.filter(c => c.floor === floor);

  // ===== 1. 走廊主干（去重 + 正确连接）=====
  corridorData.forEach(c => {
    const path = c.path;
    for (let i = 1; i < path.length; i++) {
      const a = getOrCreateNode(path[i - 1]);
      const b = getOrCreateNode(path[i]);

      const d = distance(a.pos, b.pos);

      a.edges.push({ to: b.id, weight: d });
      b.edges.push({ to: a.id, weight: d });
    }
  });

  // ===== 2. 房间接入（核心优化）=====
  const roomsOnFloor = allRooms.filter(r => r.floor_number === floor);

  roomsOnFloor.forEach(room => {
    const center = room.center;

    let bestProj = null;
    let bestSeg = null;
    let minDist = Infinity;

    corridorData.forEach(c => {
      for (let i = 0; i < c.path.length - 1; i++) {
        const a = c.path[i];
        const b = c.path[i + 1];

        const proj = projectPointOnSegment(center, a, b);
        const d = distance(center, proj);

        if (d < minDist) {
          minDist = d;
          bestProj = proj;
          bestSeg = [a, b];
        }
      }
    });

    if (!bestProj) return;
    if (minDist > 200) return;//连接距离限制，防止乱接

    const roomNode = {
      id: room.room_id,
      pos: [center[0], center[1], floor],
      edges: [],
      type: room.type   // 4.26新增房间节点添加类型标记
    };

    nodes.push(roomNode);

    const doorNode = getOrCreateNode(bestProj);

    // 房间 → 投影点
    const d1 = distance(center, bestProj);
    roomNode.edges.push({ to: doorNode.id, weight: d1 });
    doorNode.edges.push({ to: roomNode.id, weight: d1 });

    // 投影点 → 线段两端
    const nA = getOrCreateNode(bestSeg[0]);
    const nB = getOrCreateNode(bestSeg[1]);

    const dA = distance(bestProj, nA.pos);
    const dB = distance(bestProj, nB.pos);

    doorNode.edges.push({ to: nA.id, weight: dA });
    doorNode.edges.push({ to: nB.id, weight: dB });

    nA.edges.push({ to: doorNode.id, weight: dA });
    nB.edges.push({ to: doorNode.id, weight: dB });
    
  });

  GRAPH_CACHE.set(floor, nodes);
  return nodes;
}

// ================== Dijkstra（稳定版） ==================
function dijkstra(nodes, startId, endId) {
  const dist = {}, prev = {}, visited = {};
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  nodes.forEach(n => dist[n.id] = Infinity);
  dist[startId] = 0;

  const pq = [{ id: startId, d: 0 }];

  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const { id } = pq.shift();
    if (visited[id]) continue;
    visited[id] = true;

    if (id === endId) break;

    const node = nodeMap.get(id);
    if (node.type && node.type !== '楼梯间' && id !== endId && id !== startId) {
    // 禁止从非楼梯间房间节点穿越（除非它是起点或终点）
    continue;
}
    if (!node) continue;

    node.edges.forEach(edge => {
      const nd = dist[id] + edge.weight;
      if (nd < dist[edge.to]) {
        dist[edge.to] = nd;
        prev[edge.to] = id;
        pq.push({ id: edge.to, d: nd });
      }
    });
  }

  const path = [];
  let cur = endId;

  while (cur) {
    const node = nodeMap.get(cur);
    if (node) path.unshift(node.pos);
    cur = prev[cur];
  }

  return path;
}

// ================== 楼梯匹配（关键修复） ==================
function matchStairs(startFloor, endFloor) {
  const s1 = allRooms.filter(r => r.type === '楼梯间' && r.floor_number === startFloor);
  const s2 = allRooms.filter(r => r.type === '楼梯间' && r.floor_number === endFloor);

  for (let a of s1) {
    for (let b of s2) {
      // 用 room_id 前缀匹配（强一致）
      if (a.room_id.split('-')[0] === b.room_id.split('-')[0]) {
        return [a, b];
      }
    }
  }

  return null;
}

// ================== 路径入口 ==================
function findPath(startRoomId, endRoomId) {
  const startRoom = allRooms.find(r => r.room_id === startRoomId);
  const endRoom = allRooms.find(r => r.room_id === endRoomId);

  if (!startRoom || !endRoom) return [];

  const sf = startRoom.floor_number;
  const ef = endRoom.floor_number;

  // ===== 同层 =====
  if (sf === ef) {
    const nodes = buildGraphFromCorridors(sf);
    return dijkstra(nodes, startRoomId, endRoomId);
  }

  // ===== 跨层 =====
  const pair = matchStairs(sf, ef);
  if (!pair) return [];

  const [sStart, sEnd] = pair;

  const nodes1 = buildGraphFromCorridors(sf);
  const part1 = dijkstra(nodes1, startRoomId, sStart.room_id);

  const nodes2 = buildGraphFromCorridors(ef);
  const part2 = dijkstra(nodes2, sEnd.room_id, endRoomId);
  
  const fullPath = [...part1, ...part2];

  return fullPath;
}

// ================== 工具 ==================
function projectPointOnSegment(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;

  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) return [ax, ay];

  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));

  return [ax + tt * dx, ay + tt * dy];
}

function distance(p1, p2) {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}
function makeOrthogonal(path) {
  const result = [];

  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1, f] = path[i];
    const [x2, y2] = path[i + 1];

    result.push([x1, y1, f]);

    // 强制走直角（贴走廊）
    result.push([x2, y1, f]);
  }

  result.push(path[path.length - 1]);

  return result;
}