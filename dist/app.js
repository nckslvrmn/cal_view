let calendar;
let selectedCalendars = new Set();
let allCalendars = [];
let autoRefreshInterval = null;
let tokenRefreshFailures = 0;
const MAX_REFRESH_FAILURES = 2;

window.addEventListener('load', () => {
    initializeApp();
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000); // Update every second
});

async function initializeApp() {
    calendar = new CalendarRenderer();

    await Promise.all([
        api.initGapi(),
        api.initGis()
    ]);

    if (api.checkStoredAuth()) {
        tokenRefreshFailures = 0; // Reset counter on successful auth check

        if (api.isTokenExpiringSoon()) {
            console.log('Token expiring soon on startup, refreshing...');
            const refreshSuccess = await api.refreshTokenSilently();
            if (!refreshSuccess) {
                console.warn('Startup token refresh failed, continuing anyway');
                tokenRefreshFailures = 1;
            }
        }

        showCalendarView();
        await loadCalendars();
        await loadEvents();
        startAutoRefresh();
        setupVisibilityListener();
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
    document.getElementById('signoutBtn').style.display = 'none';
    document.getElementById('loadingOverlay').classList.add('hidden');
}

function showCalendarView() {
    document.getElementById('authContainer').style.display = 'none';
    document.querySelector('.calendar-grid').style.display = 'flex';
    document.getElementById('menuBtn').style.display = 'flex';
    document.getElementById('refreshBtn').style.display = 'flex';
    document.getElementById('signoutBtn').style.display = 'flex';
}

function setupEventListeners() {
    document.getElementById('authorizeBtn').addEventListener('click', async () => {
        api.onAuthCallback = async () => {
            showCalendarView();
            await loadCalendars();
            await loadEvents();
            startAutoRefresh();
            setupVisibilityListener();
        };
        await api.signIn();
    });

    document.getElementById('signoutBtn').addEventListener('click', () => {
        api.signOut();
        stopAutoRefresh();
        showAuthView();
        calendar.setEvents([]);
        calendar.render();
    });

    document.getElementById('prevMonth').addEventListener('click', async () => {
        calendar.previousMonth();
        await loadEvents();
    });

    document.getElementById('nextMonth').addEventListener('click', async () => {
        calendar.nextMonth();
        await loadEvents();
    });

    document.getElementById('refreshBtn').addEventListener('click', async () => {
        console.log('Manual refresh triggered');
        api.clearCache();
        await loadEvents();
    });

    const menuBtn = document.getElementById('menuBtn');
    const menuPanel = document.getElementById('menuPanel');
    const closeMenu = document.getElementById('closeMenu');
    const menuBackdrop = document.getElementById('menuBackdrop');

    function openMenu() {
        menuPanel.classList.remove('hidden');
        menuBackdrop.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeMenuFn() {
        menuPanel.classList.add('hidden');
        menuBackdrop.classList.add('hidden');
        document.body.style.overflow = '';
    }

    menuBtn.addEventListener('click', openMenu);
    closeMenu.addEventListener('click', closeMenuFn);
    menuBackdrop.addEventListener('click', closeMenuFn);

    document.getElementById('todayBtn').addEventListener('click', async () => {
        calendar.goToToday();
        await loadEvents();
        closeMenuFn();
    });

    // Prevent menu from closing when clicking inside
    menuPanel.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    document.getElementById('refreshCalendars').addEventListener('click', async () => {
        api.clearCache();
        await loadCalendars();
        await loadEvents();
    });

    // Swipe gesture support for month navigation
    setupSwipeGestures();
}

function setupSwipeGestures() {
    const calendarBody = document.getElementById('calendarBody');
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;

    calendarBody.addEventListener('touchstart', (e) => {
        // Don't interfere with event taps
        if (e.target.closest('.event')) {
            return;
        }
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    calendarBody.addEventListener('touchend', async (e) => {
        // Don't interfere with event taps
        if (e.target.closest('.event')) {
            return;
        }
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;

        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;

        // Check if it's a horizontal swipe (more horizontal than vertical)
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // Swipe threshold of 50 pixels
            if (Math.abs(deltaX) > 50) {
                if (deltaX > 0) {
                    // Swipe right - previous month
                    calendar.previousMonth();
                    await loadEvents();
                } else {
                    // Swipe left - next month
                    calendar.nextMonth();
                    await loadEvents();
                }
            }
        }
    }, { passive: true });
}

async function loadCalendars() {
    try {
        const calendars = await api.getCalendars();
        allCalendars = calendars;
        calendar.setCalendars(calendars);

        if (selectedCalendars.size === 0) {
            calendars.forEach(cal => selectedCalendars.add(cal.id));
        }

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
        if (selectedCalendars.has(cal.id)) {
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
            if (selectedCalendars.has(cal.id)) {
                selectedCalendars.delete(cal.id);
                item.classList.remove('active');
            } else {
                selectedCalendars.add(cal.id);
                item.classList.add('active');
            }

            await loadEvents();
        });

        listEl.appendChild(item);
    });
}

async function loadEvents(showLoading = true) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const refreshBtn = document.getElementById('refreshBtn');

    if (showLoading) {
        loadingOverlay.classList.remove('hidden');
    } else {
        // Show spinning icon during silent refresh
        refreshBtn.classList.add('refreshing');
    }

    try {
        document.getElementById('currentMonth').textContent = calendar.getMonthName();

        const firstDay = calendar.getFirstDayOfMonth();
        const lastDay = calendar.getLastDayOfMonth();

        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - 7);

        const endDate = new Date(lastDay);
        endDate.setDate(endDate.getDate() + 7);

        const startStr = formatDate(startDate);
        const endStr = formatDate(endDate);

        const calendarIds = Array.from(selectedCalendars);
        if (calendarIds.length === 0) {
            calendar.setEvents([]);
            calendar.render();
            return;
        }

        const events = await api.getEvents(calendarIds, startStr, endStr);

        const localEvents = events.map(event => ({
            ...event,
            start: new Date(event.start),
            end: new Date(event.end)
        }));

        calendar.setEvents(localEvents);
        calendar.render();
    } catch (error) {
        console.error('Error loading events:', error);

        if (error.status === 401 || error.status === 403) {
            console.log('Auth error detected, attempting to refresh token...');

            if (tokenRefreshFailures >= MAX_REFRESH_FAILURES) {
                console.error('Max refresh failures reached, stopping attempts');
                stopAutoRefresh();
                showAuthRequiredMessage();
                return;
            }

            const refreshSuccess = await api.refreshTokenSilently();

            if (refreshSuccess) {
                console.log('Token refreshed, retrying...');
                tokenRefreshFailures = 0; // Reset counter on success
                await loadEvents(false);
            } else {
                tokenRefreshFailures++;
                console.error(`Token refresh failed (attempt ${tokenRefreshFailures}/${MAX_REFRESH_FAILURES})`);

                if (tokenRefreshFailures >= MAX_REFRESH_FAILURES) {
                    stopAutoRefresh();
                    showAuthRequiredMessage();
                } else {
                    showError('Authentication expired. Please refresh the page.');
                }
            }
        } else {
            showError('Failed to load events');
        }
    } finally {
        if (showLoading) {
            loadingOverlay.classList.add('hidden');
        } else {
            refreshBtn.classList.remove('refreshing');
        }
    }
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

