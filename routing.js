const GRAPH_CACHE = new Map(); // floor -> nodes

function getNodeId(p, floor) {
  return `${p[0].toFixed(2)}_${p[1].toFixed(2)}_${floor}`;
}
function isPointInCorridorPolygon(point, corridors) {
  // 简单检查点是否在任一走廊多边形内（通过射线法）
  // 可遍历所有走廊的 path 构成的边界框或直接使用 turf.js，这里用包围盒近似：由于走廊为矩形，直接用矩形判断
  for (const c of corridors) {
    const xs = c.path.map(p => p[0]);
    const ys = c.path.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    if (point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY) {
      return true;
    }
  }
  return false;
}

function buildGraphFromCorridors(floor) {
  if (GRAPH_CACHE.has(floor)) return GRAPH_CACHE.get(floor);

  const nodes = [];
  const nodeMap = new Map();

  function getOrCreateNode(p) {
    const id = getNodeId(p, floor);//const id = getNodeId(p);
    if (!nodeMap.has(id)) {
      const node = { id, pos: [p[0], p[1], floor], edges: [] };
      nodeMap.set(id, node);
      nodes.push(node);
    }
    return nodeMap.get(id);
  }

  const corridorData = MAP_DATA.corridors.filter(c => c.floor === floor);

  //走廊主干（去重 + 正确连接）
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

  // 房间接入（核心优化）
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
    if (minDist > 200) return;//4.27连接距离限制，防止乱接，扩大距离范围
    // 4.27检查投影点是否落在走廊区域内，否则使用最近线段端点
    const inCorridor = isPointInAnyCorridor(bestProj, corridorData);
    let doorPoint = bestProj;
    if (!inCorridor) {
      const dA = distance(center, bestSeg[0]);
      const dB = distance(center, bestSeg[1]);
      doorPoint = dA <= dB ? bestSeg[0] : bestSeg[1];
    }


    const roomNode = {
      id: room.room_id,
      pos: [center[0], center[1], floor],
      edges: [],
      type: room.type   // 4.26新增房间节点添加类型标记
    };

    nodes.push(roomNode);

    const doorNode = getOrCreateNode(doorPoint);//5.3

    // 房间 → 投影点
    const d1 = distance(center, doorPoint);
    roomNode.edges.push({ to: doorNode.id, weight: d1 });
    doorNode.edges.push({ to: roomNode.id, weight: d1 });

    // 投影点 → 线段两端
    const nA = getOrCreateNode(bestSeg[0]);
    const nB = getOrCreateNode(bestSeg[1]);

    const dA = distance(doorPoint, nA.pos);
    const dB = distance(doorPoint, nB.pos);

    doorNode.edges.push({ to: nA.id, weight: dA });
    doorNode.edges.push({ to: nB.id, weight: dB });

    nA.edges.push({ to: doorNode.id, weight: dA });
    nB.edges.push({ to: doorNode.id, weight: dB });
    
  });

  GRAPH_CACHE.set(floor, nodes);
  return nodes;
}

//Dijkstra（稳定版）
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
    // 定义可通行节点类型（走廊、大厅、连通廊、楼梯间）
    const WALKABLE_TYPES = new Set([
   '楼梯间',
    '走廊大厅1', '走廊大厅7',
    '公共走廊1', '公共走廊2', '公共走廊3', '公共走廊4',
    '公共走廊6', '公共走廊7', '公共走廊8', '公共走廊9',
    '公共走廊10', '公共走廊11', '公共走廊12', '公共走廊13',
    '公共走廊14', '公共走廊15',
    '连通廊5', '连通廊5',   // 注意 1F 和 2F 都有“连通廊5”
    '走廊6', '大厅文化长廊9'
]);


    if (node.type && !WALKABLE_TYPES.has(node.type)) {
    // 非可通行节点不允许作为中间节点穿越
    if (id !== endId && id !== startId) continue;
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

//  楼梯匹配（关键修复） 
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

// 路径入口 
function findPath(startRoomId, endRoomId) {
  const startRoom = allRooms.find(r => r.room_id === startRoomId);
  const endRoom = allRooms.find(r => r.room_id === endRoomId);

  if (!startRoom || !endRoom) return [];

  const sf = startRoom.floor_number;
  const ef = endRoom.floor_number;

  // 同层
  if (sf === ef) {
    const nodes = buildGraphFromCorridors(sf);
    return dijkstra(nodes, startRoomId, endRoomId);
  }

  // 4.27跨层 
   const stairsStart = allRooms.filter(r => r.type === '楼梯间' && r.floor_number === sf);
  const stairsEnd   = allRooms.filter(r => r.type === '楼梯间' && r.floor_number === ef);

  let bestPath = null;
  let bestCost = Infinity;

  for (const sStart of stairsStart) {
    const nodes1 = buildGraphFromCorridors(sf);
    const part1 = dijkstra(nodes1, startRoomId, sStart.room_id);
    if (part1.length < 2) continue;   // 不可达该楼梯间

    for (const sEnd of stairsEnd) {
      const nodes2 = buildGraphFromCorridors(ef);
      const part2 = dijkstra(nodes2, sEnd.room_id, endRoomId);
      if (part2.length < 2) continue;

      // 简单代价估算（后续可加入楼梯内部高度代价）
      const cost = part1.length + part2.length;
      if (cost < bestCost) {
        bestCost = cost;
        bestPath = [...part1, ...part2];
      }
    }
  }

  return bestPath || []; 
}

//工具
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