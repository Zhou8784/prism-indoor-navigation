
let map;
let currentFloor = 1;
let allRooms = [];
let roomLayerGroup;

function initMap() {
    map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 4,
        zoomControl: false,
        attributionControl: false
    });

    map.setView([900, 550], 0);
    L.tileLayer('', {}).addTo(map);

    extractAllRooms();
    
    roomLayerGroup = L.layerGroup().addTo(map);
    redrawRoomsByFloor(currentFloor);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

function extractAllRooms() {
    allRooms = [];
    MAP_DATA.buildings.forEach(building => {
        building.floors.forEach(floor => {
            floor.rooms.forEach(room => {
                const polygon = room.polygon;
                if (!polygon || polygon.length < 3) return;
                let sumX = 0, sumY = 0;
                polygon.forEach(p => { sumX += p[0]; sumY += p[1]; });
                const center = [sumX / polygon.length, sumY / polygon.length];
                allRooms.push({
                    ...room,
                    building_id: building.building_id,
                    building_name: building.building_name,
                    floor_number: floor.floor_number,
                    center: center,
                    polygon: polygon
                });
            });
        });
    });
}

function redrawRoomsByFloor(floor) {
    roomLayerGroup.clearLayers();
    const roomsOnFloor = allRooms.filter(r => r.floor_number === floor);
    roomsOnFloor.forEach(room => {
        const latlngs = room.polygon.map(p => [p[1], p[0]]);
        const color = APP_CONFIG.poiColors[room.type] || APP_CONFIG.poiColors.default;
        
        const polygon = L.polygon(latlngs, {
            color: '#333',
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.6,
            interactive: true
        }).addTo(roomLayerGroup);
        
        // 绑定点击事件
        polygon.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            if (window.pickingMode) {
                if (typeof window.setPickedPoint === 'function') {
                    window.setPickedPoint({
                        roomId: room.room_id,
                        name: room.name,
                        center: room.center
                    });
                }
            } else {
                polygon.bindPopup(`<strong>${room.name}</strong><br>${room.type}`).openPopup();
            }
        });

        // 文字标签
        const label = room.name.replace(room.building_name, '').replace(/楼/g, '');
        L.marker([room.center[1], room.center[0]], {
            icon: L.divIcon({
                className: 'room-label',
                html: `<div style="font-size:10px;color:#000;text-shadow:0 0 3px #fff;white-space:nowrap;pointer-events:none;">${label}</div>`,
                iconSize: [40, 20]
            }),
            interactive: false
        }).addTo(roomLayerGroup);
    });
}

function filterFloor(floor) {
    currentFloor = floor;
    redrawRoomsByFloor(floor);
    document.querySelectorAll('.floor-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.floor == floor);
    });
    
    // 【核心修改】：切换楼层时，自动重绘该层的导航路线
    renderRouteOnCurrentFloor(); 
}
function toggleViewMode() {
    alert('当前为 Leaflet 平面图，暂不支持 3D 视图。');
}

function filterPoiByTypes(activeTypes) {
    roomLayerGroup.clearLayers();
    const roomsOnFloor = allRooms.filter(r => r.floor_number === currentFloor && activeTypes.includes(r.type));
    roomsOnFloor.forEach(room => {
        const latlngs = room.polygon.map(p => [p[1], p[0]]);
        const color = APP_CONFIG.poiColors[room.type] || APP_CONFIG.poiColors.default;
        const polygon = L.polygon(latlngs, {
            color: '#333',
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.6,
            interactive: true
        }).addTo(roomLayerGroup);
        
        polygon.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            if (window.pickingMode) {
                if (typeof window.setPickedPoint === 'function') {
                    window.setPickedPoint({
                        roomId: room.room_id,
                        name: room.name,
                        center: room.center
                    });
                }
            } else {
                polygon.bindPopup(`<strong>${room.name}</strong><br>${room.type}`).openPopup();
            }
        });
        
        const label = room.name.replace(room.building_name, '').replace(/楼/g, '');
        L.marker([room.center[1], room.center[0]], {
            icon: L.divIcon({ className: 'room-label', html: `<div style="font-size:10px;color:#000;text-shadow:0 0 3px #fff;white-space:nowrap;pointer-events:none;">${label}</div>`, iconSize: [40, 20] }),
            interactive: false
        }).addTo(roomLayerGroup);
    });
}

function flyToRoom(roomId) {
    const room = allRooms.find(r => r.room_id === roomId);
    if (room) {
        const offset = getMobileViewOffset();
        const targetY = room.center[1] - offset;
        map.setView([targetY, room.center[0]], 1.5);
        filterFloor(room.floor_number);
        L.popup()
            .setLatLng([room.center[1], room.center[0]])
            .setContent(`<strong>${room.name}</strong><br>${room.type}`)
            .openOn(map);
    }
}

function getRoomCenter(roomId) {
    const room = allRooms.find(r => r.room_id === roomId);
    return room ? room.center : null;
}

function getStairCenters(floor) {
    return allRooms.filter(r => r.type === '楼梯间' && r.floor_number === floor).map(r => r.center);
}

