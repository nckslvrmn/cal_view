// Store hidden rather than selected calendars so newly added calendars show up by default.
const HIDDEN_CALENDARS_KEY = 'hiddenCalendars';

let calendar;
let hiddenCalendars = loadHiddenCalendars();
let allCalendars = [];
let autoRefreshInterval = null;
let lastInteraction = Date.now();
let latestEventsRequest = 0;

window.addEventListener('load', () => {
    initializeApp();
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000); // Update every second
});

async function initializeApp() {
    calendar = new CalendarRenderer();

    await api.initGapi();

    let authorized = false;
    try {
        authorized = await api.ensureToken();
    } catch (error) {
        console.error('Token fetch failed on startup:', error);
        authorized = true;
    }

    if (authorized) {
        showCalendarView();
        await loadCalendars();
        await loadEvents();
        startAutoRefresh();
        setupVisibilityListener();
        requestWakeLock();
    } else {
        showAuthView();
    }

    setupEventListeners();
}

function showAuthView() {
    document.getElementById('authContainer').style.display = 'flex';
    document.querySelector('.calendar-grid').style.display = 'none';
    document.getElementById('menuBtn').style.display = 'none';
    document.getElementById('refreshBtn').style.display = 'none';
    document.getElementById('agendaBtn').style.display = 'none';
    document.getElementById('loadingOverlay').classList.add('hidden');
    setAgendaOpen(false);
}

function showCalendarView() {
    document.getElementById('authContainer').style.display = 'none';
    document.querySelector('.calendar-grid').style.display = 'flex';
    document.getElementById('menuBtn').style.display = 'flex';
    document.getElementById('refreshBtn').style.display = 'flex';
    document.getElementById('agendaBtn').style.display = 'flex';
}

function openMenu() {
    document.getElementById('menuPanel').classList.remove('hidden');
    document.getElementById('menuBackdrop').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeMenu() {
    document.getElementById('menuPanel').classList.add('hidden');
    document.getElementById('menuBackdrop').classList.add('hidden');
    document.body.style.overflow = '';
}

function setAgendaOpen(open) {
    document.getElementById('agendaPanel').classList.toggle('open', open);
    const agendaBtn = document.getElementById('agendaBtn');
    agendaBtn.classList.toggle('active', open);
    agendaBtn.setAttribute('aria-expanded', open);
}

async function goToToday() {
    calendar.goToToday();
    await loadEvents();
}

async function showPrevious() {
    calendar.previous();
    await loadEvents();
}

async function showNext() {
    calendar.next();
    await loadEvents();
}

function setupEventListeners() {
    document.getElementById('authorizeBtn').addEventListener('click', () => {
        api.signIn();
    });

    document.addEventListener('pointerdown', () => {
        lastInteraction = Date.now();
    }, { capture: true, passive: true });

    document.getElementById('prevRange').addEventListener('click', showPrevious);
    document.getElementById('nextRange').addEventListener('click', showNext);
    document.getElementById('rangeTitle').addEventListener('click', goToToday);

    document.getElementById('refreshBtn').addEventListener('click', async () => {
        console.log('Manual refresh triggered');
        api.clearCache();
        await loadEvents(false);
    });

    const menuPanel = document.getElementById('menuPanel');

    document.getElementById('menuBtn').addEventListener('click', openMenu);
    document.getElementById('closeMenu').addEventListener('click', closeMenu);
    document.getElementById('menuBackdrop').addEventListener('click', closeMenu);

    document.getElementById('todayBtn').addEventListener('click', async () => {
        await goToToday();
        closeMenu();
    });

    // Prevent menu from closing when clicking inside
    menuPanel.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    document.getElementById('refreshCalendars').addEventListener('click', async () => {
        api.clearCache();
        await loadCalendars();
        await loadEvents(false);
    });

    const agendaPanel = document.getElementById('agendaPanel');
    document.getElementById('agendaBtn').addEventListener('click', () => {
        setAgendaOpen(!agendaPanel.classList.contains('open'));
    });
    document.getElementById('closeAgenda').addEventListener('click', () => setAgendaOpen(false));

    const daySheet = document.getElementById('daySheet');
    document.getElementById('closeDaySheet').addEventListener('click', () => calendar.closeDaySheet());
    daySheet.addEventListener('click', (e) => {
        if (e.target === daySheet) {
            calendar.closeDaySheet();
        }
    });

    addSwipeListener(document.getElementById('calendarBody'), showNext, showPrevious);
    addSwipeListener(agendaPanel, null, () => setAgendaOpen(false));
}

function addSwipeListener(element, onSwipeLeft, onSwipeRight) {
    let touchStartX = 0;
    let touchStartY = 0;

    element.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    element.addEventListener('touchend', (e) => {
        const deltaX = e.changedTouches[0].screenX - touchStartX;
        const deltaY = e.changedTouches[0].screenY - touchStartY;

        if (Math.abs(deltaX) <= Math.abs(deltaY) || Math.abs(deltaX) <= 50) {
            return;
        }

        const handler = deltaX > 0 ? onSwipeRight : onSwipeLeft;
        if (handler) {
            handler();
        }
    }, { passive: true });
}

function loadHiddenCalendars() {
    try {
        return new Set(JSON.parse(localStorage.getItem(HIDDEN_CALENDARS_KEY)) || []);
    } catch (error) {
        console.error('Failed to read hidden calendars:', error);
        return new Set();
    }
}

function saveHiddenCalendars() {
    try {
        localStorage.setItem(HIDDEN_CALENDARS_KEY, JSON.stringify(Array.from(hiddenCalendars)));
    } catch (error) {
        console.error('Failed to save hidden calendars:', error);
    }
}

async function loadCalendars() {
    try {
        const calendars = await api.getCalendars();
        allCalendars = calendars;
        calendar.setCalendars(calendars);

        renderCalendarList();
    } catch (error) {
        console.error('Error loading calendars:', error);
        showError('Failed to load calendars');
    }
}

function renderCalendarList() {
    const listEl = document.getElementById('calendarList');
    listEl.innerHTML = '';

    if (allCalendars.length === 0) {
        listEl.innerHTML = '<p class="loading">No calendars found</p>';
        return;
    }

    allCalendars.forEach(cal => {
        const item = document.createElement('div');
        item.className = 'calendar-item';
        if (!hiddenCalendars.has(cal.id)) {
            item.classList.add('active');
        }

        const checkbox = document.createElement('div');
        checkbox.className = 'calendar-checkbox';
        checkbox.style.backgroundColor = cal.backgroundColor;

        const name = document.createElement('div');
        name.className = 'calendar-name';
        name.textContent = cal.summary;
        name.title = cal.summary;

        item.appendChild(checkbox);
        item.appendChild(name);

        item.addEventListener('click', async () => {
            if (hiddenCalendars.has(cal.id)) {
                hiddenCalendars.delete(cal.id);
                item.classList.add('active');
            } else {
                hiddenCalendars.add(cal.id);
                item.classList.remove('active');
            }
            saveHiddenCalendars();

            await loadEvents();
        });

        listEl.appendChild(item);
    });
}

async function loadEvents(showLoading = true) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const refreshBtn = document.getElementById('refreshBtn');
    const request = ++latestEventsRequest;

    if (showLoading) {
        loadingOverlay.classList.remove('hidden');
    } else {
        // Show spinning icon during silent refresh
        refreshBtn.classList.add('refreshing');
    }

    try {
        document.getElementById('rangeTitle').textContent = calendar.getTitle();

        const calendarIds = allCalendars.filter(cal => !hiddenCalendars.has(cal.id)).map(cal => cal.id);
        if (calendarIds.length === 0) {
            calendar.setEvents([]);
            calendar.setAgendaEvents([]);
            calendar.render();
            calendar.renderAgenda();
            return;
        }

        const viewStart = calendar.getRangeStart();
        const viewEnd = calendar.getRangeEnd();
        const events = await fetchEvents(calendarIds, viewStart, viewEnd);

        const agendaStart = new Date();
        agendaStart.setHours(0, 0, 0, 0);
        const agendaEnd = new Date(agendaStart);
        agendaEnd.setDate(agendaEnd.getDate() + CONFIG.AGENDA_DAYS);

        const agendaEvents = viewStart <= agendaStart && agendaEnd <= viewEnd
            ? events
            : await fetchEvents(calendarIds, agendaStart, agendaEnd);

        if (request !== latestEventsRequest) {
            return;
        }

        calendar.setEvents(events);
        calendar.setAgendaEvents(agendaEvents);
        calendar.render();
        calendar.renderAgenda();
    } catch (error) {
        console.error('Error loading events:', error);

        if (error.status === 401) {
            stopAutoRefresh();
            showAuthView();
        } else {
            showError('Failed to load events');
        }
    } finally {
        if (request === latestEventsRequest) {
            loadingOverlay.classList.add('hidden');
            refreshBtn.classList.remove('refreshing');
        }
    }
}

