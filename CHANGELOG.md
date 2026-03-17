# Changelog

## [Unreleased]

### Added
- A/B variant testing for conversation scripts — two script variants per funnel stage, variant assigned per lead at outreach time via `--variant A|B|random` CLI option
- Variant B fallback to A when no B script exists for a stage
- Dashboard UI: edit Script B per funnel stage (Config Funnel), display variant on lead details
- 20 unit tests covering FunnelStage, Lead, and PromptComposer variant logic
- Accompaniment type extraction during bio qualification — personalizes variant B first message with the lead's specific service (e.g. "accompagnement en sophrologie"), activated per profile when `niche` is set
- Dashboard Pipeline view — leads grouped by funnel step or day, clickable to open lead details in new tab

### Fixed
- DM responder duplicate message detection — prevents sending identical messages twice, marks lead as not_interested
- Safety net closing patterns — handles French contractions ("si jamais t'as") and missing accents ("tu sais ou me trouver")
- Name extractor rejects common words (e.g. "Présence") mistaken for first names
- Per-profile default args for prospect command on dashboard commands page