function drawRoute(pathCoords) {
    // 4.27强力清除旧路线（即使有残留）
    if (window.currentRouteLine) {
        map.removeLayer(window.currentRouteLine);
        window.currentRouteLine = null;
    }
    if (window.currentRouteMarker) {
        map.removeLayer(window.currentRouteMarker);
        window.currentRouteMarker = null;
    }

    window.globalFullRoute = pathCoords;
    renderRouteOnCurrentFloor();
    startNavigationFollow(pathCoords);
}

function renderRouteOnCurrentFloor() {
    if (window.currentRouteLine) {
        map.removeLayer(window.currentRouteLine);
    }

    if (!window.globalFullRoute) return;

    // 4.26 严格校验三维点
    const pts = window.globalFullRoute.filter(p =>
        Array.isArray(p) &&
        p.length === 3 &&
        p[2] === currentFloor
    );

    if (pts.length < 2) return;

    const latlngs = pts.map(p => [p[1], p[0]]);

    window.currentRouteLine = L.polyline(latlngs, {
        color: '#2563eb',
        weight: 4
    }).addTo(map);
}
function clearRoute() {
    if (window.currentRouteLine) {
        map.removeLayer(window.currentRouteLine);
        window.currentRouteLine = null;
    }
    if (window.currentRouteMarker) {
        map.removeLayer(window.currentRouteMarker);
        window.currentRouteMarker = null;
    }
    window.globalFullRoute = null;
    if (window.navTimer) {
        clearTimeout(window.navTimer);
        cancelAnimationFrame(window.navTimer);
        window.navTimer = null;
    }
}

let is3D = false; // 初始为 2D 状态

function toggle3D() {
    is3D = !is3D;
    const mapContainer = document.getElementById('map');
    const btn3d = document.getElementById('btn-3d');

    if (is3D) {
        // 进入 3D 模式：倾斜 + 旋转 + 透视
        // perspective(1000px): 设置透视距离，产生近大远小的立体感
        // rotateX(50deg): 绕X轴倾斜，形成俯视立体视角
        // scale(1.1): 稍微放大一点，防止倾斜后边缘露出
        mapContainer.style.transform = 'perspective(1000px) rotateX(50deg) scale(1.1)';
        
        // 更新按钮样式
        btn3d.classList.add('bg-blue-600', 'text-white');
        btn3d.classList.remove('text-primary', 'bg-white');
        
        // 关键：为了在3D视角下标记和房间多边形依然清晰，可以尝试对内部元素做反向补偿（视情况而定）
        // 这里提供一个简单的思路，如果效果好就保留，不好就删掉
        document.querySelectorAll('.leaflet-marker-icon, .leaflet-popup').forEach(el => {
            el.style.transform += ' rotateX(-30deg)'; // 反向补偿，让图标不跟着完全倒下
        });
        
    } else {
        // 恢复 2D 模式
        mapContainer.style.transform = 'none';
        
        // 恢复按钮样式
        btn3d.classList.remove('bg-blue-600', 'text-white');
        btn3d.classList.add('text-primary', 'bg-white');
        
        // 恢复所有元素的补偿
         document.querySelectorAll('.leaflet-marker-icon, .leaflet-popup').forEach(el => {
            el.style.transform = el.style.transform.replace(' rotateX(-30deg)', '');
        });
    }
    
    // 关键点：切换视角后需要通知 Leaflet 重新计算视野，防止报错
    setTimeout(() => {
        map.invalidateSize({animate: true});
    }, 500); // 等 500ms CSS过渡动画完成后再重置
}
//4.26增加自动跟随
function startNavigationFollow(path) {
    if (!path || path.length < 2) return;

    // 估算总长度，避免用户看到瞬间跳跃
    let idx = 0;
    const speed = 120;  // 坐标单位/秒 (假设1单位≈1cm, 1.2m/s=120cm/s)

    function step() {
        if (idx >= path.length) {
            window.navTimer = null;
            return;
        }

        const [x, y, floor] = path[idx];
        if (floor !== currentFloor) {
            filterFloor(floor);
            // 楼层切换需要额外等待渲染
            setTimeout(() => {
                map.flyTo([y - getMobileViewOffset(), x], 1.5, { animate: true, duration: 0.8 });
                idx++;
                window.navTimer = setTimeout(step, 800);
            }, 600);
            return;
        }

        // 根据与上一点的距离计算飞行时间
        let duration = 0.8;
        if (idx > 0) {
            const prev = path[idx - 1];
            const dist = Math.hypot(x - prev[0], y - prev[1]);
            duration = Math.min(2.0, Math.max(0.5, dist / speed));
        }

        map.flyTo([y - getMobileViewOffset(), x], 1.5, { animate: true, duration: 0.8 });
        idx++;
        window.navTimer = setTimeout(() => {
            requestAnimationFrame(step);
        }, duration * 1000 + 200);
    }

    step();
}
/**
 * 移动端抽屉展开时，地图视口需向上偏移以避免被遮挡
 * @returns {number} 地图 Y 坐标偏移量
 */
function getMobileViewOffset() {
    if (window.innerWidth > 768) return 0;
    const sidebar = document.getElementById('sidebar');
    const isCollapsed = sidebar?.classList.contains('collapsed');
    // 展开时，地图可视区域高度约为 45vh，需要向上平移约 200 坐标单位
    // 可通过实际测试调整该数值
    return isCollapsed ? 0 : 200;
}