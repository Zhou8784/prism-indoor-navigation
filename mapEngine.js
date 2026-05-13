let map;
let currentFloor = 1;
// 【重要】必须改为全局变量，供 routing.js 调用
window.allRooms = [];
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
    window.allRooms = [];
    MAP_DATA.buildings.forEach(building => {
        building.floors.forEach(floor => {
            floor.rooms.forEach(room => {
                const polygon = room.polygon;
                if (!polygon || polygon.length < 3) return;
                let sumX = 0, sumY = 0;
                polygon.forEach(p => { sumX += p[0]; sumY += p[1]; });
                const center = [sumX / polygon.length, sumY / polygon.length];
                window.allRooms.push({
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
    const roomsOnFloor = window.allRooms.filter(r => r.floor_number === floor);
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
    renderRouteOnCurrentFloor(); 
}

function toggleViewMode() {
    alert('当前为 Leaflet 平面图，暂不支持 3D 视图。');
}

function filterPoiByTypes(activeTypes) {
    roomLayerGroup.clearLayers();
    const roomsOnFloor = window.allRooms.filter(r => r.floor_number === currentFloor && activeTypes.includes(r.type));
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
    const room = window.allRooms.find(r => r.room_id === roomId);
    if (room) {
        map.setView([room.center[1], room.center[0]], 1.5);
        filterFloor(room.floor_number);
        L.popup()
            .setLatLng([room.center[1], room.center[0]])
            .setContent(`<strong>${room.name}</strong><br>${room.type}`)
            .openOn(map);
    }
}

function getRoomCenter(roomId) {
    const room = window.allRooms.find(r => r.room_id === roomId);
    return room ? room.center : null;
}

function getStairCenters(floor) {
    return window.allRooms.filter(r => r.type === '楼梯间' && r.floor_number === floor).map(r => r.center);
}

function drawRoute(pathCoords) {
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

let is3D = false;

function toggle3D() {
    is3D = !is3D;
    const mapContainer = document.getElementById('map');
    const btn3d = document.getElementById('btn-3d');

    if (is3D) {
        mapContainer.style.transform = 'perspective(1000px) rotateX(50deg) scale(1.1)';
        btn3d.classList.add('bg-blue-600', 'text-white');
        btn3d.classList.remove('text-primary', 'bg-white');
        document.querySelectorAll('.leaflet-marker-icon, .leaflet-popup').forEach(el => {
            el.style.transform += ' rotateX(-30deg)';
        });
    } else {
        mapContainer.style.transform = 'none';
        btn3d.classList.remove('bg-blue-600', 'text-white');
        btn3d.classList.add('text-primary', 'bg-white');
        document.querySelectorAll('.leaflet-marker-icon, .leaflet-popup').forEach(el => {
            el.style.transform = el.style.transform.replace(' rotateX(-30deg)', '');
        });
    }
    
    setTimeout(() => {
        map.invalidateSize({animate: true});
    }, 500);
}

function startNavigationFollow(path) {
    if (!path || path.length < 2) return;

    let idx = 0;
    const speed = 120;

    function step() {
        if (idx >= path.length) {
            window.navTimer = null;
            return;
        }

        const [x, y, floor] = path[idx];
        if (floor !== currentFloor) {
            filterFloor(floor);
            setTimeout(() => {
                map.flyTo([y, x], 1.5, { animate: true, duration: 0.8 });
                idx++;
                window.navTimer = setTimeout(step, 800);
            }, 600);
            return;
        }

        let duration = 0.8;
        if (idx > 0) {
            const prev = path[idx - 1];
            const dist = Math.hypot(x - prev[0], y - prev[1]);
            duration = Math.min(2.0, Math.max(0.5, dist / speed));
        }

        map.flyTo([y, x], 1.5, { animate: true, duration });
        idx++;
        window.navTimer = setTimeout(() => {
            requestAnimationFrame(step);
        }, duration * 1000 + 200);
    }

    step();
}