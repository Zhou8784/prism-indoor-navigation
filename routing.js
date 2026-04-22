// ========== routing.js（优化版） ==========

function buildGraphFromCorridors(floor) {
  const nodes = [];
  const corridorData = MAP_DATA.corridors?.filter(c => c.floor === floor) || [];

  // 第一步：将走廊路径点转为图节点（去重）
  corridorData.forEach(corridor => {
    const path = corridor.path;
    for (let i = 0; i < path.length; i++) {
      const pt = path[i];
      let node = nodes.find(n => distance(n.pos, pt) < 0.1);
      if (!node) {
        node = { id: `c_${nodes.length}`, pos: pt, edges: [] };
        nodes.push(node);
      }
      if (i > 0) {
        const prevPt = path[i - 1];
        const prevNode = nodes.find(n => distance(n.pos, prevPt) < 0.1);
        const dist = distance(prevPt, pt);
        prevNode.edges.push({ to: node.id, weight: dist });
        node.edges.push({ to: prevNode.id, weight: dist });
      }
    }
  });

  const roomsOnFloor = allRooms.filter(r => r.floor_number === floor);

  // 第二步：为每个房间创建“门口”节点（投影到最近走廊线段上）
  roomsOnFloor.forEach(room => {
    const center = room.center;
    let bestProj = null;
    let minDist = Infinity;

    // 遍历所有走廊线段，寻找最短投影距离
    corridorData.forEach(corridor => {
      const path = corridor.path;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const proj = projectPointOnSegment(center, a, b);
        const dist = distance(center, proj);
        if (dist < minDist) {
          minDist = dist;
          bestProj = proj;
        }
      }
    });

    if (!bestProj) return; // 无走廊数据时跳过

    // 创建房间接入节点（门口）
    const doorNodeId = `door_${room.room_id}`;
    const doorNode = { id: doorNodeId, pos: bestProj, edges: [] };
    nodes.push(doorNode);

    // 连接房间中心到门口
    const roomNode = { id: room.room_id, pos: center, edges: [] };
    nodes.push(roomNode);
    const distToDoor = distance(center, bestProj);
    roomNode.edges.push({ to: doorNodeId, weight: distToDoor });
    doorNode.edges.push({ to: room.room_id, weight: distToDoor });

    // 将门口节点连接到走廊网络：找到最近的走廊节点并建立边
    let nearestCorridorNode = null;
    let nearestDist = Infinity;
    nodes.forEach(n => {
      if (n.id.startsWith('c_')) {
        const d = distance(bestProj, n.pos);
        if (d < nearestDist) {
          nearestDist = d;
          nearestCorridorNode = n;
        }
      }
    });
    if (nearestCorridorNode) {
      doorNode.edges.push({ to: nearestCorridorNode.id, weight: nearestDist });
      nearestCorridorNode.edges.push({ to: doorNodeId, weight: nearestDist });
    }
  });

  return nodes;
}

// 计算点 p 在线段 ab 上的投影点
function projectPointOnSegment(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return [ax, ay];
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  return [ax + clampedT * dx, ay + clampedT * dy];
}

function dijkstra(nodes, startId, endId) {
  const dist = {}, prev = {}, visited = {};
  nodes.forEach(n => { dist[n.id] = Infinity; });
  dist[startId] = 0;

  const pq = [{ id: startId, d: 0 }];
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const { id } = pq.shift();
    if (visited[id]) continue;
    visited[id] = true;
    if (id === endId) break;

    const node = nodes.find(n => n.id === id);
    if (!node) continue;
    node.edges.forEach(edge => {
      const newDist = dist[id] + edge.weight;
      if (newDist < dist[edge.to]) {
        dist[edge.to] = newDist;
        prev[edge.to] = id;
        pq.push({ id: edge.to, d: newDist });
      }
    });
  }

  const path = [];
  let cur = endId;
  while (cur) {
    const node = nodes.find(n => n.id === cur);
    if (node) path.unshift(node.pos);
    cur = prev[cur];
  }
  return path;
}

