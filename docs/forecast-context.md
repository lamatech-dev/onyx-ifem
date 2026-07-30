# Forecast context

C13 owns projections over existing Missions, Tasks, Timelines, Reports, or Capacity Profiles. Generation fixes the horizon, method, and baseline value. Each scenario declares a probability and bounded numeric adjustments; its projected value is derived from the baseline and adjustments, while recalculation produces the probability-weighted aggregate projection.

Publication requires at least one scenario and an explicit recalculation. Publishing and archival advance the lifecycle epoch, and archive is terminal. All five commands enforce exact payloads, valid UTC horizons, finite numeric inputs, organization ownership, authority scopes, optimistic fences, idempotency, atomic SQLite state/event/outbox persistence, and integrity-checked audit events.

Commands use `/v1/forecasting/commands/{CommandType}`. Collection, item, and event-history queries use `/v1/forecasts`.
