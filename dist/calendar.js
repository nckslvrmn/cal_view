const MAX_EVENTS_PER_DAY = 4;

class CalendarRenderer {
    constructor() {
        this.currentDate = new Date();
        this.events = [];
        this.calendars = new Map();
        this.calendarBody = document.getElementById('calendarBody');
        this.tooltip = document.getElementById('eventTooltip');
        this.isTooltipVisible = false;
        this.tooltipAutoHideTimeout = null;
        this.ignoreNextDocumentClick = false;

        // Hide tooltip when clicking outside
        document.addEventListener('click', (e) => {
            if (this.ignoreNextDocumentClick) {
                this.ignoreNextDocumentClick = false;
                return;
            }
            if (this.isTooltipVisible && !e.target.closest('.event') && !e.target.closest('.event-tooltip')) {
                this.hideTooltip();
            }
        });
    }

    setDate(date) {
        this.currentDate = new Date(date);
    }

    getFirstDayOfMonth() {
        return new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
    }

    getLastDayOfMonth() {
        return new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);
    }

    getMonthName() {
        return this.currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    setEvents(events) {
        this.events = events;
    }

    setCalendars(calendars) {
        this.calendars.clear();
        calendars.forEach(cal => {
            this.calendars.set(cal.id, cal);
        });
    }

    render() {
        this.calendarBody.innerHTML = '';

        const firstDay = this.getFirstDayOfMonth();
        const lastDay = this.getLastDayOfMonth();

        const startDayOfWeek = firstDay.getDay();

        const prevMonthLastDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 0);
        const prevMonthDays = prevMonthLastDay.getDate();

        const totalDays = lastDay.getDate();
        const totalCells = Math.ceil((startDayOfWeek + totalDays) / 7) * 7;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Store cell dates for multi-day event calculation
        const cellDates = [];
        const cellElements = [];

        for (let i = 0; i < totalCells; i++) {
            const cell = document.createElement('div');
            cell.className = 'calendar-day';

            let dayNumber, currentCellDate;

            if (i < startDayOfWeek) {
                dayNumber = prevMonthDays - startDayOfWeek + i + 1;
                currentCellDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, dayNumber);
                cell.classList.add('other-month');
            } else if (i >= startDayOfWeek + totalDays) {
                dayNumber = i - startDayOfWeek - totalDays + 1;
                currentCellDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, dayNumber);
                cell.classList.add('other-month');
            } else {
                dayNumber = i - startDayOfWeek + 1;
                currentCellDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), dayNumber);

                const cellDate = new Date(currentCellDate);
                cellDate.setHours(0, 0, 0, 0);
                if (cellDate.getTime() === today.getTime()) {
                    cell.classList.add('today');
                }
            }

            const dayNumberEl = document.createElement('div');
            dayNumberEl.className = 'day-number';
            dayNumberEl.textContent = dayNumber;
            cell.appendChild(dayNumberEl);

            const eventsContainer = document.createElement('div');
            eventsContainer.className = 'day-events';
            cell.appendChild(eventsContainer);

            cellDates.push(currentCellDate);
            cellElements.push(cell);
            this.calendarBody.appendChild(cell);
        }

        // Render events with multi-day spanning
        this.renderAllEvents(cellDates, cellElements);
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
            this.renderDayEvents(eventsContainer, regularEvents, false);
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

        if (event.backgroundColor) {
            eventEl.style.backgroundColor = event.backgroundColor;
            eventEl.style.color = this.getContrastColor(event.backgroundColor);
        }

        const titleSpan = document.createElement('span');
        titleSpan.textContent = event.title || '(No title)';
        eventEl.appendChild(titleSpan);

        this.addTooltipEventListeners(eventEl, event);

        container.appendChild(eventEl);
    }

    getEventsForDay(date) {
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);

        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);

        return this.events.filter(event => {
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

    renderDayEvents(container, events, showMoreCount = true) {
        const visibleEvents = events.slice(0, MAX_EVENTS_PER_DAY);
        const hiddenCount = events.length - visibleEvents.length;

        visibleEvents.forEach(event => {
            const eventEl = document.createElement('div');
            eventEl.className = 'event';

            if (event.allDay) {
                eventEl.classList.add('all-day');
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

            this.addTooltipEventListeners(eventEl, event);

            container.appendChild(eventEl);
        });

        if (showMoreCount && hiddenCount > 0) {
            const moreEl = document.createElement('div');
            moreEl.className = 'more-events';
            moreEl.textContent = `+${hiddenCount} more`;
            container.appendChild(moreEl);
        }
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

    addTooltipEventListeners(eventEl, eventData) {
        let tooltipTimeout = null;

        // For touch devices (iPad)
        eventEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.isTooltipVisible && this.currentTooltipData === eventData) {
                this.hideTooltip();
            } else {
                this.showTooltip(e, eventData);
                // Prevent the document click handler from firing immediately after this
                this.ignoreNextDocumentClick = true;
            }
        });

        // For desktop (mouse)
        eventEl.addEventListener('mouseenter', (e) => {
            if (tooltipTimeout) clearTimeout(tooltipTimeout);
            this.showTooltip(e, eventData);
        });

        eventEl.addEventListener('mouseleave', () => {
            tooltipTimeout = setTimeout(() => {
                this.hideTooltip();
            }, 100);
        });
    }

    showTooltip(event, eventData) {
        let timeStr;
        if (eventData.allDay) {
            // Check if it's a multi-day event
            if (this.isMultiDayEvent(eventData)) {
                // For all-day events, parse date strings carefully to avoid timezone issues
                // Date strings from Google Calendar are in YYYY-MM-DD format and should be treated as local dates
                const [startYear, startMonth, startDay] = eventData.startStr.split('-').map(Number);
                const [endYear, endMonth, endDay] = eventData.endStr.split('-').map(Number);

                const startDate = new Date(startYear, startMonth - 1, startDay);
                const endDate = new Date(endYear, endMonth - 1, endDay);

                // Format as date range
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
                timeStr = `${startFormatted} - ${endFormatted}`;
            } else {
                timeStr = 'All day';
            }
        } else {
            const startDate = new Date(eventData.start);
            const endDate = new Date(eventData.end);
            timeStr = `${this.formatTime(startDate)} - ${this.formatTime(endDate)}`;
        }

        this.tooltip.innerHTML = `
            <div class="tooltip-title">${eventData.title || '(No title)'}</div>
            <div class="tooltip-time">${timeStr}</div>
            <div class="tooltip-calendar">${eventData.calendar ? eventData.calendar.summary : 'Unknown calendar'}</div>
            ${eventData.description ? `<div class="tooltip-description">${eventData.description}</div>` : ''}
        `;

        const rect = event.target.getBoundingClientRect();
        this.tooltip.style.left = `${rect.left + window.scrollX}px`;
        this.tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;

        this.tooltip.classList.remove('hidden');
        this.isTooltipVisible = true;
        this.currentTooltipData = eventData;

        // Auto-hide tooltip after 4 seconds
        if (this.tooltipAutoHideTimeout) {
            clearTimeout(this.tooltipAutoHideTimeout);
        }
        this.tooltipAutoHideTimeout = setTimeout(() => {
            this.hideTooltip();
        }, 4000);
    }

    hideTooltip() {
        this.tooltip.classList.add('hidden');
        this.isTooltipVisible = false;
        this.currentTooltipData = null;
        if (this.tooltipAutoHideTimeout) {
            clearTimeout(this.tooltipAutoHideTimeout);
            this.tooltipAutoHideTimeout = null;
        }
    }

    previousMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() - 1);
    }

    nextMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() + 1);
    }

    goToToday() {
        this.currentDate = new Date();
    }
}
