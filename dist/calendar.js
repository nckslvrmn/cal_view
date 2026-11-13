class CalendarRenderer {
    constructor() {
        this.startDate = this.weekStart(new Date());
        this.events = [];
        this.agendaEvents = [];
        this.cellDates = [];
        this.calendars = new Map();
        this.calendarBody = document.getElementById('calendarBody');
        this.agendaList = document.getElementById('agendaList');
        this.daySheet = document.getElementById('daySheet');
        this.daySheetTitle = document.getElementById('daySheetTitle');
        this.daySheetList = document.getElementById('daySheetList');

        this.calendarBody.addEventListener('click', (e) => this.handleGridClick(e));

        let resizeFrame = null;
        new ResizeObserver(() => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => this.render());
        }).observe(this.calendarBody);
    }

    weekStart(date) {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        start.setDate(start.getDate() - start.getDay());
        return start;
    }

    getRangeStart() {
        return new Date(this.startDate);
    }

    getRangeEnd() {
        const end = new Date(this.startDate);
        end.setDate(end.getDate() + CONFIG.WEEKS_SHOWN * 7);
        return end;
    }

    getTitle() {
        const start = this.startDate;
        const last = this.getRangeEnd();
        last.setDate(last.getDate() - 1);

        if (start.getMonth() === last.getMonth()) {
            return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }

        const sameYear = start.getFullYear() === last.getFullYear();
        const startLabel = start.toLocaleDateString('en-US', sameYear ? { month: 'short' } : { month: 'short', year: 'numeric' });
        const lastLabel = last.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        return `${startLabel} – ${lastLabel}`;
    }

    setEvents(events) {
        this.events = events;
    }

    setAgendaEvents(events) {
        this.agendaEvents = events;
    }

    setCalendars(calendars) {
        this.calendars.clear();
        calendars.forEach(cal => {
            this.calendars.set(cal.id, cal);
        });
    }

    render() {
        this.calendarBody.innerHTML = '';

        const today = new Date();
        const todayStr = today.toLocaleDateString('en-CA');

        let focusMonth = today;
        if (today < this.startDate || today >= this.getRangeEnd()) {
            focusMonth = new Date(this.startDate);
            focusMonth.setDate(focusMonth.getDate() + Math.floor(CONFIG.WEEKS_SHOWN * 7 / 2));
        }

        // Store cell dates for multi-day event calculation
        const cellDates = [];
        const cellElements = [];

        for (let i = 0; i < CONFIG.WEEKS_SHOWN * 7; i++) {
            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            cell.dataset.index = i;

            const currentCellDate = new Date(this.startDate);
            currentCellDate.setDate(currentCellDate.getDate() + i);

            const cellDateStr = currentCellDate.toLocaleDateString('en-CA');
            if (cellDateStr === todayStr) {
                cell.classList.add('today');
            } else if (cellDateStr < todayStr) {
                cell.classList.add('past');
            }

            if (currentCellDate.getMonth() !== focusMonth.getMonth() || currentCellDate.getFullYear() !== focusMonth.getFullYear()) {
                cell.classList.add('other-month');
            }

            const dayNumberEl = document.createElement('div');
            dayNumberEl.className = 'day-number';
            dayNumberEl.textContent = i === 0 || currentCellDate.getDate() === 1
                ? currentCellDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : currentCellDate.getDate();
            cell.appendChild(dayNumberEl);

            const eventsContainer = document.createElement('div');
            eventsContainer.className = 'day-events';
            cell.appendChild(eventsContainer);

            cellDates.push(currentCellDate);
            cellElements.push(cell);
            this.calendarBody.appendChild(cell);
        }

        this.cellDates = cellDates;

        // Render events with multi-day spanning
        this.renderAllEvents(cellDates, cellElements);
        cellElements.forEach(cell => this.fitDayEvents(cell.querySelector('.day-events')));
    }

    fitDayEvents(container) {
        const events = Array.from(container.querySelectorAll(':scope > .event:not(.event-multi-day)'));
        const limit = container.clientHeight;
        const overflows = el => el.offsetTop + el.offsetHeight > limit;

        let visible = events.findIndex(overflows);
        if (visible === -1) {
            return;
        }

        const moreEl = document.createElement('div');
        moreEl.className = 'more-events';
        container.appendChild(moreEl);

        for (;;) {
            events.slice(visible).forEach(el => { el.style.display = 'none'; });
            moreEl.textContent = `+${events.length - visible} more`;
            if (visible === 0 || !overflows(moreEl)) {
                break;
            }
            visible--;
        }
    }

    handleGridClick(e) {
        const cell = e.target.closest('.calendar-day');
        if (!cell) {
            return;
        }

        let index = Number(cell.dataset.index);

        // Multi-day bars live in their first cell but draw across later ones, so find the tapped day by x.
        const bar = e.target.closest('.event-multi-day');
        if (bar) {
            const offset = Math.floor((e.clientX - bar.getBoundingClientRect().left) / cell.getBoundingClientRect().width);
            index += Math.max(0, Math.min(offset, Number(bar.dataset.spanDays) - 1));
        }

        this.openDaySheet(this.cellDates[index], this.events);
    }

    renderAllEvents(cellDates, cellElements) {
        const renderedMultiDayEvents = new Set();

        // First pass: count how many multi-day events pass through each cell
        const multiDayCountByCell = new Array(cellDates.length).fill(0);
        const multiDayPositionMap = new Map(); // Maps event key to its vertical position

        // Collect all unique multi-day events
        const allMultiDayEvents = new Map();
        cellDates.forEach((cellDate, cellIndex) => {
            const dayEvents = this.getEventsForDay(cellDate);
            dayEvents.forEach(event => {
                if (event.allDay && this.isMultiDayEvent(event)) {
                    const eventKey = event.id + event.startStr;
                    if (!allMultiDayEvents.has(eventKey)) {
                        allMultiDayEvents.set(eventKey, event);
                    }
                }
            });
        });

        // Sort multi-day events by start date (and id as tiebreaker) for stable positioning
        const sortedMultiDayEvents = Array.from(allMultiDayEvents.values()).sort((a, b) => {
            if (a.startStr !== b.startStr) {
                return a.startStr.localeCompare(b.startStr);
            }
            return a.id.localeCompare(b.id);
        });


        // Assign positions to multi-day events using a track-based algorithm
        // This ensures events don't overlap and get assigned to the lowest available track
        const assignedTracks = new Map(); // Maps event key to track number
        const tracksByDate = new Map(); // Maps date string to array of occupied tracks

        sortedMultiDayEvents.forEach((event) => {
            const eventKey = event.id + event.startStr;

            // Find all dates this event spans
            const eventDates = [];
            cellDates.forEach((cellDate) => {
                const cellDateStr = cellDate.toLocaleDateString('en-CA');
                if (cellDateStr >= event.startStr && cellDateStr < event.endStr) {
                    eventDates.push(cellDateStr);
                }
            });

            // Find the lowest available track across all dates this event spans
            let track = 0;
            while (true) {
                let trackAvailable = true;
                for (const dateStr of eventDates) {
                    const occupiedTracks = tracksByDate.get(dateStr) || [];
                    if (occupiedTracks.includes(track)) {
                        trackAvailable = false;
                        break;
                    }
                }
                if (trackAvailable) break;
                track++;
            }

            // Assign this event to the found track
            assignedTracks.set(eventKey, track);

            // Mark this track as occupied for all dates this event spans
            for (const dateStr of eventDates) {
                const occupiedTracks = tracksByDate.get(dateStr) || [];
                occupiedTracks.push(track);
                tracksByDate.set(dateStr, occupiedTracks);
            }
        });

        // Use assigned tracks for positioning
        multiDayPositionMap.clear();
        assignedTracks.forEach((track, eventKey) => {
            multiDayPositionMap.set(eventKey, track);
        });

        // Count the maximum number of tracks for each cell
        cellDates.forEach((cellDate, cellIndex) => {
            const cellDateStr = cellDate.toLocaleDateString('en-CA');
            const occupiedTracks = tracksByDate.get(cellDateStr) || [];
            multiDayCountByCell[cellIndex] = occupiedTracks.length;
        });

        // Second pass: render events
        cellDates.forEach((cellDate, cellIndex) => {
            const eventsContainer = cellElements[cellIndex].querySelector('.day-events');
            const dayEvents = this.getEventsForDay(cellDate);

            // Separate multi-day all-day events from others
            const multiDayAllDayEvents = [];
            const regularEvents = [];

            dayEvents.forEach(event => {
                if (event.allDay && this.isMultiDayEvent(event)) {
                    multiDayAllDayEvents.push(event);
                } else {
                    regularEvents.push(event);
                }
            });

            // Render multi-day events (only on their first visible day in the week)
            multiDayAllDayEvents.forEach(event => {
                const eventKey = event.id + event.startStr;
                const spanInfo = this.calculateEventSpan(event, cellDate, cellIndex, cellDates);

                if (spanInfo.isFirstDay) {
                    // Use a unique key that includes the row/week to allow the same event
                    // to be rendered multiple times when it crosses week boundaries
                    const renderKey = eventKey + '_week' + spanInfo.weekRow;

                    if (!renderedMultiDayEvents.has(renderKey)) {
                        const position = multiDayPositionMap.get(eventKey) || 0;
                        this.renderMultiDayEvent(eventsContainer, event, spanInfo, position);
                        renderedMultiDayEvents.add(renderKey);
                    }
                }
            });

            // Add spacer for multi-day events to push regular events down
            const multiDayCount = multiDayCountByCell[cellIndex];
            if (multiDayCount > 0) {
                const spacer = document.createElement('div');
                spacer.className = 'multi-day-spacer';
                spacer.style.height = `${multiDayCount * 28}px`; // ~28px per multi-day event
                eventsContainer.appendChild(spacer);
            }

            // Render regular events
            this.renderDayEvents(eventsContainer, regularEvents);
        });
    }

    isMultiDayEvent(event) {
        if (!event.allDay) return false;

        const start = new Date(event.startStr);
        const end = new Date(event.endStr);

        // Calculate day difference
        const diffTime = end - start;
        const diffDays = diffTime / (1000 * 60 * 60 * 24);

        // Events that span MORE than 1 day (i.e., 2+ days) should be rendered as connected bars
        // Example: 1/16-1/17 in Google = start: 1/16, end: 1/18 → diffDays = 2 → multi-day
        // Example: 1/16 only in Google = start: 1/16, end: 1/17 → diffDays = 1 → single day
        return diffDays > 1;
    }

    calculateEventSpan(event, cellDate, cellIndex, cellDates) {
        const eventStartDate = event.startStr;
        const eventEndDate = event.endStr;
        const cellDateStr = cellDate.toLocaleDateString('en-CA');

        // Check if this cell is within the event's date range
        const isInEventRange = cellDateStr >= eventStartDate && cellDateStr < eventEndDate;

        if (!isInEventRange) {
            return { isFirstDay: false };
        }

        const dayInWeek = cellIndex % 7;

        // Determine if we should render this event starting from this cell
        let shouldRender = false;

        // Case 1: This is the actual first day of the event
        if (eventStartDate === cellDateStr) {
            shouldRender = true;
        }
        // Case 2: Event started before this week, and this is the first day of the week (Sunday)
        else if (dayInWeek === 0 && eventStartDate < cellDateStr) {
            shouldRender = true;
        }
        // Case 3: Event started before the visible calendar, and this is the first visible cell
        else if (cellIndex === 0 && eventStartDate < cellDateStr) {
            shouldRender = true;
        }

        if (!shouldRender) {
            return { isFirstDay: false };
        }

        // Calculate how many consecutive days to span
        let spanDays = 0;
        const weekRow = Math.floor(cellIndex / 7);
        const maxSpanInWeek = 7 - dayInWeek; // Days remaining in the week

        for (let i = 0; i < maxSpanInWeek && (cellIndex + i) < cellDates.length; i++) {
            const checkDate = cellDates[cellIndex + i].toLocaleDateString('en-CA');
            if (checkDate >= eventStartDate && checkDate < eventEndDate) {
                spanDays++;
            } else {
                break;
            }
        }

        return {
            isFirstDay: true,
            spanDays: spanDays,
            weekRow: weekRow
        };
    }

    renderMultiDayEvent(container, event, spanInfo, position = 0) {
        const eventEl = document.createElement('div');
        eventEl.className = 'event event-multi-day all-day';
        eventEl.dataset.spanDays = spanInfo.spanDays;

        // Calculate width to span multiple days across the grid
        // We need to account for the cell width and borders between cells
        // Using a custom property that will be set via CSS
        eventEl.style.setProperty('--span-days', spanInfo.spanDays);

        // Position vertically based on how many other multi-day events are above this one
        eventEl.style.top = `${position * 28}px`; // Stack vertically with 28px spacing

        if (this.isEnded(event, new Date())) {
            eventEl.classList.add('ended');
        }

        if (event.backgroundColor) {
            eventEl.style.backgroundColor = event.backgroundColor;
            eventEl.style.color = this.getContrastColor(event.backgroundColor);
        }

        const titleSpan = document.createElement('span');
        titleSpan.textContent = event.title || '(No title)';
        eventEl.appendChild(titleSpan);

        container.appendChild(eventEl);
    }

    isEnded(event, now) {
        if (event.allDay) {
            return event.endStr <= now.toLocaleDateString('en-CA');
        }
        return event.end <= now;
    }

    getEventsForDay(date, events = this.events) {
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);

        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);

        return events.filter(event => {
            if (event.allDay) {
                const dayDate = date.toLocaleDateString('en-CA');

                const eventStartDate = event.startStr;
                const eventEndDate = event.endStr;

                return eventStartDate <= dayDate && dayDate < eventEndDate;
            } else {
                const eventStart = new Date(event.start);
                const eventEnd = new Date(event.end);
                return eventStart < dayEnd && eventEnd > dayStart;
            }
        }).sort((a, b) => {
            if (a.allDay && !b.allDay) return -1;
            if (!a.allDay && b.allDay) return 1;

            return new Date(a.start) - new Date(b.start);
        });
    }

    renderDayEvents(container, events) {
        const now = new Date();

        events.forEach(event => {
            const eventEl = document.createElement('div');
            eventEl.className = 'event';

            if (event.allDay) {
                eventEl.classList.add('all-day');
            }

            if (this.isEnded(event, now)) {
                eventEl.classList.add('ended');
            }

            if (event.backgroundColor) {
                eventEl.style.backgroundColor = event.backgroundColor;
                eventEl.style.color = this.getContrastColor(event.backgroundColor);
            }

            // Format with time on same line as title for better readability
            if (!event.allDay) {
                const startTime = new Date(event.start);
                const timeSpan = document.createElement('span');
                timeSpan.className = 'event-time';
                timeSpan.textContent = this.formatTime(startTime) + ' ';
                eventEl.appendChild(timeSpan);
            }

            const titleSpan = document.createElement('span');
            titleSpan.textContent = event.title || '(No title)';
            eventEl.appendChild(titleSpan);

            container.appendChild(eventEl);
        });
    }

    formatTime(date) {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    getContrastColor(hexColor) {
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);

        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        return luminance > 0.5 ? '#1a1a2e' : '#ffffff';
    }

    formatDateRange(event) {
        // For all-day events, parse date strings carefully to avoid timezone issues
        // Date strings from Google Calendar are in YYYY-MM-DD format and should be treated as local dates
        const [startYear, startMonth, startDay] = event.startStr.split('-').map(Number);
        const [endYear, endMonth, endDay] = event.endStr.split('-').map(Number);

        const startDate = new Date(startYear, startMonth - 1, startDay);
        const endDate = new Date(endYear, endMonth - 1, endDay);

        const startFormatted = startDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: startDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
        });
        // Google Calendar end dates are exclusive, so subtract 1 day for display
        const displayEndDate = new Date(endDate);
        displayEndDate.setDate(displayEndDate.getDate() - 1);
        const endFormatted = displayEndDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: displayEndDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
        });
        return `${startFormatted} – ${endFormatted}`;
    }

    // Descriptions are HTML written by whoever sent the invite, so keep only the text.
    descriptionText(html) {
        const withBreaks = html.replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n');
        return new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent.trim();
    }

    buildEventRow(event, detailed) {
        const now = new Date();
        const row = document.createElement('div');
        row.className = 'event-row';
        row.style.setProperty('--event-color', event.backgroundColor);

        if (this.isEnded(event, now)) {
            row.classList.add('ended');
        } else if (!event.allDay && event.start <= now) {
            row.classList.add('ongoing');
        }

        const time = document.createElement('div');
        time.className = 'event-row-time';
        if (event.allDay) {
            time.textContent = 'All day';
        } else {
            const start = document.createElement('span');
            start.textContent = this.formatTime(event.start);
            const end = document.createElement('span');
            end.className = 'event-row-end';
            end.textContent = this.formatTime(event.end);
            time.append(start, end);
        }

        const details = document.createElement('div');
        details.className = 'event-row-details';

        const title = document.createElement('div');
        title.className = 'event-row-title';
        title.textContent = event.title || '(No title)';
        details.appendChild(title);

        const meta = [
            this.isMultiDayEvent(event) ? this.formatDateRange(event) : '',
            event.location,
            detailed && event.calendar ? event.calendar.summary : ''
        ].filter(Boolean);
        if (meta.length > 0) {
            const metaEl = document.createElement('div');
            metaEl.className = 'event-row-meta';
            metaEl.textContent = meta.join(' · ');
            details.appendChild(metaEl);
        }

        if (detailed && event.description) {
            const description = document.createElement('div');
            description.className = 'event-row-description';
            description.textContent = this.descriptionText(event.description);
            details.appendChild(description);
        }

        row.append(time, details);
        return row;
    }

    emptyMessage(text) {
        const el = document.createElement('p');
        el.className = 'empty-message';
        el.textContent = text;
        return el;
    }

    renderAgenda() {
        this.agendaList.innerHTML = '';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < CONFIG.AGENDA_DAYS; i++) {
            const day = new Date(today);
            day.setDate(day.getDate() + i);

            const events = this.getEventsForDay(day, this.agendaEvents);
            if (events.length === 0 && i > 0) {
                continue;
            }

            const heading = document.createElement('h4');
            heading.className = 'agenda-day';
            heading.textContent = i === 0 ? 'Today'
                : i === 1 ? 'Tomorrow'
                : day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            this.agendaList.appendChild(heading);

            if (events.length === 0) {
                this.agendaList.appendChild(this.emptyMessage('Nothing today'));
            }

            events.forEach(event => {
                const row = this.buildEventRow(event, false);
                row.addEventListener('click', () => this.openDaySheet(day, this.agendaEvents));
                this.agendaList.appendChild(row);
            });
        }
    }

    openDaySheet(date, events) {
        this.daySheetTitle.textContent = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        this.daySheetList.innerHTML = '';

        const dayEvents = this.getEventsForDay(date, events);
        if (dayEvents.length === 0) {
            this.daySheetList.appendChild(this.emptyMessage('No events'));
        }
        dayEvents.forEach(event => this.daySheetList.appendChild(this.buildEventRow(event, true)));

        this.daySheetList.scrollTop = 0;
        this.daySheet.classList.remove('hidden');
    }

    closeDaySheet() {
        this.daySheet.classList.add('hidden');
    }

    previous() {
        this.startDate.setDate(this.startDate.getDate() - CONFIG.WEEKS_SHOWN * 7);
    }

    next() {
        this.startDate.setDate(this.startDate.getDate() + CONFIG.WEEKS_SHOWN * 7);
    }

    goToToday() {
        this.startDate = this.weekStart(new Date());
    }
}
