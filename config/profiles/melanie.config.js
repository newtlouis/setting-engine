/**
 * Profile Configuration for Melanie
 *
 * Most configuration is now in the database and manageable via the dashboard:
 * - Conversation scripts -> funnel_stages.conversation_script
 * - Follow-up templates -> followup_templates table
 * - Persona info -> account_personas table
 * - Outreach templates -> outreach_templates table
 * - Qualification prompt -> account_personas.qualification_prompt
 * - CTA resources -> cta_resources table
 * - Prospector sources -> prospector_sources table
 *
 * This file only contains the technical link to the database account.
 */
export default {
    profile_name: "melanie",
    account_id: 2,

    dm_responder: {
        goal: "Book a discovery call",
    }
}
