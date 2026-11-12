class GoogleCalendarAPI {
    constructor() {
        this.gapiInited = false;
        this.tokenExpiry = 0;
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
                // API key is not needed for OAuth flows
                await gapi.client.init({
                    discoveryDocs: CONFIG.DISCOVERY_DOCS
                });
                this.gapiInited = true;
                resolve();
            });
        });
    }

    // Returns false only when the server has no Google authorization; throws on other failures.
    async ensureToken() {
        if (Date.now() < this.tokenExpiry - 60 * 1000) {
            return true;
        }

        const response = await fetch('api/token', { cache: 'no-store' });
        if (response.status === 401) {
            this.tokenExpiry = 0;
            gapi.client.setToken(null);
            return false;
        }
        if (!response.ok) {
            throw { status: response.status, message: 'Token fetch failed' };
        }

        const token = await response.json();
        gapi.client.setToken({ access_token: token.access_token });
        this.tokenExpiry = Date.now() + token.expires_in * 1000;
        return true;
    }

    signIn() {
        window.location.href = 'auth/login';
    }

    async requireToken() {
        if (!await this.ensureToken()) {
            throw { status: 401, message: 'Not authorized' };
        }
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
            await this.requireToken();
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
            await this.requireToken();
            const allEvents = [];

            const responses = await Promise.all(calendarIds.map(calendarId =>
                gapi.client.calendar.events.list({
                    calendarId: calendarId,
                    timeMin: new Date(startDate).toISOString(),
                    timeMax: new Date(endDate).toISOString(),
                    singleEvents: true,
                    orderBy: 'startTime',
                    maxResults: 2500
                })
            ));

            responses.forEach((response, i) => {
                const calendarId = calendarIds[i];

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
                            location: event.location || '',
                            calendar: calendar,
                            backgroundColor: eventColor
                        });
                    });
                }
            });

            this.saveToCache(cacheKey, allEvents);
            return allEvents;
        } catch (error) {
            console.error('Error fetching events:', error);
            throw error;
        }
    }

    saveToCache(key, data) {
        // Implement LRU-style cache limiting
        if (this.cache.size >= CONFIG.MAX_CACHE_ENTRIES) {
            // Remove oldest entry
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

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
