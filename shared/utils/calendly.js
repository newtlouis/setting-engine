/**
 * Calendly API v2 Utility
 * 
 * Used to fetch availability and create bookings/invitees.
 */

import axios from 'axios';
import { normalizeProfileName } from '../credentials.js';

const CALENDLY_BASE_URL = 'https://api.calendly.com';

/**
 * Normalize phone to international format (E.164).
 * Supports French (+33), Belgian (+32) and Canadian (+1) numbers.
 */
export function normalizePhone(phone, conversationHints = '') {
    if (!phone) return null;
    let cleaned = phone.replace(/[\s.\-()]/g, '');
    const hints = conversationHints.toLowerCase();
    const isCanadian = hints.includes('canada') || hints.includes('canadien') || hints.includes('canadienne')
        || hints.includes('québec') || hints.includes('quebec') || hints.includes('montréal')
        || hints.includes('montreal') || hints.includes('toronto') || hints.includes('ottawa');

    let detectedCountry = 'unknown';

    if (cleaned.startsWith('0') && cleaned.length === 10) {
        // European local format (0X XX XX XX XX)
        const isBelgian = hints.includes('belge') || hints.includes('belgique') || hints.includes('belgium')
            || /^04[5-9]/.test(cleaned); // Belgian mobile: 045x-049x
        detectedCountry = isBelgian ? 'Belgium (+32)' : 'France (+33)';
        cleaned = (isBelgian ? '+32' : '+33') + cleaned.slice(1);
    } else if (isCanadian && cleaned.length === 10 && !cleaned.startsWith('0')) {
        // Canadian local format (514 555 1234 → +15145551234)
        detectedCountry = 'Canada (+1)';
        cleaned = '+1' + cleaned;
    } else if (isCanadian && cleaned.length === 11 && cleaned.startsWith('1')) {
        // Canadian with country code but no + (1 514 555 1234)
        detectedCountry = 'Canada (+1)';
        cleaned = '+' + cleaned;
    } else if (cleaned.startsWith('+')) {
        detectedCountry = 'already international';
    }

    if (!cleaned.startsWith('+')) {
        cleaned = '+' + cleaned;
    }

    console.log(`[Calendly] Phone: "${phone}" → ${cleaned} (${detectedCountry})`);
    return cleaned;
}

/**
 * Gets Calendly configuration for a specific profile.
 */
function getCalendlyConfig(profileName) {
    const normalized = normalizeProfileName(profileName);
    const token = process.env[`CALENDLY_TOKEN_${normalized}`] || process.env.CALENDLY_TOKEN;
    const eventTypeUrl = process.env[`CALENDLY_EVENT_TYPE_${normalized}`] || process.env.CALENDLY_EVENT_TYPE;
    
    return { token, eventTypeUrl };
}

/**
 * Fetch current user URI (required for some Calendly API calls)
 */
