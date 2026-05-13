let reminderMinutes = APP_CONFIG.defaultReminder;
let timers = [];

function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission();
    }
}

// 建议替换 notification.js 中的 scheduleReminders 函数
function scheduleReminders(schedule) {
    timers.forEach(clearTimeout);
    timers = [];
    
    schedule.forEach(course => {
        if (!course.time) return;

        // 1. 提取时间（例如从 "周一 14:30-15:55" 提取 "14:30"）
        const timeMatch = course.time.match(/(\d{1,2}):(\d{2})/);
        if (!timeMatch) return;

        const now = new Date();
        const targetTime = new Date(now);
        targetTime.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0);

        // 2. 计算差值（毫秒）
        const timeDiff = targetTime - now - reminderMinutes * 60000;

        // 3. 只有当课程还没开始时才设置提醒
        if (timeDiff > 0) {
            const timer = setTimeout(() => {
                // 使用更专业的 SweetAlert2 弹窗（你们 index.html 已经引入了）
                Swal.fire({
                    title: '上课提醒',
                    text: `${course.name} 即将在 ${course.room} 开始，请前往导航`,
                    icon: 'info',
                    confirmButtonText: '立即导航',
                    confirmButtonColor: '#003f87'
                }).then((result) => {
                    if (result.isConfirmed) {
                        window.navigateToRoom(course.roomId || course.room);
                    }
                });
            }, timeDiff);
            timers.push(timer);
        }
    });
}
function setReminderMinutes(minutes) {
    reminderMinutes = minutes;
    const schedule = loadSchedule();
    scheduleReminders(schedule);
}