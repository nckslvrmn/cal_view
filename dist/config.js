const CONFIG = {
    DISCOVERY_DOCS: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
    CACHE_DURATION: 15 * 60 * 1000, // 15 minutes
    AUTO_REFRESH_INTERVAL: 60 * 1000, // 60 seconds
    MAX_CACHE_ENTRIES: 256 // Prevent unlimited memory growth
};
