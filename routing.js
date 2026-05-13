// routing.js

const GRAPH_CACHE = new Map();

function getNodeId(p, floor) {
    return `${p[0].toFixed(2)}_${p[1].toFixed(2)}_${floor}`;
}

function buildGraphFromFloor(floor, buildingId = null) {
    const cacheKey = `${floor}_${buildingId || 'all'}`;
    if (GRAPH_CACHE.has(cacheKey)) return GRAPH_CACHE.get(cacheKey);

    let corridors = MAP_DATA.corridors.filter(c => c.floor === floor);
    if (buildingId) corridors = corridors.filter(c => c.building_id === buildingId);

    let roomsOnFloor = allRooms.filter(r => r.floor_number === floor);
    if (buildingId) roomsOnFloor = roomsOnFloor.filter(r => r.building_id === buildingId);

    const nodes = [];
    const nodeMap = new Map();

    function getOrCreateNode(p) {
        const id = getNodeId(p, floor);
        if (!nodeMap.has(id)) {
            const node = { id, pos:[p[0], p[1], floor], edges:[] };
            nodeMap.set(id, node);
            nodes.push(node);
        }
        return nodeMap.get(id);
    }

    corridors.forEach(c => {
        const path = c.path;
        for (let i=1;i<path.length;i++){
            const a = getOrCreateNode(path[i-1]);
            const b = getOrCreateNode(path[i]);
            const d = distance(a.pos, b.pos);
            a.edges.push({to:b.id, weight:d});
            b.edges.push({to:a.id, weight:d});
        }
    });

    roomsOnFloor.forEach(room=>{
        const center = room.center;
        const roomNode = {id: room.room_id, pos:[center[0], center[1], floor], edges:[], type: room.type};
        nodes.push(roomNode);

        let minDist = Infinity, closestNode = null;
        nodes.forEach(n=>{
            if (n.pos[2] !== floor) return;
            const d = distance(center, n.pos);
            if(d<minDist){ minDist=d; closestNode=n; }
        });
        if(closestNode){
            roomNode.edges.push({to:closestNode.id, weight:minDist});
            closestNode.edges.push({to:roomNode.id, weight:minDist});
        }
    });

    GRAPH_CACHE.set(cacheKey, nodes);
    return nodes;
}

function distance(p1,p2){ return Math.hypot(p1[0]-p2[0], p1[1]-p2[1]); }

function dijkstra(nodes, startId, endId){
    const dist = {}, prev = {}, visited={}, nodeMap=new Map(nodes.map(n=>[n.id,n]));
    nodes.forEach(n=>dist[n.id]=Infinity); dist[startId]=0;
    const pq=[{id:startId,d:0}];
    while(pq.length){
        pq.sort((a,b)=>a.d-b.d);
        const {id}=pq.shift();
        if(visited[id]) continue;
        visited[id]=true;
        if(id===endId) break;
        const node=nodeMap.get(id);
        if(!node) continue;
        node.edges.forEach(e=>{
            const nd=dist[id]+e.weight;
            if(nd<dist[e.to]){ dist[e.to]=nd; prev[e.to]=id; pq.push({id:e.to,d:nd}); }
        });
    }
    const path=[];
    let cur=endId;
    while(cur){ const n=nodeMap.get(cur); if(n) path.unshift(n.pos); cur=prev[cur]; }
    return path;
}

function findPath(startRoomId, endRoomId){
    const startRoom=allRooms.find(r=>r.room_id===startRoomId);
    const endRoom=allRooms.find(r=>r.room_id===endRoomId);
    if(!startRoom||!endRoom) return [];

    const sf=startRoom.floor_number, ef=endRoom.floor_number;
    if(sf===ef){
        const nodes=buildGraphFromFloor(sf,startRoom.building_id);
        return dijkstra(nodes, startRoomId, endRoomId);
    }

    const stairsStart=allRooms.find(r=>r.type==='楼梯间' && r.floor_number===sf);
    const stairsEnd=allRooms.find(r=>r.type==='楼梯间' && r.floor_number===ef);
    if(!stairsStart||!stairsEnd) return [];

    const nodesStart=buildGraphFromFloor(sf,startRoom.building_id);
    const path1=dijkstra(nodesStart, startRoomId, stairsStart.room_id);

    const nodesEnd=buildGraphFromFloor(ef,endRoom.building_id);
    const path2=dijkstra(nodesEnd, stairsEnd.room_id, endRoomId);

    const floorTransition=[[stairsStart.center[0], stairsStart.center[1], sf],
                           [stairsEnd.center[0], stairsEnd.center[1], ef]];

    return [...path1, ...floorTransition, ...path2];
}

function renderRouteOnCurrentFloor(){
    if(window.currentRouteLine) map.removeLayer(window.currentRouteLine);
    if(!window.globalFullRoute) return;
    const pts=window.globalFullRoute.filter(p=>p[2]===currentFloor);
    if(pts.length<2) return;
    const latlngs=pts.map(p=>[p[1],p[0]]);
    window.currentRouteLine=L.polyline(latlngs,{color:'#2563eb',weight:4}).addTo(map);
}