async function getCurrentUserUri(token) {
    const response = await axios.get(`${CALENDLY_BASE_URL}/users/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.data.resource.uri;
}

/**
 * Get end of current week (Sunday 23:59:59)
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
 */
function pickPrimaryAndBackup(slots) {
    if (slots.length === 0) return { primary: [], backup: [] };

    // Group by day
    const slotsByDay = {};
    slots.forEach(slot => {
        const dateStr = slot.start_time.split('T')[0];
        if (!slotsByDay[dateStr]) slotsByDay[dateStr] = [];
        slotsByDay[dateStr].push(slot);
    });

    const sortedDays = Object.keys(slotsByDay).sort();

    // Primary: latest slot from each of the first 2 days
    const primary = [];
    for (let i = 0; i < Math.min(2, sortedDays.length); i++) {
        const day = sortedDays[i];
        const sortedTimes = slotsByDay[day].sort((a, b) => b.start_time.localeCompare(a.start_time));
        primary.push(sortedTimes[0]);
    }

    // Backup: up to 3 more slots
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

    return { primary, backup };
}

/**
 * Fetch upcoming available slots for a profile
 * 
 * @param {string} profileName 
 * @returns {Promise<Array>} List of slots {start_time, status}
 */
export async function fetchAvailability(profileName) {
    const { token, eventTypeUrl } = getCalendlyConfig(profileName);
    if (!token) {
        console.warn(`[Calendly] No token found for profile ${profileName}`);
        return [];
    }

    try {
        // Step 1: Get Event Type details to get its URI if it's an URL
        // In this implementation, we assume eventTypeUrl is already the UUID or URI for simplicity, 
        // or we fetch all event types for the user.
        
        let eventTypeUri = eventTypeUrl;
        if (!eventTypeUri) {
            const userUri = await getCurrentUserUri(token);
            const response = await axios.get(`${CALENDLY_BASE_URL}/event_types`, {
                params: { user: userUri, active: true },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            // Prioritize R1 (Diagnostic) call, same logic as createBooking
            const r1 = response.data.collection.find(et => et.slug.includes('r1') || et.slug.includes('diagnostic'));
            const firstEvent = r1 || response.data.collection[0];
            if (firstEvent) eventTypeUri = firstEvent.uri;
        }

        if (!eventTypeUri) return { thisWeek: { primary: [], backup: [] }, nextWeek: { primary: [], backup: [] } };

        // Step 2: Fetch available slots (2 separate calls, API limits to 7 days each)
        const now = new Date();
        const endOfThisWeek = getEndOfWeek(now);

        // Call 1: This week
        const thisWeekStart = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
        const thisWeekEnd = endOfThisWeek.toISOString();

        // Call 2: Next week
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
        return [];
    }
}

/**
 * Create an attendee/invitee for a scheduled event
 * Note: New Calendly API v2 'Scheduling API' uses POST /invitees
 * for direct programmatic booking. Requires Standard+ plans.
 */
export async function createBooking(profileName, { startTime, email, name, phone, conversationHints }) {
    const { token, eventTypeUrl } = getCalendlyConfig(profileName);
    if (!token) throw new Error("No Calendly token found.");

    try {
        let eventTypeUri = eventTypeUrl;
        if (!eventTypeUri) {
            const userUri = await getCurrentUserUri(token);
            const response = await axios.get(`${CALENDLY_BASE_URL}/event_types`, {
                params: { user: userUri, active: true },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            // Prioritize R1 (Diagnostic) call if found
            const r1 = response.data.collection.find(et => et.slug.includes('r1') || et.slug.includes('diagnostic'));
            const firstEvent = r1 || response.data.collection[0];
            if (firstEvent) {
                eventTypeUri = firstEvent.uri;
                // Store location kind if available
                if (firstEvent.locations && firstEvent.locations.length > 0) {
                    var locationKind = firstEvent.locations[0].kind;
                }
            }
        }

        if (!eventTypeUri) throw new Error("No event type found to book.");

        console.log(`[Calendly] Attempting REAL booking: ${name} (${email}) for ${startTime}`);

        // Calendly API v2: Direct programmatic booking
        const payload = {
            event_type: eventTypeUri,
            start_time: startTime,
            invitee: {
                email: email,
                name: name,
                text_reminder_number: normalizePhone(phone, conversationHints) || null,
                timezone: "Europe/Paris"
            }
        };

        // If location is required, add it
        if (locationKind) {
            payload.location = { kind: locationKind };
        }

        const response = await axios.post(`${CALENDLY_BASE_URL}/invitees`, payload, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log(`[Calendly] REAL booking SUCCESS!`);

        return {
            success: true,
            message: "Rendez-vous confirmé !",
            booking_url: response.data.resource?.uri || eventTypeUri,
            event_uri: response.data.resource?.event || null,
            prefilled_info: { name, email, phone, startTime }
        };

    } catch (error) {
        const errorData = error.response?.data;
        console.error(`[Calendly] API Booking Error:`, JSON.stringify(errorData, null, 2));
        
        // If it's a 403/Forbidden, it's likely a plan restriction.
        // Return success: true but include a flag that it's a "simulated" success via fallback
        // to avoid user-facing errors if we can just give them the link.
        // Actually, the user wants to KNOW if it worked.
        
        return {
            success: false,
            error: errorData?.message || error.message,
            details: errorData?.details,
            fallback_url: `https://calendly.com/login/redirect?return_to=${encodeURIComponent(eventTypeUrl || '')}`
        };
    }
}

/**
 * Cancel a scheduled event via Calendly API v2.
 *
 * @param {string} profileName - Profile name for token lookup
 * @param {string} eventUri - Full URI of the scheduled event (from createBooking().event_uri)
 * @param {string} [reason] - Optional cancellation reason
 * @returns {Promise<Object>} { success: true } or { success: false, error: "..." }
 */
export async function cancelBooking(profileName, eventUri, reason = undefined) {
    const { token } = getCalendlyConfig(profileName);
    if (!token) throw new Error("No Calendly token found.");
    if (!eventUri) throw new Error("No event URI provided for cancellation.");

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

        return {
            success: false,
            error: errorData?.message || error.message,
            details: errorData?.details
        };
    }
}

/**
 * Reschedule a booking: cancel the old event and create a new one.
 *
 * @param {string} profileName
 * @param {Object} params
 * @param {string} params.oldEventUri - URI of the event to cancel
 * @param {string} params.startTime - New slot ISO timestamp
 * @param {string} params.email
 * @param {string} params.name
 * @param {string} [params.phone]
 * @param {string} [params.conversationHints]
 * @returns {Promise<Object>} New booking result with rescheduled flag
 */
export async function rescheduleBooking(profileName, { oldEventUri, startTime, email, name, phone, conversationHints }) {
    // 1. Cancel old event
    const cancelResult = await cancelBooking(profileName, oldEventUri, 'Reprogrammé par le prospect');
    if (!cancelResult.success) {
        return {
            success: false,
            error: `Impossible d'annuler l'ancien RDV: ${cancelResult.error}`,
            cancelResult
        };
    }

    // 2. Brief pause to avoid Calendly rate limiting after cancel
    await new Promise(r => setTimeout(r, 4000));

    // 3. Create new booking
    const newBooking = await createBooking(profileName, { startTime, email, name, phone, conversationHints });

    return {
        ...newBooking,
        rescheduled: true,
        cancelledEventUri: oldEventUri
    };
}
