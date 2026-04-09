/**
 * CalendlyAdapter - Booking adapter for Calendly API v2
 *
 * Implements IBookingAdapter using the Calendly scheduling API.
 * Refactored from shared/utils/calendly.js.
 */

import axios from 'axios';
import { normalizeProfileName } from '../../credentials.js';
import { normalizePhone } from '../../utils/calendly.js';
import { createBookingAdapter } from '../../application/ports/IBookingAdapter.js';

const CALENDLY_BASE_URL = 'https://api.calendly.com';

/**
 * Gets Calendly configuration for a specific profile
 * @param {string} profileName
 * @returns {{ token: string, eventTypeUrl: string }}
 */
function getCalendlyConfig(profileName) {
  const normalized = normalizeProfileName(profileName);
  const token = process.env[`CALENDLY_TOKEN_${normalized}`] || process.env.CALENDLY_TOKEN;
  const eventTypeUrl = process.env[`CALENDLY_EVENT_TYPE_${normalized}`] || process.env.CALENDLY_EVENT_TYPE;
  return { token, eventTypeUrl };
}

/**
 * Fetch current user URI from Calendly API
 * @param {string} token
 * @returns {Promise<string>}
 */
async function getCurrentUserUri(token) {
  const response = await axios.get(`${CALENDLY_BASE_URL}/users/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.data.resource.uri;
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
 * Pick primary (2 slots from first 2 days) and backup (3 more) from a list of slots
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
 * Resolve event type URI from config or by fetching from API
 * @param {string} token
 * @param {string|undefined} eventTypeUrl
 * @returns {Promise<string|null>}
 */
async function resolveEventTypeUri(token, eventTypeUrl) {
  if (eventTypeUrl) return eventTypeUrl;

  const userUri = await getCurrentUserUri(token);
  const response = await axios.get(`${CALENDLY_BASE_URL}/event_types`, {
    params: { user: userUri, active: true },
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const r1 = response.data.collection.find(et => et.slug.includes('r1') || et.slug.includes('diagnostic'));
  const firstEvent = r1 || response.data.collection[0];
  return firstEvent?.uri || null;
}

/**
 * Create the Calendly booking adapter
 * @returns {Object} IBookingAdapter implementation
 */
export function createCalendlyAdapter() {
  return createBookingAdapter({
    async fetchAvailability(profileName) {
      const { token, eventTypeUrl } = getCalendlyConfig(profileName);
      if (!token) {
        console.warn(`[Calendly] No token found for profile ${profileName}`);
        return { thisWeek: { primary: [], backup: [] }, nextWeek: { primary: [], backup: [] } };
      }

      try {
        const eventTypeUri = await resolveEventTypeUri(token, eventTypeUrl);
        if (!eventTypeUri) {
          return { thisWeek: { primary: [], backup: [] }, nextWeek: { primary: [], backup: [] } };
        }

        const now = new Date();
        const endOfThisWeek = getEndOfWeek(now);

        const thisWeekStart = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
        const thisWeekEnd = endOfThisWeek.toISOString();
        const nextWeekStart = new Date(endOfThisWeek.getTime() + 1000).toISOString();
        const nextWeekEnd = new Date(endOfThisWeek.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

        console.log(`[Calendly] Fetching slots for event URI: ${eventTypeUri}`);

        const fetchSlots = async (start, end) => {
          const resp = await axios.get(`${CALENDLY_BASE_URL}/event_type_available_times`, {
            params: { event_type: eventTypeUri, start_time: start, end_time: end },
            headers: { 'Authorization': `Bearer ${token}` }
          });
          return (resp.data.collection || []).map(s => ({ start_time: s.start_time, status: 'available' }));
        };

        const [thisWeekSlots, nextWeekSlots] = await Promise.all([
          fetchSlots(thisWeekStart, thisWeekEnd),
          fetchSlots(nextWeekStart, nextWeekEnd)
        ]);

        return {
          thisWeek: pickPrimaryAndBackup(thisWeekSlots),
          nextWeek: pickPrimaryAndBackup(nextWeekSlots)
        };
      } catch (error) {
        console.error(`[Calendly] Error fetching availability for ${profileName}:`, error.response?.data || error.message);
        return { thisWeek: { primary: [], backup: [] }, nextWeek: { primary: [], backup: [] } };
      }
    },

    async createBooking(profileName, { startTime, email, name, phone, conversationHints }) {
      const { token, eventTypeUrl } = getCalendlyConfig(profileName);
      if (!token) throw new Error('No Calendly token found.');

      try {
        const eventTypeUri = await resolveEventTypeUri(token, eventTypeUrl);
        if (!eventTypeUri) throw new Error('No event type found to book.');

        // Check for location kind
        let locationKind = null;
        if (!eventTypeUrl) {
          const userUri = await getCurrentUserUri(token);
          const response = await axios.get(`${CALENDLY_BASE_URL}/event_types`, {
            params: { user: userUri, active: true },
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const r1 = response.data.collection.find(et => et.slug.includes('r1') || et.slug.includes('diagnostic'));
          const firstEvent = r1 || response.data.collection[0];
          if (firstEvent?.locations?.length > 0) {
            locationKind = firstEvent.locations[0].kind;
          }
        }

        console.log(`[Calendly] Attempting booking: ${name} (${email}) for ${startTime}`);

        const payload = {
          event_type: eventTypeUri,
          start_time: startTime,
          invitee: {
            email,
            name,
            text_reminder_number: normalizePhone(phone, conversationHints) || null,
            timezone: 'Europe/Paris'
          }
        };

        if (locationKind) {
          payload.location = { kind: locationKind };
        }

        const response = await axios.post(`${CALENDLY_BASE_URL}/invitees`, payload, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log(`[Calendly] Booking SUCCESS!`);

        return {
          success: true,
          message: 'Rendez-vous confirmé !',
          booking_url: response.data.resource?.uri || eventTypeUri,
          event_uri: response.data.resource?.event || null,
          prefilled_info: { name, email, phone, startTime }
        };
      } catch (error) {
        const errorData = error.response?.data;
        console.error(`[Calendly] API Booking Error:`, JSON.stringify(errorData, null, 2));
        return {
          success: false,
          error: errorData?.message || error.message,
          details: errorData?.details,
          fallback_url: `https://calendly.com/login/redirect?return_to=${encodeURIComponent(eventTypeUrl || '')}`
        };
      }
    },

    async cancelBooking(profileName, eventUri, reason = undefined) {
      const { token } = getCalendlyConfig(profileName);
      if (!token) throw new Error('No Calendly token found.');
      if (!eventUri) throw new Error('No event URI provided for cancellation.');

      try {
        const body = {};
        if (reason) body.reason = reason;

        console.log(`[Calendly] Cancelling event: ${eventUri}`);
        await axios.post(`${eventUri}/cancellation`, body, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log(`[Calendly] Event cancelled successfully`);
        return { success: true };
      } catch (error) {
        const errorData = error.response?.data;
        console.error(`[Calendly] Cancel Error:`, JSON.stringify(errorData, null, 2));
        return { success: false, error: errorData?.message || error.message };
      }
    },

    async rescheduleBooking(profileName, { oldEventUri, startTime, email, name, phone, conversationHints }) {
      const cancelResult = await this.cancelBooking(profileName, oldEventUri, 'Reprogrammé par le prospect');
      if (!cancelResult.success) {
        return { success: false, error: `Impossible d'annuler l'ancien RDV: ${cancelResult.error}` };
      }

      await new Promise(r => setTimeout(r, 4000));

      const newBooking = await this.createBooking(profileName, { startTime, email, name, phone, conversationHints });
      return { ...newBooking, rescheduled: true, cancelledEventUri: oldEventUri };
    }
  });
}
