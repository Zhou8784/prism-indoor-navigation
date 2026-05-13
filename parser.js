function parseScheduleText(text) {
    const lines = text.split('\n');
    const schedule = [];
    
    lines.forEach(line => {
        line = line.trim();
        if (!line) return;
        
        // 匹配房间号：如 "3栋2楼203"
        const roomMatch = line.match(/(\d+)栋(\d+)楼(\d+)/);
        if (!roomMatch) return;
        
        const building = roomMatch[1];
        const floor = roomMatch[2];
        const roomNum = roomMatch[3];
        const roomName = `${building}栋${floor}楼${roomNum}`;
        const roomId = `${building}-${roomNum}`;
        
        // 提取时间
        const timeMatch = line.match(/\d{1,2}:\d{2}[—\-]\d{1,2}:\d{2}/);
        const time = timeMatch ? timeMatch[0] : '';
        
        // 提取星期
        const weekdayMatch = line.match(/周[一二三四五六日]/);
        const weekday = weekdayMatch ? weekdayMatch[0] : '';
        
        // 提取课程名（在时间之后，房间号之前）
        let courseName = '未知课程';
        if (timeMatch) {
            const timeIndex = line.indexOf(timeMatch[0]) + timeMatch[0].length;
            const roomIndex = line.indexOf(roomName);
            if (roomIndex > timeIndex) {
                courseName = line.substring(timeIndex, roomIndex).trim();
            }
        }
        
        schedule.push({
            id: `imported_${Date.now()}_${schedule.length}`,
            name: courseName,
            room: roomName,
            roomId: roomId,
            time: `${weekday} ${time}`
        });
    });
    
    return schedule;
}

// 优化 parser.js 中的 mapToRoomId
function mapToRoomId(roomName) {
    if (!roomName) return null;
    
    // 1. 标准化输入：统一将 "-" 替换成空，去除空格
    const cleanName = roomName.replace(/[-楼栋]/g, ''); 

    // 2. 尝试从 allRooms 里的 room_id 或 name 进行模糊匹配
    const match = allRooms.find(r => 
        r.room_id.replace('-', '') === cleanName || 
        r.name.includes(roomName)
    );
    
    return match ? match.room_id : null;
}