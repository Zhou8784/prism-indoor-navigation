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

function buildGraphFromCorridors(floor, buildingId = null, preference = 'shortest') {
  const cacheKey = `${floor}_${buildingId || 'all'}`;
  if (GRAPH_CACHE.has(cacheKey)) return GRAPH_CACHE.get(cacheKey);

  // 1. 按楼层过滤走廊
  let corridorData = MAP_DATA.corridors.filter(c => c.floor === floor);
  if (buildingId) {
    corridorData = corridorData.filter(c => c.building_id === buildingId);
  }

  // 2. 按楼层&建筑ID过滤房间（必须有 building_id）
  let roomsOnFloor = allRooms.filter(r => r.floor_number === floor);
  if (buildingId) {
    roomsOnFloor = roomsOnFloor.filter(r => r.building_id === buildingId);
  }

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

  // 走廊主干建图
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

  // 房间接入
  roomsOnFloor.forEach(room => {
    const center = room.center;
    let bestProj = null, bestSeg = null, minDist = Infinity;
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
    if (!bestProj || minDist > 200) return;
    
    // 判断投影点是否在走廊内
    const inCorridor = isPointInCorridorPolygon(bestProj, corridorData);
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
      type: room.type
    };
    nodes.push(roomNode);

    const doorNode = getOrCreateNode(doorPoint);
    const d1 = distance(center, doorPoint);
    roomNode.edges.push({ to: doorNode.id, weight: d1 });
    doorNode.edges.push({ to: roomNode.id, weight: d1 });

    const nA = getOrCreateNode(bestSeg[0]);
    const nB = getOrCreateNode(bestSeg[1]);
    const dA = distance(doorPoint, nA.pos);
    const dB = distance(doorPoint, nB.pos);
    doorNode.edges.push({ to: nA.id, weight: dA });
    doorNode.edges.push({ to: nB.id, weight: dB });
    nA.edges.push({ to: doorNode.id, weight: dA });
    nB.edges.push({ to: doorNode.id, weight: dB });
  });

  GRAPH_CACHE.set(cacheKey, nodes);
  return nodes;
}

//Dijkstra（稳定版）
function dijkstra(nodes, startId, endId, preference = 'shortest') {
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
    if (!node) continue;

    // 定义“可通行节点类型”基础集合（所有走廊类、大厅等）
    const WALKABLE_TYPES = new Set([
      '走廊大厅1', '走廊大厅7',
      '公共走廊1', '公共走廊2', '公共走廊3', '公共走廊4',
      '公共走廊6', '公共走廊7', '公共走廊8', '公共走廊9',
      '公共走廊10', '公共走廊11', '公共走廊12', '公共走廊13',
      '公共走廊14', '公共走廊15',
      '连通廊5',
      '走廊6', '大厅文化长廊9',
      '楼梯间',  // 默认允许通过楼梯，但无障碍模式下将被删除
      '电梯'     // 默认允许通过电梯
    ]);

    // 根据偏好动态调整可通行节点
    if (preference === 'accessible') {
      WALKABLE_TYPES.delete('楼梯间'); // 无障碍模式禁止穿越楼梯间
    } else if (preference === 'stairs') {
      // 可以给楼梯更低的权重，这里简化处理保留原样
    }

    // 非可通行类型节点，只有作为起点或终点时才允许
    if (node.type && !WALKABLE_TYPES.has(node.type)) {
      if (id !== startId && id !== endId) continue;
    }

    // 遍历邻接边
    node.edges.forEach(edge => {
      const nd = dist[id] + edge.weight;
      if (nd < dist[edge.to]) {
        dist[edge.to] = nd;
        prev[edge.to] = id;
        pq.push({ id: edge.to, d: nd });
      }
    });
  }

  // 回溯路径
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

