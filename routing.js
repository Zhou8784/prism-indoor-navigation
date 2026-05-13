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
  // 用 floor + buildingId 做缓存 key
  let corridorData = MAP_DATA.corridors.filter(c => c.floor === floor);
  
  // 2. 【新增】如果传入了 buildingId，强制只加载该楼的走廊（断绝跨楼连接）
  if (buildingId) {
    corridorData = corridorData.filter(c => c.building_id === buildingId);
  }

  // 3. 获取该楼层房间，同样过滤 buildingId
  let roomsOnFloor = allRooms.filter(r => r.floor_number === floor);
  if (buildingId) {
    roomsOnFloor = roomsOnFloor.filter(r => r.building_id === buildingId);
  }
  const cacheKey = `${floor}_${buildingId || 'all'}`;
  if (GRAPH_CACHE.has(cacheKey)) return GRAPH_CACHE.get(cacheKey);

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

  // 1. 过滤走廊：先按楼层，再按 buildingId（如果走廊数据里没有 buildingId，可以先不加过滤，但通过房间关联来隔离）
  let corridorData = MAP_DATA.corridors.filter(c => c.floor === floor);
  
  // 2. 过滤房间：必须按 buildingId 隔离！
  let corridorData = MAP_DATA.corridors.filter(c => c.floor === floor);
if (buildingId) {
  corridorData = corridorData.filter(c => c.building_id === buildingId);
}

  // 走廊主干建图 (与之前相同)
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

  // 房间接入 (与之前相同，但只接入 roomsOnFloor)
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

  if (!startRoom || !endRoom) {
    console.error('起点或终点房间不存在');
    return [];
  }

  const sf = startRoom.floor_number;
  const ef = endRoom.floor_number;

  // 同层规划：直接在当前楼层图上计算最短路径（偏好影响可通行节点）
   if (sf === ef && startRoom.building_id === endRoom.building_id) {
    const nodes = buildGraphFromCorridors(sf, startRoom.building_id, preference);
    return dijkstra(nodes, startRoomId, endRoomId, preference);
    return findPathCrossBuilding(startRoomId, endRoomId, preference);
  }

  // 跨层规划
  // 根据偏好选择跨层通道：楼梯 or 电梯
  const connectorsFilter = (preference === 'accessible')
    ? r => r.type === '电梯' && r.floor_number === sf  // 无障碍只用电梯
    : r => r.type === '楼梯间' && r.floor_number === sf;

  const connectorsStart = allRooms.filter(r => connectorsFilter(r));
  if (connectorsStart.length === 0) {
    console.warn('当前楼层无可用的跨层通道');
    return [];
  }

  let bestPath = null;
  let bestCost = Infinity;

  for (const connStart of connectorsStart) {
    // 在同楼栋的终点楼层找到对应的通道（room_id 前缀相同）
    const buildingPrefix = connStart.room_id.split('-')[0]; // 例 "1"
    const connEndCandidates = allRooms.filter(r =>
      r.type === connStart.type &&          // 同类型（电梯/楼梯）
      r.floor_number === ef &&              // 目标楼层
      r.room_id.startsWith(buildingPrefix + '-') // 同栋楼
    );

    for (const connEnd of connEndCandidates) {
      // 第一段：起点 -> 通道入口（起始楼层）
      const nodes1 = buildGraphFromCorridors(sf, preference);
      const part1 = dijkstra(nodes1, startRoomId, connStart.room_id, preference);
      if (part1.length < 2) continue;  // 不可达该通道入口

      // 第二段：通道出口（目标楼层）-> 终点
      const nodes2 = buildGraphFromCorridors(ef, preference);
      const part2 = dijkstra(nodes2, connEnd.room_id, endRoomId, preference);
      if (part2.length < 2) continue;  // 从该通道出口不可达终点

      // 简化代价：两段路径的 Manhattan 距离和（可替换为实际路径长度累加）
      // 增加楼层变化惩罚，鼓励就近选择通道
      const crossCost = (preference === 'accessible') ? 0 : 100; // 电梯无体力惩罚
      const cost = calculatePathCost(part1) + calculatePathCost(part2) + crossCost;

      if (cost < bestCost) {
        bestCost = cost;
        bestPath = [...part1, ...part2]; // 直接拼接（注意交界点重复，dijkstra 中包含通道节点）
      }
    }
  }

  if (!bestPath) {
    console.warn('未找到可行的跨层路径');
    return [];
  }

  // 可进一步用 makeOrthogonal 优化路径形状
  // return makeOrthogonal(bestPath);
  return bestPath;
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