// Pad a day on each side because the API reads the date strings as UTC midnight.
async function fetchEvents(calendarIds, start, end) {
    const paddedStart = new Date(start);
    paddedStart.setDate(paddedStart.getDate() - 1);
    const paddedEnd = new Date(end);
    paddedEnd.setDate(paddedEnd.getDate() + 1);

    const events = await api.getEvents(calendarIds, formatDate(paddedStart), formatDate(paddedEnd));
    return events.map(event => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end)
    }));
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function showError(message) {
    console.error(message);
}

function resetIfIdle() {
    if (Date.now() - lastInteraction < CONFIG.IDLE_RESET) {
        return;
    }

    closeMenu();
    setAgendaOpen(false);
    calendar.closeDaySheet();
    calendar.goToToday();
}

async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.hidden) {
        return;
    }

    try {
        await navigator.wakeLock.request('screen');
    } catch (error) {
        console.error('Wake lock request failed:', error);
    }
}

function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }

    autoRefreshInterval = setInterval(async () => {
        console.log('Auto-refreshing calendar events...');
        try {
            resetIfIdle();
            api.clearCache();
            await loadEvents(false);
        } catch (error) {
            console.error('Auto-refresh failed:', error);
        }
    }, CONFIG.AUTO_REFRESH_INTERVAL);

    console.log(`Auto-refresh enabled: polling every ${CONFIG.AUTO_REFRESH_INTERVAL / 1000} seconds`);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('Auto-refresh disabled');
    }
}

function setupVisibilityListener() {
    document.addEventListener('visibilitychange', async () => {
        if (document.hidden) {
            console.log('Page hidden - continuing auto-refresh in background');
        } else {
            console.log('Page visible - refreshing immediately');

            requestWakeLock();
            resetIfIdle();
            api.clearCache();
            await loadEvents(false);
        }
    });
}

function updateCurrentTime() {
    const now = new Date();
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });
}
