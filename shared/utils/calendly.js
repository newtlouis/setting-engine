/**
 * Calendly API v2 Utility
 * 
 * Used to fetch availability and create bookings/invitees.
 */

import axios from 'axios';
import { normalizeProfileName } from '../credentials.js';

const CALENDLY_BASE_URL = 'https://api.calendly.com';

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
            // Pick the first active event type as default
            const firstEvent = response.data.collection[0];
            if (firstEvent) eventTypeUri = firstEvent.uri;
        }

        if (!eventTypeUri) return [];

        // Step 2: Fetch available slots
        const now = new Date();
        const startTime = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
        const endTime = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString();

        console.log(`[Calendly] Fetching slots for event URI: ${eventTypeUri}`);

        const slotsResponse = await axios.get(`${CALENDLY_BASE_URL}/event_type_available_times`, {
            params: {
                event_type: eventTypeUri, // Error said 'event_type' is missing, so let's use that key with full URI
                start_time: startTime,
                end_time: endTime
            },
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // The response contains 'collection' of available times
        const allSlots = (slotsResponse.data.collection || []).map(slot => ({
            start_time: slot.start_time,
            status: "available"
        }));

        if (allSlots.length === 0) return { primary: [], backup: [] };

        // --- Logic: Group by Day and Sort by latest time ---
        const slotsByDay = {}; // { '2026-02-04': [slot1, slot2], ... }
        
        allSlots.forEach(slot => {
            const dateStr = slot.start_time.split('T')[0];
            if (!slotsByDay[dateStr]) slotsByDay[dateStr] = [];
            slotsByDay[dateStr].push(slot);
        });

        const sortedDays = Object.keys(slotsByDay).sort(); // Sorted by date asc
        
        // Pick primary: One latest slot from each of the first 2 days
        const primary = [];
        for (let i = 0; i < Math.min(2, sortedDays.length); i++) {
            const day = sortedDays[i];
            const sortedTimes = slotsByDay[day].sort((a, b) => b.start_time.localeCompare(a.start_time)); // Latest first
            primary.push(sortedTimes[0]);
        }

        // Pick backup: Up to 3 more slots from remaining availability
        const backup = [];
        const usedIds = new Set(primary.map(s => s.start_time));
        
        // Loop through days again to fill backup
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
export async function createBooking(profileName, { startTime, email, name, phone }) {
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
                text_reminder_number: phone || null,
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