function findPath(startRoomId, endRoomId, preference = 'shortest') {
  const startRoom = allRooms.find(r => r.room_id === startRoomId);
  const endRoom = allRooms.find(r => r.room_id === endRoomId);
  if (!startRoom || !endRoom) return [];

  const sf = startRoom.floor_number;
  const ef = endRoom.floor_number;
  const sBId = startRoom.building_id;
  const eBId = endRoom.building_id;

  // 普通模式：同楼同层
  if (sf === ef && sBId === eBId) {
    const nodes = buildGraphFromCorridors(sf, sBId, preference);
    return dijkstra(nodes, startRoomId, endRoomId, preference);
  }

  // 跨楼 / 跨层模式：强制走楼梯/电梯 -> 1层 -> 目标楼梯/电梯 -> 目标楼层
  // 1. 获取本层最近楼梯 (start) -> 本楼1层楼梯 (mid1)
  const sConnectors = allRooms.filter(r => 
    (r.type === '楼梯间' || r.type === '电梯') && 
    r.building_id === sBId && 
    r.floor_number === sf
  );
  // 2. 获取目标楼1层楼梯 (mid2) -> 目标楼层楼梯/电梯 (end)
  const eConnectors = allRooms.filter(r => 
    (r.type === '楼梯间' || r.type === '电梯') && 
    r.building_id === eBId && 
    r.floor_number === 1
  );

  // 没有楼梯则放弃
  if (sConnectors.length === 0 || eConnectors.length === 0) return [];

  let bestPath = null;
  let bestCost = Infinity;

  for (const sc of sConnectors) {
    for (const ec of eConnectors) {
      // 段1: 起点 -> 本楼本层楼梯
      const nodes1 = buildGraphFromCorridors(sf, sBId, preference);
      const p1 = dijkstra(nodes1, startRoomId, sc.room_id, preference);
      if (p1.length < 2) continue;

      // 段2: 楼梯本楼层节点 -> 目标楼栋的1层节点 (通过物理空间的1楼连接)
      // 这里的关键是1楼的走廊必须连接 startBuilding 和 endBuilding
      // 构建1楼图（不加 building_id 过滤，假设1楼是连通的）
      const nodes2 = buildGraphFromCorridors(1, null, preference);
      const p2 = dijkstra(nodes2, sc.room_id, ec.room_id, preference);
      if (p2.length < 2) continue;

      // 段3: 目标楼1层楼梯 -> 终点（目标楼层）
      const nodes3 = buildGraphFromCorridors(ef, eBId, preference);
      const p3 = dijkstra(nodes3, ec.room_id, endRoomId, preference);
      if (p3.length < 2) continue;

      // 合并路径 (去重连接点)
      const fullPath = [...p1, ...p2.slice(1), ...p3.slice(1)];
      const cost = calculatePathCost(p1) + calculatePathCost(p2) + calculatePathCost(p3);
      
      if (cost < bestCost) {
        bestCost = cost;
        bestPath = fullPath;
      }
    }
  }

  return bestPath || [];
}
function findPathCrossBuilding(startRoomId, endRoomId, preference = 'shortest') {
  const startRoom = allRooms.find(r => r.room_id === startRoomId);
  const endRoom = allRooms.find(r => r.room_id === endRoomId);
  if (!startRoom || !endRoom) return [];

  const sf = startRoom.floor_number;
  const ef = endRoom.floor_number;
  
  return findPath(startRoomId, endRoomId, preference); 
  
}

function findPathFixed(startRoomId, endRoomId, preference = 'shortest') {
  
  const sf = startRoom.floor_number;
  const ef = endRoom.floor_number;
  if (sf === ef && startRoom.building_id === endRoom.building_id) {
    const nodes = buildGraphFromCorridors(sf, startRoom.building_id, preference);
    return dijkstra(nodes, startRoomId, endRoomId, preference);
  }

  return findCrossBuildingPathSimple(startRoomId, endRoomId, preference);
}