function showAuthRequiredMessage() {
    console.error('Session expired - please refresh the page to re-authenticate');

    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.innerHTML = `
            <div style="color: white; text-align: center; padding: 20px;">
                <h2>Session Expired</h2>
                <p>Please refresh the page to continue</p>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; font-size: 16px; cursor: pointer;">
                    Refresh Page
                </button>
            </div>
        `;
        loadingOverlay.classList.remove('hidden');
    }
}

function shouldAdvanceToCurrentMonth() {
    const today = new Date();
    const currentMonth = calendar.currentDate.getMonth();
    const currentYear = calendar.currentDate.getFullYear();
    const todayMonth = today.getMonth();
    const todayYear = today.getFullYear();

    return currentMonth !== todayMonth || currentYear !== todayYear;
}

function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }

    autoRefreshInterval = setInterval(async () => {
        console.log('Auto-refreshing calendar events...');
        try {
            if (api.isTokenExpiringSoon()) {
                console.log('Token expiring soon, refreshing...');

                if (tokenRefreshFailures >= MAX_REFRESH_FAILURES) {
                    console.error('Max refresh failures reached, stopping auto-refresh');
                    stopAutoRefresh();
                    showAuthRequiredMessage();
                    return;
                }

                const refreshSuccess = await api.refreshTokenSilently();
                if (!refreshSuccess) {
                    tokenRefreshFailures++;
                    console.error(`Token refresh failed in auto-refresh (attempt ${tokenRefreshFailures}/${MAX_REFRESH_FAILURES})`);

                    if (tokenRefreshFailures >= MAX_REFRESH_FAILURES) {
                        stopAutoRefresh();
                        showAuthRequiredMessage();
                    }
                    return;
                } else {
                    tokenRefreshFailures = 0; // Reset on success
                }
            }

            if (shouldAdvanceToCurrentMonth()) {
                console.log('Advancing to current month');
                calendar.goToToday();
            }

            api.clearCache();
            await loadEvents(false);
        } catch (error) {
            console.error('Auto-refresh failed:', error);
            if (error.status === 401 || error.status === 403) {
                console.log('Auth error detected in auto-refresh');

                if (tokenRefreshFailures >= MAX_REFRESH_FAILURES) {
                    console.error('Max refresh failures reached, stopping auto-refresh');
                    stopAutoRefresh();
                    showAuthRequiredMessage();
                    return;
                }

                const refreshSuccess = await api.refreshTokenSilently();
                if (!refreshSuccess) {
                    tokenRefreshFailures++;
                    console.error(`Token refresh failed (attempt ${tokenRefreshFailures}/${MAX_REFRESH_FAILURES})`);

                    if (tokenRefreshFailures >= MAX_REFRESH_FAILURES) {
                        stopAutoRefresh();
                        showAuthRequiredMessage();
                    }
                } else {
                    tokenRefreshFailures = 0; // Reset on success
                }
            }
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

            if (api.isTokenExpiringSoon()) {
                console.log('Token expiring soon, refreshing...');

                if (tokenRefreshFailures >= MAX_REFRESH_FAILURES) {
                    console.error('Max refresh failures reached');
                    showAuthRequiredMessage();
                    return;
                }

                const refreshSuccess = await api.refreshTokenSilently();
                if (!refreshSuccess) {
                    tokenRefreshFailures++;
                    console.error(`Token refresh failed on visibility change (attempt ${tokenRefreshFailures}/${MAX_REFRESH_FAILURES})`);

                    if (tokenRefreshFailures >= MAX_REFRESH_FAILURES) {
                        stopAutoRefresh();
                        showAuthRequiredMessage();
                        return;
                    }
                } else {
                    tokenRefreshFailures = 0; // Reset on success
                }
            }

            if (shouldAdvanceToCurrentMonth()) {
                console.log('Advancing to current month');
                calendar.goToToday();
            }

            api.clearCache();
            await loadEvents(false);
        }
    });
}

function updateCurrentTime() {
    const timeEl = document.getElementById('currentTime');
    if (timeEl) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        timeEl.textContent = timeStr;
    }
}
