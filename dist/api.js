class GoogleCalendarAPI {
    constructor() {
        this.tokenClient = null;
        this.gapiInited = false;
        this.gisInited = false;
        this.isSignedIn = false;
        this.cache = new Map();
        this.calendarsById = new Map();

        // Google Calendar color palette (event colors)
        this.eventColors = {
            '1': '#a4bdfc',  // Lavender
            '2': '#7ae7bf',  // Sage
            '3': '#dbadff',  // Grape
            '4': '#ff887c',  // Flamingo
            '5': '#fbd75b',  // Banana
            '6': '#ffb878',  // Tangerine
            '7': '#46d6db',  // Peacock
            '8': '#e1e1e1',  // Graphite
            '9': '#5484ed',  // Blueberry
            '10': '#51b749', // Basil
            '11': '#dc2127'  // Tomato
        };
    }

    async initGapi() {
        return new Promise((resolve) => {
            gapi.load('client', async () => {
                const initConfig = {
                    discoveryDocs: CONFIG.DISCOVERY_DOCS
                };

                if (CONFIG.API_KEY && CONFIG.API_KEY !== 'YOUR_API_KEY_HERE') {
                    initConfig.apiKey = CONFIG.API_KEY;
                }

                await gapi.client.init(initConfig);
                this.gapiInited = true;
                resolve();
            });
        });
    }

    initGis() {
        return new Promise((resolve) => {
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CONFIG.CLIENT_ID,
                scope: CONFIG.SCOPES,
                callback: (response) => {
                    if (response.error) {
                        console.error('Token response error:', response);
                        return;
                    }
                    this.isSignedIn = true;
                    this.saveAuthToStorage();
                    if (this.onAuthCallback) {
                        this.onAuthCallback();
                    }
                }
            });
            this.gisInited = true;
            resolve();
        });
    }

    checkStoredAuth() {
        const token = localStorage.getItem('gapi_token');
        const expiry = localStorage.getItem('gapi_token_expiry');

        if (token && expiry) {
            const expiryDate = new Date(expiry);
            if (expiryDate > new Date()) {
                gapi.client.setToken({ access_token: token });
                this.isSignedIn = true;
                return true;
            }
        }
        return false;
    }

    saveAuthToStorage() {
        const token = gapi.client.getToken();
        if (token) {
            localStorage.setItem('gapi_token', token.access_token);
            const expiry = new Date();
            expiry.setHours(expiry.getHours() + 1);
            localStorage.setItem('gapi_token_expiry', expiry.toISOString());
        }
    }

    clearAuthFromStorage() {
        localStorage.removeItem('gapi_token');
        localStorage.removeItem('gapi_token_expiry');
    }

    async signIn() {
        if (!this.gisInited || !this.gapiInited) {
            console.error('API not initialized');
            return;
        }

        this.tokenClient.requestAccessToken({ prompt: 'consent' });
    }

    async refreshTokenSilently() {
        if (!this.gisInited || !this.gapiInited) {
            console.error('API not initialized');
            return false;
        }

        return new Promise((resolve, reject) => {
            const originalCallback = this.onAuthCallback;
            let timeoutId;

            const refreshCallback = () => {
                clearTimeout(timeoutId);
                this.onAuthCallback = originalCallback;
                resolve(true);
            };

            timeoutId = setTimeout(() => {
                this.onAuthCallback = originalCallback;
                console.error('Token refresh timeout');
                resolve(false);
            }, 10000);

            this.onAuthCallback = refreshCallback;
            this.tokenClient.requestAccessToken({ prompt: '' });
        });
    }

    isTokenExpiringSoon() {
        const expiry = localStorage.getItem('gapi_token_expiry');
        if (!expiry) return true;

        const expiryDate = new Date(expiry);
        const now = new Date();
        const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

        return expiryDate <= fiveMinutesFromNow;
    }

    signOut() {
        const token = gapi.client.getToken();
        if (token) {
            google.accounts.oauth2.revoke(token.access_token);
            gapi.client.setToken(null);
        }
        this.isSignedIn = false;
        this.clearAuthFromStorage();
        this.cache.clear();
    }

    isAuthenticated() {
        return this.isSignedIn;
    }

    async getCalendars() {
        const cacheKey = 'calendars_list';

        const cached = this.getFromCache(cacheKey);
        if (cached) {
            cached.forEach(cal => {
                this.calendarsById.set(cal.id, cal);
            });
            return cached;
        }

        try {
            const response = await gapi.client.calendar.calendarList.list();

            const calendars = response.result.items.map(cal => ({
                id: cal.id,
                summary: cal.summary,
                backgroundColor: cal.backgroundColor
            }));

            calendars.forEach(cal => {
                this.calendarsById.set(cal.id, cal);
            });

            this.saveToCache(cacheKey, calendars);
            return calendars;
        } catch (error) {
            console.error('Error fetching calendars:', error);
            throw error;
        }
    }

    async getEvents(calendarIds, startDate, endDate) {
        const cacheKey = `events_${calendarIds.join(',')}_${startDate}_${endDate}`;

        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const allEvents = [];

            for (const calendarId of calendarIds) {
                const response = await gapi.client.calendar.events.list({
                    calendarId: calendarId,
                    timeMin: new Date(startDate).toISOString(),
                    timeMax: new Date(endDate).toISOString(),
                    singleEvents: true,
                    orderBy: 'startTime',
                    maxResults: 2500
                });

                if (response.result.items) {
                    response.result.items.forEach(event => {
                        const calendar = this.calendarsById.get(calendarId) || {
                            id: calendarId,
                            summary: 'Unknown Calendar',
                            backgroundColor: '#4285F4'
                        };

                        // Determine event color priority:
                        // 1. Event's explicit backgroundColor
                        // 2. Event's colorId mapped to actual color
                        // 3. Calendar's backgroundColor
                        let eventColor = event.backgroundColor;
                        if (!eventColor && event.colorId) {
                            eventColor = this.eventColors[event.colorId];
                        }
                        if (!eventColor) {
                            eventColor = calendar.backgroundColor;
                        }

                        const startDateTime = event.start.dateTime || event.start.date;
                        const endDateTime = event.end.dateTime || event.end.date;
                        const isAllDay = !event.start.dateTime;

                        allEvents.push({
                            id: event.id,
                            title: event.summary || '(No title)',
                            start: startDateTime,
                            end: endDateTime,
                            startStr: isAllDay ? event.start.date : startDateTime,
                            endStr: isAllDay ? event.end.date : endDateTime,
                            allDay: isAllDay,
                            description: event.description || '',
                            calendar: calendar,
                            backgroundColor: eventColor
                        });
                    });
                }
            }

            this.saveToCache(cacheKey, allEvents);
            return allEvents;
        } catch (error) {
            console.error('Error fetching events:', error);
            throw error;
        }
    }

    saveToCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached) {
            const age = Date.now() - cached.timestamp;
            if (age < CONFIG.CACHE_DURATION) {
                return cached.data;
            } else {
                this.cache.delete(key);
            }
        }
        return null;
    }

    clearCache() {
        this.cache.clear();
    }
}

const api = new GoogleCalendarAPI();