function findCrossBuildingPathSimple(startId, endId, pref) {
  const start = allRooms.find(r => r.room_id === startId);
  const end = allRooms.find(r => r.room_id === endId);
  if (!start || !end) return [];

  // 1. 起点 -> 本栋楼 sf 层的楼梯/电梯
  const startConnectors = allRooms.filter(r => (r.type === '楼梯间' || r.type === '电梯') && r.building_id === start.building_id && r.floor_number === start.floor_number);
  // 2. 终点楼栋 1 层的楼梯/电梯 -> 终点
  const endConnectors = allRooms.filter(r => (r.type === '楼梯间' || r.type === '电梯') && r.building_id === end.building_id && r.floor_number === end.floor_number);

  // 没有可行连接点则返回空
  if (startConnectors.length === 0 || endConnectors.length === 0) return [];

  let bestPath = null;
  let bestCost = Infinity;

  for (const sc of startConnectors) {
    for (const ec of endConnectors) {
      // 路径段1：起点 -> 楼梯起点(sf)
      const nodes1 = buildGraphFromCorridors(start.floor_number, start.building_id, pref);
      const p1 = dijkstra(nodes1, startId, sc.room_id, pref);
      if (p1.length < 2) continue;

      // 路径段2：楼梯起点 -> 楼梯终点(理论上通过物理空间的 1 层连接)
      // 这里借用现有的跨层逻辑
      const fullPathStairs = findPath(sc.room_id, ec.room_id, pref); // 此函数会递归处理跨层
      if (!fullPathStairs || fullPathStairs.length < 2) continue;

      // 路径段3：楼梯终点 -> 终点
      const nodes3 = buildGraphFromCorridors(end.floor_number, end.building_id, pref);
      const p3 = dijkstra(nodes3, ec.room_id, endId, pref);
      if (p3.length < 2) continue;

      // 合并路径
      const fullPath = [...p1, ...fullPathStairs.slice(1), ...p3.slice(1)];
      const totalCost = calculatePathCost(p1) + calculatePathCost(fullPathStairs) + calculatePathCost(p3);
      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestPath = fullPath;
      }
    }
  }
  return bestPath || [];
}

/** 计算路径实际距离和（用于代价比较） */
function calculatePathCost(path) {
  if (!path || path.length < 2) return Infinity;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distance(path[i-1], path[i]);
  }
  return total;
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
function calculatePathCost(path) {
    if (!path || path.length < 2) return Infinity;
    let total = 0;
    for (let i = 1; i < path.length; i++) {
        total += distance(path[i-1], path[i]);
    }
    return total;
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
function generateDirections(path) {
    if (!path || path.length < 2) return [];
    const steps = [];
    let currentFloor = path[0][2];
    steps.push({ type: 'start', text: `从 ${getNearestRoomName(path[0])} 出发`, floor: currentFloor });
    
    let i = 0;
    while (i < path.length - 1) {
        const [x1, y1, f1] = path[i];
        const [x2, y2, f2] = path[i + 1];
        
        // 楼层切换指令
        if (f1 !== f2) {
            const facility = getStairOrElevatorName(path[i], path[i+1]);
            const direction = f2 > f1 ? '上楼' : '下楼';
            steps.push({ type: 'floor_change', text: `在 ${facility} ${direction}`, floor: f2 });
            currentFloor = f2;
            i++;
            continue;
        }

        // 检查后续同层多段，计算方向变化
        let j = i;
        while (j < path.length - 1 && path[j+1][2] === f1) j++;
        const segment = path.slice(i, j+1);
        // 简化成直线或转弯段落
        const directions = analyzeTurn(segment);
        steps.push(...directions.map(d => ({ type: 'move', text: d, floor: currentFloor })));
        i = j;
    }
    
    steps.push({ type: 'end', text: `到达 ${getNearestRoomName(path[path.length-1])}`, floor: path[path.length-1][2] });
    return steps;
}

function analyzeTurn(coords) {
    // 如果近似直线，生成“沿走廊直行”
    // 如果有明显角度变化，分段生成“左转”、“右转”等
    // 简化：取首尾方向，并查找途经的房间名作为参照
    const start = coords[0], end = coords[coords.length-1];
    const azimuth = Math.atan2(end[1]-start[1], end[0]-start[0]) * 180 / Math.PI;
    // 根据方位生成指令（可细化）
    return [`沿走廊直行约 ${Math.round(distance(start, end))} 米`];
}