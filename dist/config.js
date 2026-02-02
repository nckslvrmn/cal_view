const CONFIG = {
    CLIENT_ID: '1026867044464-6aprl7sls8p2u03ouboi15k25us96tal.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/calendar.readonly',
    DISCOVERY_DOCS: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
    CACHE_DURATION: 15 * 60 * 1000, // 15 minutes
    AUTO_REFRESH_INTERVAL: 60 * 1000, // 60 seconds
    MAX_CACHE_ENTRIES: 256 // Prevent unlimited memory growth
};
