# Changelog

## [Unreleased]

### Added
- A/B variant testing for conversation scripts — two script variants per funnel stage, variant assigned per lead at outreach time via `--variant A|B|random` CLI option
- Variant B fallback to A when no B script exists for a stage
- Dashboard UI: edit Script B per funnel stage (Config Funnel), display variant on lead details
- 20 unit tests covering FunnelStage, Lead, and PromptComposer variant logic
- Accompaniment type extraction during bio qualification — personalizes variant B first message with the lead's specific service (e.g. "accompagnement en sophrologie"), activated per profile when `niche` is set
