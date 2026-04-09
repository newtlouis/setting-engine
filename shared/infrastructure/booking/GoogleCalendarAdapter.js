/**
 * GoogleCalendarAdapter - Booking adapter for Google Calendar API
 *
 * Implements IBookingAdapter using Google Calendar API v3.
 * Uses a service account for authentication (no interactive OAuth).
 *
 * Event format for Katessence:
 * - Title: "R1 {Prénom} {Nom}"
 * - Duration: 1h (even if announced as 30 min)
 * - Description: Instagram profile link + phone + pre-call briefing
 */

import { google } from 'googleapis';
import { normalizePhone } from '../../utils/calendly.js';
import { createBookingAdapter } from '../../application/ports/IBookingAdapter.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Get Google Calendar auth client from service account key
 * @param {string} profileName
 * @returns {Promise<import('googleapis').Auth.JWT>}
 */
async function getAuthClient(profileName) {
  const keyPath = process.env[`GOOGLE_SERVICE_ACCOUNT_KEY_${profileName.toUpperCase()}`]
    || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

  if (!keyPath) {
    throw new Error(`No Google service account key found for profile ${profileName}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: SCOPES
  });

  return auth.getClient();
}

/**
 * Get calendar ID for a profile (defaults to 'primary')
 * @param {string} profileName
 * @param {Object} [bookingConfig]
 * @returns {string}
 */
function getCalendarId(profileName, bookingConfig = {}) {
  return bookingConfig?.calendarId
    || process.env[`GOOGLE_CALENDAR_ID_${profileName.toUpperCase()}`]
    || 'primary';
}

/**
 * Get time boundaries for available slots
 * @param {Object} [bookingConfig]
 * @returns {{ minHour: number, maxHour: number }}
 */
function getTimeBounds(bookingConfig = {}) {
  return {
    minHour: bookingConfig?.minHour ?? 8,
    maxHour: bookingConfig?.maxHour ?? 22
  };
}

/**
 * Get end of current week (Sunday 23:59:59)
 * @param {Date} date
 * @returns {Date}
 */
function getEndOfWeek(date) {
  const end = new Date(date);
  const day = end.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  end.setDate(end.getDate() + daysUntilSunday);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Generate 1-hour candidate slots within time bounds for a date range
 * @param {Date} start
 * @param {Date} end
 * @param {number} minHour
 * @param {number} maxHour
 * @returns {Array<{ start: Date, end: Date }>}
 */
function generateCandidateSlots(start, end, minHour, maxHour) {
  const candidates = [];
  const current = new Date(start);
  current.setMinutes(0, 0, 0);

  // Align to next full hour
  if (current < start) {
    current.setHours(current.getHours() + 1);
  }

  while (current < end) {
    const hour = current.getHours();
    if (hour >= minHour && hour < maxHour) {
      const slotEnd = new Date(current.getTime() + 60 * 60 * 1000);
      candidates.push({ start: new Date(current), end: slotEnd });
    }
    current.setHours(current.getHours() + 1);
  }

  return candidates;
}

/**
 * Filter out busy periods from candidate slots
 * @param {Array} candidates - { start, end } pairs
 * @param {Array} busyPeriods - { start, end } ISO strings from FreeBusy API
 * @returns {Array<{ start_time: string, status: string }>}
 */
function filterAvailableSlots(candidates, busyPeriods) {
  const busy = busyPeriods.map(b => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime()
  }));

  return candidates.filter(slot => {
    const slotStart = slot.start.getTime();
    const slotEnd = slot.end.getTime();
    return !busy.some(b => slotStart < b.end && slotEnd > b.start);
  }).map(slot => ({
    start_time: slot.start.toISOString(),
    status: 'available'
  }));
}

/**
 * Pick primary (2 slots from first 2 days) and backup (3 more)
 * @param {Array} slots
 * @returns {{ primary: Array, backup: Array }}
 */
function pickPrimaryAndBackup(slots) {
  if (slots.length === 0) return { primary: [], backup: [], all: [] };

  const slotsByDay = {};
  slots.forEach(slot => {
    const dateStr = slot.start_time.split('T')[0];
    if (!slotsByDay[dateStr]) slotsByDay[dateStr] = [];
    slotsByDay[dateStr].push(slot);
  });

  const sortedDays = Object.keys(slotsByDay).sort();

  const primary = [];
  for (let i = 0; i < Math.min(2, sortedDays.length); i++) {
    const day = sortedDays[i];
    const sortedTimes = slotsByDay[day].sort((a, b) => b.start_time.localeCompare(a.start_time));
    primary.push(sortedTimes[0]);
  }

  const backup = [];
  const usedIds = new Set(primary.map(s => s.start_time));
  for (const day of sortedDays) {
    const sortedTimes = slotsByDay[day].sort((a, b) => b.start_time.localeCompare(a.start_time));
    for (const slot of sortedTimes) {
      if (!usedIds.has(slot.start_time) && backup.length < 3) {
        backup.push(slot);
        usedIds.add(slot.start_time);
      }
    }
  }

  return { primary, backup, all: slots };
}

/**
 * Build event description with profile link, phone and briefing
 * @param {Object} params
 * @returns {string}
 */
function buildEventDescription({ profileUrl, phone, briefing, conversationHints }) {
  const parts = [];

  if (profileUrl) {
    parts.push(`Profil : ${profileUrl}`);
  }

  if (phone) {
    const normalized = normalizePhone(phone, conversationHints);
    if (normalized) {
      parts.push(`Téléphone : ${normalized}`);
    }
  }

  if (briefing) {
    parts.push(`\n--- Fiche récapitulatif ---\n${briefing}`);
  }

  return parts.join('\n');
}

/**
 * Create the Google Calendar booking adapter
 * @param {Object} [bookingConfig] - Profile-specific config (calendarId, minHour, maxHour)
 * @returns {Object} IBookingAdapter implementation
 */
export function createGoogleCalendarAdapter(bookingConfig = {}) {
  return createBookingAdapter({
    async fetchAvailability(profileName) {
      try {
        const authClient = await getAuthClient(profileName);
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        const calendarId = getCalendarId(profileName, bookingConfig);
        const { minHour, maxHour } = getTimeBounds(bookingConfig);

        const now = new Date();
        const endOfThisWeek = getEndOfWeek(now);
        const nextWeekEnd = new Date(endOfThisWeek.getTime() + 7 * 24 * 60 * 60 * 1000);

        console.log(`[GoogleCalendar] Fetching FreeBusy for ${profileName} (${calendarId})`);

        const freeBusyResponse = await calendar.freebusy.query({
          requestBody: {
            timeMin: now.toISOString(),
            timeMax: nextWeekEnd.toISOString(),
            timeZone: 'Europe/Paris',
            items: [{ id: calendarId }]
          }
        });

        const busyPeriods = freeBusyResponse.data.calendars?.[calendarId]?.busy || [];

        // Generate candidate slots and filter out busy periods
        const thisWeekCandidates = generateCandidateSlots(now, endOfThisWeek, minHour, maxHour);
        const nextWeekStart = new Date(endOfThisWeek.getTime() + 1000);
        const nextWeekCandidates = generateCandidateSlots(nextWeekStart, nextWeekEnd, minHour, maxHour);

        const thisWeekAvailable = filterAvailableSlots(thisWeekCandidates, busyPeriods);
        const nextWeekAvailable = filterAvailableSlots(nextWeekCandidates, busyPeriods);

        return {
          thisWeek: pickPrimaryAndBackup(thisWeekAvailable),
          nextWeek: pickPrimaryAndBackup(nextWeekAvailable)
        };
      } catch (error) {
        console.error(`[GoogleCalendar] Error fetching availability for ${profileName}:`, error.message);
        return { thisWeek: { primary: [], backup: [] }, nextWeek: { primary: [], backup: [] } };
      }
    },

    async createBooking(profileName, { startTime, email, name, phone, conversationHints, briefing, profileUrl }) {
      const authClient = await getAuthClient(profileName);
      const calendar = google.calendar({ version: 'v3', auth: authClient });
      const calendarId = getCalendarId(profileName, bookingConfig);

      const startDate = new Date(startTime);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour

      const description = buildEventDescription({ profileUrl, phone, briefing, conversationHints });

      const event = {
        summary: `R1 ${name}`,
        description,
        start: {
          dateTime: startDate.toISOString(),
          timeZone: 'Europe/Paris'
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: 'Europe/Paris'
        },
        attendees: email ? [{ email }] : [],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 30 }
          ]
        }
      };

      try {
        console.log(`[GoogleCalendar] Creating event: R1 ${name} at ${startTime}`);

        const response = await calendar.events.insert({
          calendarId,
          requestBody: event,
          sendUpdates: 'all'
        });

        console.log(`[GoogleCalendar] Event created: ${response.data.htmlLink}`);

        return {
          success: true,
          message: 'Rendez-vous confirmé !',
          booking_url: response.data.htmlLink,
          event_uri: response.data.id
        };
      } catch (error) {
        console.error(`[GoogleCalendar] Error creating event:`, error.message);
        return {
          success: false,
          error: error.message
        };
      }
    },

    async cancelBooking(profileName, eventUri, reason = undefined) {
      try {
        const authClient = await getAuthClient(profileName);
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        const calendarId = getCalendarId(profileName, bookingConfig);

        console.log(`[GoogleCalendar] Cancelling event: ${eventUri}`);

        await calendar.events.delete({
          calendarId,
          eventId: eventUri,
          sendUpdates: 'all'
        });

        console.log(`[GoogleCalendar] Event cancelled successfully`);
        return { success: true };
      } catch (error) {
        console.error(`[GoogleCalendar] Cancel Error:`, error.message);
        return { success: false, error: error.message };
      }
    },

    async rescheduleBooking(profileName, { oldEventUri, startTime, email, name, phone, conversationHints }) {
      const cancelResult = await this.cancelBooking(profileName, oldEventUri, 'Reprogrammé par le prospect');
      if (!cancelResult.success) {
        return { success: false, error: `Impossible d'annuler l'ancien RDV: ${cancelResult.error}` };
      }

      const newBooking = await this.createBooking(profileName, { startTime, email, name, phone, conversationHints });
      return { ...newBooking, rescheduled: true, cancelledEventUri: oldEventUri };
    }
  });
}
