# Meeting context

The Meeting context owns participant-bound operational sessions and implements all eight v2.0 commands with exact payload schemas.

## Scheduling and participants

`CreateMeeting` requires an existing active User as organizer and creates a scheduled Meeting with that organizer as its first participant. Additional participants must also resolve inside the same organization. Invitations and removals are allowed only before the meeting starts, and the organizer cannot be removed.

## Active-session records

`StartMeeting` transitions a scheduled meeting to `IN_PROGRESS`. Only then may participants record decisions or receive proposed action items. Decision makers and action assignees must already be participants. Stable identifiers prevent duplicate decision and action-item creation.

## Terminal outcomes

`EndMeeting` requires a chronological end instant and a non-empty summary. `CancelMeeting` is available while scheduled or in progress. End and cancellation are terminal, advance the lifecycle epoch, and reject later mutations through state and epoch fencing.

## Reliability and access

All commands enforce dedicated meeting scopes, organization ownership, optimistic version, lifecycle and authority epochs, canonical event integrity, and idempotent replay. SQLite commits the meeting snapshot, event, operation receipt, and outbox message atomically. Restart tests cover state, history, and replay.

The HTTP surface includes collection, item, and bounded history routes. The graphical command center displays schedule, participants, lifecycle progress, decisions, and action items and provides controls for all eight commands.