function findPath(startRoomId, endRoomId) {
  const startRoom = allRooms.find(r => r.room_id === startRoomId);
  const endRoom = allRooms.find(r => r.room_id === endRoomId);
  if (!startRoom || !endRoom) return [];

  const startFloor = startRoom.floor_number;
  const endFloor = endRoom.floor_number;

  if (startFloor === endFloor) {
    const nodes = buildGraphFromCorridors(startFloor);
    const path = dijkstra(nodes, startRoomId, endRoomId);
    if (path.length > 0) {
        // 【核心修改】：给坐标数组加上第三个元素，代表楼层 [x, y, floor]
        return smoothPath(path).map(p => [p[0], p[1], startFloor]);
    }
    console.warn('走廊寻路失败，使用直角折线');
    return generateOrthogonalPath(startRoom.center, endRoom.center).map(p => [p[0], p[1], startFloor]);
  }

  // ===== 跨楼层寻路 =====
  const stairsStart = allRooms.filter(r => r.type === '楼梯间' && r.floor_number === startFloor);
  const stairsEnd = allRooms.filter(r => r.type === '楼梯间' && r.floor_number === endFloor);
  
  if (stairsStart.length === 0 || stairsEnd.length === 0) {
    console.warn('缺少楼梯数据，使用直角折线');
    return generateOrthogonalPath(startRoom.center, endRoom.center).map(p => [p[0], p[1], startFloor]);
  }

  // 找最近的楼梯
  let bestStairStart = stairsStart[0];
  let minDist = distance(startRoom.center, bestStairStart.center);
  stairsStart.forEach(s => {
    const d = distance(startRoom.center, s.center);
    if (d < minDist) { minDist = d; bestStairStart = s; }
  });

  const stairNumber = bestStairStart.name.match(/\d+/);
  let bestStairEnd = stairsEnd.find(s => stairNumber && s.name.includes(stairNumber[0]));
  if (!bestStairEnd) bestStairEnd = stairsEnd[0]; // 容错处理

  const nodesStart = buildGraphFromCorridors(startFloor);
  const pathToStair = dijkstra(nodesStart, startRoomId, bestStairStart.room_id);
  
  const nodesEnd = buildGraphFromCorridors(endFloor);
  const pathFromStair = dijkstra(nodesEnd, bestStairEnd.room_id, endRoomId);

  if (pathToStair.length > 0 && pathFromStair.length > 0) {
    // 【核心修改】：拆分两层路线，分别打上楼层标签
    const floor1Path = smoothPath(pathToStair).map(p => [p[0], p[1], startFloor]);
    // 连接点：从上楼梯的中心点开始算下一层的起点
    const floor2Path = smoothPath([bestStairEnd.center, ...pathFromStair]).map(p => [p[0], p[1], endFloor]);
    
    return [...floor1Path, ...floor2Path];
  }
  
  return generateOrthogonalPath(startRoom.center, endRoom.center).map(p => [p[0], p[1], startFloor]);
}

// 简单路径平滑（可选）
function smoothPath(path) {
  if (path.length < 3) return path;
  const smoothed = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    // 若三点几乎共线，可省略中间点
    const cross = (curr[0] - prev[0]) * (next[1] - curr[1]) - (curr[1] - prev[1]) * (next[0] - curr[0]);
    if (Math.abs(cross) > 1) { // 拐点保留
      smoothed.push(curr);
    }
  }
  smoothed.push(path[path.length - 1]);
  return smoothed;
}

function generateOrthogonalPath(p1, p2) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (Math.abs(x1 - x2) > Math.abs(y1 - y2)) {
    return [p1, [x2, y1], p2];
  } else {
    return [p1, [x1, y2], p2];
  }
}

function distance(p1, p2) {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}