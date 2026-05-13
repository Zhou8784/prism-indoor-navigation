const STORAGE_KEY = 'campus_schedule';
function saveSchedule(schedule) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
}
function loadSchedule() {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
}