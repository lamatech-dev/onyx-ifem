"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type View = "overview" | "missions" | "tasks" | "timelines" | "reports";
type CreateKind = "mission" | "task" | "timeline" | "report";

type Mission = {
  mission_id: string;
  organization_id: string;
  objective: string;
  owner_id: string;
  status: string;
  version: number;
  lifecycle_epoch: number;
  authority_epoch: number;
  title?: string;
  active_blueprint_revision_id?: string;
  timeline_id?: string;
};

type DomainEvent = {
  event_id: string;
  event_type: string;
  aggregate_version: number;
  lifecycle_epoch?: number;
  occurred_at: string;
  payload: Record<string, unknown>;
  audit?: { provenance?: string; integrity_digest?: string };
};

type Task = {
  task_id: string;
  organization_id: string;
  mission_id: string;
  title: string;
  description: string;
  priority: string;
  owner_id: string;
  status: string;
  version: number;
  lifecycle_epoch: number;
  authority_epoch: number;
  dependency_task_ids: string[];
};

type Timeline = {
  timeline_id: string;
  organization_id: string;
  subject_ref: { aggregate_type: string; object_id: string };
  timezone: string;
  version: number;
  status: string;
  lifecycle_epoch: number;
  authority_epoch: number;
  deadlines: Record<string, {deadline_at: string; label: string}>;
  milestones: Record<string, {title: string; due_at: string}>;
  critical_markers: Record<string, {label: string; trigger_at: string}>;
  penalty_zones: Record<string, {starts_at: string; reason: string}>;
  resolved_exception_ids: string[];
};

type Report = {
  report_id: string;
  organization_id: string;
  report_type: string;
  subject_ref: { aggregate_type: string; object_id: string };
  title: string;
  author_id: string;
  version: number;
  status: string;
  lifecycle_epoch: number;
  authority_epoch: number;
  evidence: Record<string, {evidence_id: string; evidence_type: string; uri: string; content_hash: string; description?: string; status: string}>;
};

type Organization = {
  organization_id: string;
  name: string;
  slug: string;
  status: string;
  version: number;
  lifecycle_epoch: number;
  authority_epoch: number;
  workspaces: Record<string, { workspace_id: string; name: string }>;
  departments: Record<string, { department_id: string; name: string; parent_department_id?: string; status: string }>;
  teams: Record<string, { team_id: string; department_id: string; name: string }>;
  groups: Record<string, { group_id: string; name: string }>;
};

type UserIdentity = {
  user_id: string; organization_id: string; email: string; display_name: string; status: string;
  version: number; lifecycle_epoch: number; authority_epoch: number;
  roles: Record<string, {role_id: string; assigned_at: string}>;
  devices: Record<string, {device_id: string; name: string; public_key_thumbprint: string; status: string}>;
  delegations: Record<string, {delegation_id: string; delegatee_id: string; scopes: string[]; expires_at: string; status: string}>;
};

type ContextLink = {
  context_link_id: string; organization_id: string; source_ref: {aggregate_type:string;object_id:string}; target_ref: {aggregate_type:string;object_id:string};
  relation_type: string; strength: "WEAK"|"NORMAL"|"STRONG"|"CRITICAL"; metadata: Record<string,string>; status: string; version: number; lifecycle_epoch: number; authority_epoch: number;
};

type RecordSelection =
  | { kind: "task"; record: Task }
  | { kind: "timeline"; record: Timeline }
  | { kind: "report"; record: Report };

type Ready = {
  status: string;
  persistence?: { mode?: string; durable?: boolean };
  messaging?: { outbox?: { pending?: number; delivered?: number; deadLettered?: number } };
};

type ResourcePage<T> = { items: T[]; next_cursor?: string };
type CollectionCursors = Record<CreateKind, string | undefined>;

const NAV: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Command center", icon: "⌂" },
  { id: "missions", label: "Missions", icon: "◇" },
  { id: "tasks", label: "Work queue", icon: "✓" },
  { id: "timelines", label: "Timelines", icon: "◷" },
  { id: "reports", label: "Evidence", icon: "▤" },
];

const DEFAULT_ORG = "018f1c2a-7b3d-7abc-8def-00000000000d";
const DEFAULT_USER = "018f1c2a-7b3d-7abc-8def-00000000000f";

function uuidV7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function utcNow() {
  return new Date().toISOString().replace(/Z$/, "000Z");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/onyx?path=${encodeURIComponent(path)}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!response.ok) throw new Error(body.message || body.code || `Request failed (${response.status})`);
  return body;
}

function envelope(
  type: string,
  aggregateType: string,
  objectId: string,
  organizationId: string,
  principalId: string,
  scope: string,
  payload: Record<string, unknown>,
) {
  const base: Record<string, unknown> = {
    actor_context: { actor_type: "USER", principal_id: principalId },
    authority_proof: {
      authority_epoch: 0,
      expires_at: new Date(Date.now() + 86_400_000).toISOString().replace(/Z$/, "000Z"),
      proof_ref: `proof:web-console:${type}`,
      scope: [scope],
    },
    command_id: uuidV7(),
    command_type: type,
    correlation_id: uuidV7(),
    issued_at: utcNow(),
    operation_id: uuidV7(),
    organization_id: organizationId,
    payload,
    schema_version: 1,
    target: { aggregate_type: aggregateType, object_id: objectId },
    vector_clock: { "web-console": 1 },
  };
  if (type !== "CreateMission") base.expected_version = 0;
  return base;
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (["active", "ready", "approved", "closed"].includes(normalized)) return "status positive";
  if (["paused", "blocked", "review", "awaiting_approval"].includes(normalized)) return "status warning";
  if (["cancelled", "failed", "halted"].includes(normalized)) return "status negative";
  return "status neutral";
}

function shortId(id?: string) {
  return id ? `${id.slice(0, 8)}…${id.slice(-4)}` : "—";
}

function parseSubjectRef(value: FormDataEntryValue | null) {
  const [aggregateType, objectId] = String(value || "").split(":", 2);
  if (!aggregateType || !objectId) throw new Error("Select a valid operational subject");
  return { aggregate_type: aggregateType, object_id: objectId };
}

function mergeUnique<T>(current: T[], incoming: T[], identify: (item: T) => string) {
  const known = new Set(current.map(identify));
  const merged = [...current];
  for (const item of incoming) {
    const id = identify(item);
    if (known.has(id)) continue;
    known.add(id);
    merged.push(item);
  }
  return merged;
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [users, setUsers] = useState<UserIdentity[]>([]);
  const [contextLinks, setContextLinks] = useState<ContextLink[]>([]);
  const [ready, setReady] = useState<Ready | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");
  const [organizationId, setOrganizationId] = useState(DEFAULT_ORG);
  const [principalId, setPrincipalId] = useState(DEFAULT_USER);
  const [identityReady, setIdentityReady] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<RecordSelection | null>(null);
  const [missionHistory, setMissionHistory] = useState<DomainEvent[]>([]);
  const [recordHistory, setRecordHistory] = useState<DomainEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [nextCursors, setNextCursors] = useState<CollectionCursors>({ mission: undefined, task: undefined, timeline: undefined, report: undefined });
  const [loadingMore, setLoadingMore] = useState<CreateKind | null>(null);

  const writeRoute = useCallback((nextView?: View, record?: string | null, replace = false) => {
    const url = new URL(window.location.href);
    if (nextView) {
      if (nextView === "overview") url.searchParams.delete("view");
      else url.searchParams.set("view", nextView);
    }
    if (record === null) url.searchParams.delete("record");
    else if (record) url.searchParams.set("record", record);
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  }, []);

  const navigateView = useCallback((nextView: View) => {
    setView(nextView);
    setSelectedMission(null);
    setSelectedRecord(null);
    writeRoute(nextView, null);
  }, [writeRoute]);

  const closeDetails = useCallback(() => {
    setSelectedMission(null);
    setSelectedRecord(null);
    writeRoute(undefined, null);
  }, [writeRoute]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = `organization_id=${encodeURIComponent(organizationId)}&limit=100`;
      const [healthData, missionData, taskData, timelineData, reportData, organizationData, userData, contextLinkData] = await Promise.all([
        api<Ready>("/readyz"),
        api<ResourcePage<Mission>>(`/v1/missions?${query}`),
        api<ResourcePage<Task>>(`/v1/tasks?${query}`),
        api<ResourcePage<Timeline>>(`/v1/timelines?${query}`),
        api<ResourcePage<Report>>(`/v1/reports?${query}`),
        api<ResourcePage<Organization>>(`/v1/organizations?organization_id=${encodeURIComponent(organizationId)}&limit=1`),
        api<ResourcePage<UserIdentity>>(`/v1/users?${query}`),
        api<ResourcePage<ContextLink>>(`/v1/context-links?${query}`),
      ]);
      setReady(healthData);
      setMissions(missionData.items);
      setTasks(taskData.items);
      setTimelines(timelineData.items);
      setReports(reportData.items);
      setOrganization(organizationData.items[0] ?? null);
      setUsers(userData.items);
      setContextLinks(contextLinkData.items);
      setNextCursors({ mission: missionData.next_cursor, task: taskData.next_cursor, timeline: timelineData.next_cursor, report: reportData.next_cursor });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reach ONYX API");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  const loadMore = useCallback(async (kind: CreateKind) => {
    const cursor = nextCursors[kind];
    if (!cursor || loadingMore) return;
    setLoadingMore(kind);
    try {
      const query = `organization_id=${encodeURIComponent(organizationId)}&limit=100&cursor=${encodeURIComponent(cursor)}`;
      let nextCursor: string | undefined;
      if (kind === "mission") {
        const page = await api<ResourcePage<Mission>>(`/v1/missions?${query}`);
        setMissions((current) => mergeUnique(current, page.items, (item) => item.mission_id));
        nextCursor = page.next_cursor;
      } else if (kind === "task") {
        const page = await api<ResourcePage<Task>>(`/v1/tasks?${query}`);
        setTasks((current) => mergeUnique(current, page.items, (item) => item.task_id));
        nextCursor = page.next_cursor;
      } else if (kind === "timeline") {
        const page = await api<ResourcePage<Timeline>>(`/v1/timelines?${query}`);
        setTimelines((current) => mergeUnique(current, page.items, (item) => item.timeline_id));
        nextCursor = page.next_cursor;
      } else {
        const page = await api<ResourcePage<Report>>(`/v1/reports?${query}`);
        setReports((current) => mergeUnique(current, page.items, (item) => item.report_id));
        nextCursor = page.next_cursor;
      }
      setNextCursors((current) => ({ ...current, [kind]: nextCursor }));
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : `Unable to load more ${kind} records`);
    } finally {
      setLoadingMore(null);
    }
  }, [loadingMore, nextCursors, organizationId]);

  useEffect(() => {
    const storedOrg = localStorage.getItem("onyx.organization");
    const storedPrincipal = localStorage.getItem("onyx.principal");
    if (storedOrg) setOrganizationId(storedOrg);
    if (storedPrincipal) setPrincipalId(storedPrincipal);
    setIdentityReady(true);
  }, []);

  useEffect(() => {
    if (!identityReady) return;
    void refresh();
  }, [identityReady, refresh]);

  useEffect(() => {
    if (!createKind) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setCreateKind(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [createKind]);

  useEffect(() => {
    if (!selectedMission && !selectedRecord) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeDetails();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeDetails, selectedMission, selectedRecord]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openMission = useCallback(async (mission: Mission, updateRoute = true) => {
    setSelectedRecord(null);
    setSelectedMission(mission);
    if (updateRoute) writeRoute(undefined, `mission:${mission.mission_id}`);
    setMissionHistory([]);
    setDetailLoading(true);
    try {
      const history = await api<{ items: DomainEvent[] }>(`/v1/missions/${mission.mission_id}/history?organization_id=${organizationId}&after_version=0&limit=100`);
      setMissionHistory(history.items);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Unable to load mission history");
    } finally {
      setDetailLoading(false);
    }
  }, [organizationId, writeRoute]);

  const openRecord = useCallback(async (selection: RecordSelection, updateRoute = true) => {
    setSelectedMission(null);
    setSelectedRecord(selection);
    setRecordHistory([]);
    setDetailLoading(true);
    try {
      const id = selection.kind === "task" ? selection.record.task_id : selection.kind === "timeline" ? selection.record.timeline_id : selection.record.report_id;
      if (updateRoute) writeRoute(undefined, `${selection.kind}:${id}`);
      const historyPath = selection.kind === "task" ? `/v1/tasks/${id}/history` : selection.kind === "timeline" ? `/v1/timelines/${id}/history` : `/v1/reports/${id}/history`;
      const history = await api<{ items: DomainEvent[] }>(`${historyPath}?organization_id=${organizationId}&after_version=0&limit=100`);
      setRecordHistory(history.items);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Unable to load record history");
    } finally {
      setDetailLoading(false);
    }
  }, [organizationId, writeRoute]);

  useEffect(() => {
    if (!identityReady) return;
    let active = true;
    const restoreRoute = async () => {
      const parameters = new URLSearchParams(window.location.search);
      const requestedView = parameters.get("view");
      const routeView = NAV.some((item) => item.id === requestedView) ? requestedView as View : "overview";
      setView(routeView);
      const reference = parameters.get("record");
      if (!reference) {
        setSelectedMission(null);
        setSelectedRecord(null);
        return;
      }
      const [kind, id] = reference.split(":", 2);
      if (!id || !["mission", "task", "timeline", "report"].includes(kind)) {
        writeRoute(undefined, null, true);
        return;
      }
      try {
        if (kind === "mission") {
          const mission = await api<Mission>(`/v1/missions/${id}?organization_id=${organizationId}`);
          if (active) await openMission(mission, false);
        } else if (kind === "task") {
          const task = await api<Task>(`/v1/tasks/${id}?organization_id=${organizationId}`);
          if (active) await openRecord({ kind: "task", record: task }, false);
        } else if (kind === "timeline") {
          const timeline = await api<Timeline>(`/v1/timelines/${id}?organization_id=${organizationId}`);
          if (active) await openRecord({ kind: "timeline", record: timeline }, false);
        } else {
          const report = await api<Report>(`/v1/reports/${id}?organization_id=${organizationId}`);
          if (active) await openRecord({ kind: "report", record: report }, false);
        }
      } catch (caught) {
        if (!active) return;
        setSelectedMission(null);
        setSelectedRecord(null);
        writeRoute(undefined, null, true);
        setToast(caught instanceof Error ? caught.message : "Unable to open linked record");
      }
    };
    const handleHistory = () => void restoreRoute();
    void restoreRoute();
    window.addEventListener("popstate", handleHistory);
    return () => {
      active = false;
      window.removeEventListener("popstate", handleHistory);
    };
  }, [identityReady, openMission, openRecord, organizationId, writeRoute]);

  async function runMissionAction(type: "plan" | "submit" | "activate" | "pause" | "resume" | "halt" | "restart" | "close" | "cancel" | "archive") {
    if (!selectedMission) return;
    if (["cancel", "close", "archive"].includes(type) && !window.confirm(`${type === "cancel" ? "Cancel" : type === "close" ? "Close" : "Archive"} this mission? This lifecycle transition cannot be undone.`)) return;
    setActionLoading(type);
    try {
      const latestRevision = [...missionHistory].reverse().find((event) => event.event_type === "MissionBlueprintRevisionCreated")?.payload.revision_id as string | undefined;
      const submittedRevision = [...missionHistory].reverse().find((event) => event.event_type === "MissionBlueprintSubmitted")?.payload.revision_id as string | undefined;
      let commandType = "";
      let scope = "";
      let payload: Record<string, unknown> = { mission_id: selectedMission.mission_id };
      if (type === "plan") {
        commandType = "CreateBlueprintRevision";
        scope = "mission:blueprint:create";
        payload = { ...payload, revision_id: uuidV7(), content: { title: selectedMission.title, objective: selectedMission.objective }, change_summary: "Initial plan created in ONYX Command Center" };
      }
      if (type === "submit") {
        if (!latestRevision) throw new Error("Create a mission plan before submitting it");
        commandType = "SubmitBlueprint";
        scope = "mission:blueprint:submit";
        payload = { ...payload, revision_id: latestRevision };
      }
      if (type === "activate") {
        if (!submittedRevision) throw new Error("A submitted mission plan is required");
        let timelineId = timelines.find((timeline) => timeline.subject_ref.aggregate_type === "Mission" && timeline.subject_ref.object_id === selectedMission.mission_id)?.timeline_id;
        if (!timelineId) {
          timelineId = uuidV7();
          const timelineCommand = envelope("CreateTimeline", "Timeline", timelineId, organizationId, principalId, "timeline:create", {
            timeline_id: timelineId,
            subject_ref: { aggregate_type: "Mission", object_id: selectedMission.mission_id },
            timezone: "Asia/Tehran",
          });
          await api("/v1/timeline/commands/CreateTimeline", { method: "POST", body: JSON.stringify(timelineCommand) });
        }
        commandType = "ActivateMission";
        scope = "mission:activate";
        payload = { ...payload, approved_revision_id: submittedRevision, timeline_id: timelineId };
      }
      if (type === "pause") { commandType = "PauseMission"; scope = "mission:pause"; payload = { ...payload, reason_code: "OPERATOR_PAUSE", reason: "Paused from ONYX Command Center" }; }
      if (type === "resume") { commandType = "ResumeMission"; scope = "mission:resume"; payload = { ...payload, resume_note: "Resumed from ONYX Command Center" }; }
      if (type === "halt") { commandType = "OperationalHaltMission"; scope = "mission:halt"; payload = { ...payload, reason_code: "OPERATIONAL_INCIDENT", reason: "Operational halt from ONYX Command Center" }; }
      if (type === "restart") { commandType = "RestartMission"; scope = "mission:restart"; payload = { ...payload, restart_note: "Restarted from ONYX Command Center" }; }
      if (type === "close") { commandType = "CloseMission"; scope = "mission:close"; payload = { ...payload, outcome_code: "OBJECTIVE_COMPLETED", outcome_summary: "Mission objective completed and closed from ONYX Command Center" }; }
      if (type === "cancel") { commandType = "CancelMission"; scope = "mission:cancel"; payload = { ...payload, reason_code: "OPERATOR_CANCEL", reason: "Cancelled from ONYX Command Center" }; }
      if (type === "archive") { commandType = "ArchiveMission"; scope = "mission:archive"; payload = { ...payload, retention_policy_id: uuidV7() }; }
      const command = envelope(commandType, "Mission", selectedMission.mission_id, organizationId, principalId, scope, payload);
      command.expected_version = selectedMission.version;
      command.expected_lifecycle_epoch = selectedMission.lifecycle_epoch;
      command.expected_authority_epoch = selectedMission.authority_epoch;
      await api(`/v1/mission/commands/${commandType}`, { method: "POST", body: JSON.stringify(command) });
      await refresh();
      const updated = await api<Mission>(`/v1/missions/${selectedMission.mission_id}?organization_id=${organizationId}`);
      await openMission(updated, false);
      setToast(`${commandType.replace(/([A-Z])/g, " $1").trim()} completed`);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Mission action failed");
    } finally {
      setActionLoading("");
    }
  }

  async function runTaskAction(type: "start" | "pause" | "block" | "submit" | "approve" | "close" | "reopen" | "cancel") {
    if (!selectedRecord || selectedRecord.kind !== "task") return;
    if (["close", "cancel"].includes(type) && !window.confirm(`${type === "close" ? "Close" : "Cancel"} this task?`)) return;
    const task = selectedRecord.record;
    setActionLoading(type);
    try {
      const config = {
        start: ["StartTask", "work:start", {task_id: task.task_id, start_note: "Started from ONYX Command Center"}],
        pause: ["PauseTask", "work:pause", {task_id: task.task_id, reason_code: "OPERATOR_PAUSE", reason: "Paused from ONYX Command Center"}],
        block: ["BlockTask", "work:block", {task_id: task.task_id, blocker_code: "OPERATIONAL_BLOCKER", blocker_description: "Blocked from ONYX Command Center"}],
        submit: ["SubmitCompletion", "work:completion:submit", {task_id: task.task_id, completion_summary: "Completion submitted from ONYX Command Center"}],
        approve: ["ApproveTask", "work:approve", {task_id: task.task_id, approval_note: "Completion approved from ONYX Command Center"}],
        close: ["CloseTask", "work:close", {task_id: task.task_id, closure_note: "Task closed from ONYX Command Center"}],
        reopen: ["ReopenTask", "work:reopen", {task_id: task.task_id, reason: "Task reopened from ONYX Command Center"}],
        cancel: ["CancelTask", "work:cancel", {task_id: task.task_id, reason_code: "OPERATOR_CANCEL", reason: "Cancelled from ONYX Command Center"}],
      } as const;
      const [commandType, scope, payload] = config[type];
      const command = envelope(commandType, "Task", task.task_id, organizationId, principalId, scope, payload);
      command.expected_version = task.version;
      command.expected_lifecycle_epoch = task.lifecycle_epoch;
      command.expected_authority_epoch = task.authority_epoch;
      await api(`/v1/work/commands/${commandType}`, {method: "POST", body: JSON.stringify(command)});
      await refresh();
      const updated = await api<Task>(`/v1/tasks/${task.task_id}?organization_id=${organizationId}`);
      await openRecord({kind: "task", record: updated}, false);
      setToast(`${commandType.replace(/([A-Z])/g, " $1").trim()} completed`);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Task action failed");
    } finally {
      setActionLoading("");
    }
  }

  async function runTimelineAction(type: "deadline" | "move" | "milestone" | "marker" | "penalty" | "resolve" | "archive") {
    if (!selectedRecord || selectedRecord.kind !== "timeline") return;
    const timeline = selectedRecord.record;
    if (type === "archive" && !window.confirm("Archive this timeline?")) return;
    setActionLoading(type);
    try {
      const instant = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString().replace(/Z$/, "000Z");
      const deadlineId = Object.keys(timeline.deadlines)[0];
      if (type === "move" && !deadlineId) throw new Error("Set a deadline before moving it");
      const config = {
        deadline: ["SetDeadline", "timeline:deadline:set", {timeline_id: timeline.timeline_id, deadline_id: uuidV7(), deadline_at: instant(72), label: "Operational deadline"}],
        move: ["MoveDeadline", "timeline:deadline:move", {timeline_id: timeline.timeline_id, deadline_id: deadlineId, new_deadline_at: instant(96), reason: "Schedule adjustment from ONYX Command Center"}],
        milestone: ["AddMilestone", "timeline:milestone:add", {timeline_id: timeline.timeline_id, milestone_id: uuidV7(), title: "Operational milestone", due_at: instant(48)}],
        marker: ["DefineCriticalMarker", "timeline:marker:define", {timeline_id: timeline.timeline_id, marker_id: uuidV7(), label: "Critical decision point", trigger_at: instant(36)}],
        penalty: ["ActivatePenaltyZone", "timeline:penalty-zone:activate", {timeline_id: timeline.timeline_id, penalty_zone_id: uuidV7(), starts_at: instant(120), reason: "Late-delivery boundary"}],
        resolve: ["ResolveScheduleException", "timeline:exception:resolve", {timeline_id: timeline.timeline_id, exception_id: uuidV7(), resolution_note: "Schedule variance resolved from ONYX Command Center"}],
        archive: ["ArchiveTimeline", "timeline:archive", {timeline_id: timeline.timeline_id, retention_policy_id: uuidV7()}],
      } as const;
      const [commandType, scope, payload] = config[type];
      const command = envelope(commandType, "Timeline", timeline.timeline_id, organizationId, principalId, scope, payload);
      command.expected_version = timeline.version; command.expected_lifecycle_epoch = timeline.lifecycle_epoch; command.expected_authority_epoch = timeline.authority_epoch;
      await api(`/v1/timeline/commands/${commandType}`, {method: "POST", body: JSON.stringify(command)});
      await refresh(); const updated = await api<Timeline>(`/v1/timelines/${timeline.timeline_id}?organization_id=${organizationId}`); await openRecord({kind: "timeline", record: updated}, false);
      setToast(`${commandType.replace(/([A-Z])/g, " $1").trim()} completed`);
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "Timeline action failed"); } finally { setActionLoading(""); }
  }

  async function runReportAction(type: "evidence" | "verify" | "reject-evidence" | "submit" | "approve" | "reject" | "archive") {
    if (!selectedRecord || selectedRecord.kind !== "report") return;
    const report = selectedRecord.record, evidenceId = Object.keys(report.evidence)[0];
    if (["verify", "reject-evidence"].includes(type) && !evidenceId) { setToast("Add evidence first"); return; }
    if (type === "submit" && !Object.values(report.evidence).some((item) => item.status === "VERIFIED")) { setToast("Verify at least one evidence item first"); return; }
    if (["reject", "archive"].includes(type) && !window.confirm(`${type === "reject" ? "Reject" : "Archive"} this report?`)) return;
    setActionLoading(type);
    try {
      const config = {
        evidence: ["AddEvidence", "reporting-evidence:evidence:add", {report_id: report.report_id, evidence_id: uuidV7(), evidence_type: "DOCUMENT", uri: `urn:onyx:evidence:${uuidV7()}`, content_hash: "a".repeat(64), description: "Evidence captured from ONYX Command Center"}],
        verify: ["VerifyEvidence", "reporting-evidence:evidence:verify", {report_id: report.report_id, evidence_id: evidenceId, verification_note: "Evidence provenance verified"}],
        "reject-evidence": ["RejectEvidence", "reporting-evidence:evidence:reject", {report_id: report.report_id, evidence_id: evidenceId, reason_code: "UNVERIFIED", reason: "Evidence rejected from ONYX Command Center"}],
        submit: ["SubmitReport", "reporting-evidence:submit", {report_id: report.report_id, submission_note: "Submitted from ONYX Command Center"}],
        approve: ["ApproveReport", "reporting-evidence:approve", {report_id: report.report_id, approval_note: "Approved from ONYX Command Center"}],
        reject: ["RejectReport", "reporting-evidence:reject", {report_id: report.report_id, reason_code: "REVISION_REQUIRED", reason: "Report returned for revision"}],
        archive: ["ArchiveReport", "reporting-evidence:archive", {report_id: report.report_id, retention_policy_id: uuidV7()}],
      } as const;
      const [commandType, scope, payload] = config[type]; const command = envelope(commandType, "Report", report.report_id, organizationId, principalId, scope, payload);
      command.expected_version = report.version; command.expected_lifecycle_epoch = report.lifecycle_epoch; command.expected_authority_epoch = report.authority_epoch;
      await api(`/v1/reporting-evidence/commands/${commandType}`, {method: "POST", body: JSON.stringify(command)}); await refresh();
      const updated = await api<Report>(`/v1/reports/${report.report_id}?organization_id=${organizationId}`); await openRecord({kind: "report", record: updated}, false); setToast(`${commandType.replace(/([A-Z])/g, " $1").trim()} completed`);
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "Report action failed"); } finally { setActionLoading(""); }
  }

  const activeMissions = missions.filter((item) => item.status === "ACTIVE").length;
  const openTasks = tasks.filter((item) => !["CLOSED", "CANCELLED"].includes(item.status)).length;
  const completion = tasks.length ? Math.round(((tasks.length - openTasks) / tasks.length) * 100) : 0;
  const filteredMissions = useMemo(() => {
    const needle = search.toLowerCase().trim();
    if (!needle) return missions;
    return missions.filter((mission) => `${mission.title} ${mission.objective} ${mission.status}`.toLowerCase().includes(needle));
  }, [missions, search]);
  const filteredTasks = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return needle ? tasks.filter((task) => `${task.title} ${task.description} ${task.priority} ${task.status}`.toLowerCase().includes(needle)) : tasks;
  }, [tasks, search]);
  const filteredTimelines = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return needle ? timelines.filter((timeline) => `${timeline.timeline_id} ${timeline.subject_ref.aggregate_type} ${timeline.subject_ref.object_id} ${timeline.timezone}`.toLowerCase().includes(needle)) : timelines;
  }, [timelines, search]);
  const filteredReports = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return needle ? reports.filter((report) => `${report.title} ${report.report_type} ${report.subject_ref.aggregate_type} ${report.subject_ref.object_id}`.toLowerCase().includes(needle)) : reports;
  }, [reports, search]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createKind) return;
    setSubmitting(true);
    const data = new FormData(event.currentTarget);
    try {
      if (createKind === "mission") {
        const id = uuidV7();
        const command = envelope("CreateMission", "Mission", id, organizationId, principalId, "mission:create", {
          mission_id: id,
          title: String(data.get("title") || "Untitled mission"),
          objective: String(data.get("objective") || ""),
          owner_id: principalId,
          settings: {},
        });
        await api("/v1/mission/commands/CreateMission", { method: "POST", body: JSON.stringify(command) });
      }
      if (createKind === "task") {
        const id = uuidV7();
        const command = envelope("CreateTask", "Task", id, organizationId, principalId, "work:create", {
          task_id: id,
          mission_id: String(data.get("mission_id")),
          title: String(data.get("title") || "Untitled task"),
          description: String(data.get("description") || ""),
          owner_id: principalId,
          priority: String(data.get("priority") || "MEDIUM"),
        });
        await api("/v1/work/commands/CreateTask", { method: "POST", body: JSON.stringify(command) });
      }
      if (createKind === "timeline") {
        const id = uuidV7();
        const command = envelope("CreateTimeline", "Timeline", id, organizationId, principalId, "timeline:create", {
          timeline_id: id,
          subject_ref: parseSubjectRef(data.get("subject_ref")),
          timezone: String(data.get("timezone") || "Asia/Tehran"),
        });
        await api("/v1/timeline/commands/CreateTimeline", { method: "POST", body: JSON.stringify(command) });
      }
      if (createKind === "report") {
        const id = uuidV7();
        const command = envelope("CreateReport", "Report", id, organizationId, principalId, "reporting-evidence:create", {
          report_id: id,
          report_type: String(data.get("report_type") || "MISSION_STATUS"),
          subject_ref: parseSubjectRef(data.get("subject_ref")),
          author_id: principalId,
          title: String(data.get("title") || "Mission status report"),
        });
        await api("/v1/reporting-evidence/commands/CreateReport", { method: "POST", body: JSON.stringify(command) });
      }
      setCreateKind(null);
      setToast(`${createKind[0].toUpperCase()}${createKind.slice(1)} created successfully`);
      await refresh();
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Creation failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function runOrganizationAction(type: "initialize" | "workspace" | "department" | "team" | "group" | "move" | "archive-department" | "archive-organization") {
    if (type === "archive-organization" && !window.confirm("Archive this organization and fence its lifecycle?")) return;
    setActionLoading(`organization:${type}`);
    try {
      const activeDepartments = Object.values(organization?.departments ?? {}).filter((item) => item.status === "ACTIVE");
      const teams = Object.values(organization?.teams ?? {});
      let commandType: string, scope: string, aggregateType: string, objectId: string, payload: Record<string, unknown>;
      if (type === "initialize") {
        commandType = "CreateOrganization"; scope = "organization:create"; aggregateType = "Organization"; objectId = organizationId;
        payload = {organization_id: organizationId, name: "ONYX Workspace", slug: `onyx-${organizationId.slice(-6).toLowerCase()}`};
      } else if (!organization) {
        throw new Error("Initialize the organization first");
      } else if (type === "workspace") {
        objectId = uuidV7(); commandType = "CreateWorkspace"; scope = "organization:workspace:create"; aggregateType = "Workspace";
        payload = {organization_id: organizationId, workspace_id: objectId, name: `Workspace ${Object.keys(organization.workspaces).length + 1}`};
      } else if (type === "department") {
        objectId = uuidV7(); commandType = "CreateDepartment"; scope = "organization:department:create"; aggregateType = "Department";
        payload = {organization_id: organizationId, department_id: objectId, name: `Department ${Object.keys(organization.departments).length + 1}`};
      } else if (type === "team") {
        if (!activeDepartments.length) throw new Error("Create an active department first");
        objectId = uuidV7(); commandType = "CreateTeam"; scope = "organization:team:create"; aggregateType = "Team";
        payload = {organization_id: organizationId, team_id: objectId, department_id: activeDepartments[0].department_id, name: `Team ${teams.length + 1}`};
      } else if (type === "group") {
        objectId = uuidV7(); commandType = "CreateGroup"; scope = "organization:group:create"; aggregateType = "Group";
        payload = {organization_id: organizationId, group_id: objectId, name: `Group ${Object.keys(organization.groups).length + 1}`};
      } else if (type === "move") {
        if (!teams.length || activeDepartments.length < 2) throw new Error("Create a team and at least two active departments first");
        const team = teams[0], destination = activeDepartments.find((item) => item.department_id !== team.department_id);
        if (!destination) throw new Error("No destination department is available");
        objectId = team.team_id; commandType = "MoveTeam"; scope = "organization:team:move"; aggregateType = "Team";
        payload = {organization_id: organizationId, team_id: objectId, to_department_id: destination.department_id, reason: "Hierarchy update from ONYX Command Center"};
      } else if (type === "archive-department") {
        const department = activeDepartments.find((item) => !teams.some((team) => team.department_id === item.department_id));
        if (!department) throw new Error("No empty active department can be archived");
        objectId = department.department_id; commandType = "ArchiveDepartment"; scope = "organization:department:archive"; aggregateType = "Department";
        payload = {organization_id: organizationId, department_id: objectId, reason: "Consolidated from ONYX Command Center"};
      } else {
        objectId = organizationId; commandType = "ArchiveOrganization"; scope = "organization:archive"; aggregateType = "Organization";
        payload = {organization_id: organizationId, retention_policy_id: uuidV7()};
      }
      const command = envelope(commandType, aggregateType, objectId, organizationId, principalId, scope, payload);
      if (organization && type !== "initialize") {
        command.expected_version = organization.version;
        command.expected_lifecycle_epoch = organization.lifecycle_epoch;
        command.expected_authority_epoch = organization.authority_epoch;
      }
      await api(`/v1/organization/commands/${commandType}`, {method: "POST", body: JSON.stringify(command)});
      await refresh();
      setToast(`${commandType.replace(/([A-Z])/g, " $1").trim()} completed`);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Organization action failed");
    } finally {
      setActionLoading("");
    }
  }

  async function runIdentityAction(type: "create" | "assign-role" | "revoke-role" | "register-device" | "revoke-device" | "delegate" | "revoke-delegation" | "disable" | "enable", selectedUser?: UserIdentity) {
    setActionLoading(`identity:${type}`);
    try {
      const user = selectedUser ?? users[0];
      let commandType: string, scope: string, userId: string, payload: Record<string, unknown>;
      if (type === "create") {
        userId = uuidV7(); commandType = "CreateUser"; scope = "identity-authority:user:create";
        payload = {user_id: userId, email: `user-${userId.slice(-8)}@onyx.local`, display_name: `ONYX User ${users.length + 1}`};
      } else {
        if (!user) throw new Error("Create a user first"); userId = user.user_id;
        if (type === "assign-role") { commandType = "AssignRole"; scope = "identity-authority:role:assign"; payload = {user_id: userId, role_id: `operator-${Object.keys(user.roles).length + 1}`}; }
        else if (type === "revoke-role") { const role = Object.values(user.roles)[0]; if (!role) throw new Error("Assign a role first"); commandType = "RevokeRole"; scope = "identity-authority:role:revoke"; payload = {user_id: userId, role_id: role.role_id, reason: "Role rotation from ONYX Command Center"}; }
        else if (type === "register-device") { commandType = "RegisterDevice"; scope = "identity-authority:device:register"; payload = {user_id: userId, device_id: uuidV7(), name: `Secure device ${Object.keys(user.devices).length + 1}`, public_key_thumbprint: Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")}; }
        else if (type === "revoke-device") { const device = Object.values(user.devices).find((item) => item.status === "ACTIVE"); if (!device) throw new Error("Register an active device first"); commandType = "RevokeDevice"; scope = "identity-authority:device:revoke"; payload = {user_id: userId, device_id: device.device_id, reason: "Device retired from ONYX Command Center"}; }
        else if (type === "delegate") { commandType = "DelegateAuthority"; scope = "identity-authority:delegate"; payload = {user_id: userId, delegation_id: uuidV7(), delegatee_id: uuidV7(), scopes: ["mission:read", "work:create"], expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString().replace(/Z$/, "000Z")}; }
        else if (type === "revoke-delegation") { const delegation = Object.values(user.delegations).find((item) => item.status === "ACTIVE"); if (!delegation) throw new Error("Create an active delegation first"); commandType = "RevokeDelegation"; scope = "identity-authority:delegation:revoke"; payload = {user_id: userId, delegation_id: delegation.delegation_id, reason: "Delegation closed from ONYX Command Center"}; }
        else if (type === "disable") { if (!window.confirm("Disable this user and invalidate current authority?")) return; commandType = "DisableUser"; scope = "identity-authority:user:disable"; payload = {user_id: userId, reason: "Disabled from ONYX Command Center"}; }
        else { commandType = "EnableUser"; scope = "identity-authority:user:enable"; payload = {user_id: userId, reason: "Re-enabled from ONYX Command Center"}; }
      }
      const command = envelope(commandType, "User", userId, organizationId, principalId, scope, payload);
      if (type !== "create" && user) { command.expected_version = user.version; command.expected_lifecycle_epoch = user.lifecycle_epoch; command.expected_authority_epoch = user.authority_epoch; command.authority_proof = {...command.authority_proof as object, authority_epoch: user.authority_epoch}; }
      await api(`/v1/identity-authority/commands/${commandType}`, {method: "POST", body: JSON.stringify(command)}); await refresh();
      setToast(`${commandType.replace(/([A-Z])/g, " $1").trim()} completed`);
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "Identity action failed"); } finally { setActionLoading(""); }
  }

  async function runContextLinkAction(type:"create"|"metadata"|"strength"|"archive"|"restore",selected?:ContextLink){setActionLoading(`context:${type}`);try{const link=selected??contextLinks[0];let commandType:string,scope:string,id:string,payload:Record<string,unknown>;
    if(type==="create"){const references=[...missions.map((item)=>({aggregate_type:"Mission",object_id:item.mission_id})),...tasks.map((item)=>({aggregate_type:"Task",object_id:item.task_id})),...timelines.map((item)=>({aggregate_type:"Timeline",object_id:item.timeline_id})),...reports.map((item)=>({aggregate_type:"Report",object_id:item.report_id})),...users.map((item)=>({aggregate_type:"User",object_id:item.user_id})),...(organization?[{aggregate_type:"Organization",object_id:organization.organization_id}]:[])];if(references.length<2)throw new Error("Create at least two operational objects first");id=uuidV7();commandType="CreateContextLink";scope="context:create";payload={context_link_id:id,source_ref:references[0],target_ref:references[1],relation_type:"RELATES_TO",strength:"NORMAL",metadata:{origin:"command-center"}};
    }else{if(!link)throw new Error("Create a context link first");id=link.context_link_id;if(type==="metadata"){commandType="UpdateContextMetadata";scope="context:metadata:update";payload={context_link_id:id,metadata:{...link.metadata,reviewed:"true"}};}else if(type==="strength"){const values=["WEAK","NORMAL","STRONG","CRITICAL"] as const,next=values[(values.indexOf(link.strength)+1)%values.length];commandType="ChangeContextStrength";scope="context:strength:change";payload={context_link_id:id,strength:next,reason:"Graph priority updated from ONYX Command Center"};}else if(type==="archive"){if(!window.confirm("Archive this context link?"))return;commandType="ArchiveContextLink";scope="context:archive";payload={context_link_id:id,reason:"Archived from ONYX Command Center"};}else{commandType="RestoreContextLink";scope="context:restore";payload={context_link_id:id,reason:"Restored from ONYX Command Center"};}}
    const command=envelope(commandType,"ContextLink",id,organizationId,principalId,scope,payload);if(type!=="create"&&link){command.expected_version=link.version;command.expected_lifecycle_epoch=link.lifecycle_epoch;command.expected_authority_epoch=link.authority_epoch;}await api(`/v1/context/commands/${commandType}`,{method:"POST",body:JSON.stringify(command)});await refresh();setToast(`${commandType.replace(/([A-Z])/g," $1").trim()} completed`);
  }catch(caught){setToast(caught instanceof Error?caught.message:"Context link action failed");}finally{setActionLoading("");}}

  function saveIdentity() {
    localStorage.setItem("onyx.organization", organizationId);
    localStorage.setItem("onyx.principal", principalId);
    setToast("Workspace identity saved");
    void refresh();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">O</span>
          <div><strong>ONYX</strong><small>IFEM operations</small></div>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-heading">Workspace</p>
          {NAV.map((item) => (
            <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => navigateView(item.id)}>
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
              {item.id !== "overview" && <small>{item.id === "missions" ? missions.length : item.id === "tasks" ? tasks.length : item.id === "timelines" ? timelines.length : reports.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-card">
            <span className={ready?.status === "ready" ? "signal live" : "signal"} />
            <div><strong>{ready?.status === "ready" ? "Systems nominal" : "API unavailable"}</strong><small>{ready?.persistence?.durable ? "Durable SQLite" : "Checking persistence"}</small></div>
          </div>
          <button className="profile"><span>LH</span><div><strong>Operations lead</strong><small>Local workspace</small></div><b>⋯</b></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">O</span><strong>ONYX</strong></div>
          <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search missions and objectives…" /></label>
          <div className="top-actions"><button className="icon-button" aria-label="Refresh data" onClick={() => void refresh()}>↻</button><button className="primary-button" onClick={() => setCreateKind("mission")}><span>＋</span> New mission</button></div>
        </header>

        <div className="content">
          {error && <div className="error-banner"><span>!</span><div><strong>Connection interrupted</strong><p>{error}</p></div><button onClick={() => void refresh()}>Retry</button></div>}
          {view === "overview" && (
            <>
              <section className="hero-row">
                <div><p className="eyebrow">LIVE OPERATIONS · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</p><h1>Command center</h1><p>Direct every mission, work item, timeline and evidence trail from one operational surface.</p></div>
                <div className="hero-actions"><button className="secondary-button" onClick={() => navigateView("reports")}>View evidence</button><button className="primary-button" onClick={() => setCreateKind("mission")}>Create mission</button></div>
              </section>

              <section className="metrics-grid" aria-label="Workspace metrics">
                <article><div className="metric-top"><span className="metric-icon violet">◇</span><span className="trend">Live</span></div><strong>{loading ? "—" : missions.length}</strong><p>Total missions</p><small>{activeMissions} currently active</small></article>
                <article><div className="metric-top"><span className="metric-icon cyan">✓</span><span className="trend">Queue</span></div><strong>{loading ? "—" : openTasks}</strong><p>Open work items</p><small>{tasks.length} tracked across missions</small></article>
                <article><div className="metric-top"><span className="metric-icon amber">◷</span><span className="trend">Synced</span></div><strong>{loading ? "—" : timelines.length}</strong><p>Timelines</p><small>Operational schedules</small></article>
                <article><div className="metric-top"><span className="metric-icon green">▤</span><span className="trend positive-text">Verified</span></div><strong>{loading ? "—" : reports.length}</strong><p>Evidence reports</p><small>{completion}% task completion</small></article>
              </section>

              <OrganizationPanel organization={organization} loading={actionLoading} onAction={(type) => void runOrganizationAction(type)} />
              <IdentityPanel users={users} loading={actionLoading} onAction={(type, user) => void runIdentityAction(type, user)} />
              <ContextGraphPanel links={contextLinks} loading={actionLoading} onAction={(type, link) => void runContextLinkAction(type, link)} />

              <section className="dashboard-grid">
                <article className="panel mission-panel">
                  <div className="panel-header"><div><p className="eyebrow">MISSION PORTFOLIO</p><h2>Priority operations</h2></div><button onClick={() => navigateView("missions")}>View all <span>→</span></button></div>
                  <div className="mission-list">
                    {loading ? <LoadingRows /> : filteredMissions.length ? filteredMissions.slice(0, 5).map((mission, index) => <MissionRow key={mission.mission_id} mission={mission} index={index} taskCount={tasks.filter((task) => task.mission_id === mission.mission_id).length} onOpen={() => void openMission(mission)} />) : <EmptyState icon="◇" title="No missions yet" text="Create the first mission to activate your command center." action={() => setCreateKind("mission")} />}
                  </div>
                </article>
                <aside className="right-column">
                  <article className="panel quick-panel"><div className="panel-header"><div><p className="eyebrow">QUICK ACTIONS</p><h2>Move work forward</h2></div></div><div className="quick-grid"><button onClick={() => setCreateKind("task")} disabled={!missions.length}><span className="metric-icon cyan">✓</span><strong>New task</strong><small>Assign work</small></button><button onClick={() => setCreateKind("timeline")} disabled={!missions.length}><span className="metric-icon amber">◷</span><strong>Timeline</strong><small>Set cadence</small></button><button onClick={() => setCreateKind("report")} disabled={!missions.length}><span className="metric-icon green">▤</span><strong>Report</strong><small>Capture proof</small></button><button onClick={() => navigateView("missions")}><span className="metric-icon violet">⌕</span><strong>Explore</strong><small>Review state</small></button></div></article>
                  <article className="panel pulse-panel"><div className="panel-header"><div><p className="eyebrow">SYSTEM PULSE</p><h2>Infrastructure</h2></div><span className="live-label"><i /> LIVE</span></div><div className="pulse-row"><span>Persistence</span><strong>{ready?.persistence?.mode || "—"}</strong></div><div className="pulse-row"><span>Pending events</span><strong>{ready?.messaging?.outbox?.pending ?? "—"}</strong></div><div className="pulse-row"><span>Dead letters</span><strong>{ready?.messaging?.outbox?.deadLettered ?? "—"}</strong></div><div className="uptime"><div style={{ width: ready?.status === "ready" ? "100%" : "14%" }} /><span>API readiness</span><b>{ready?.status === "ready" ? "100%" : "Degraded"}</b></div></article>
                </aside>
              </section>
            </>
          )}

          {view !== "overview" && (
            <CollectionView view={view} missions={filteredMissions} tasks={filteredTasks} timelines={filteredTimelines} reports={filteredReports} loading={loading} hasMore={Boolean(nextCursors[view === "missions" ? "mission" : view === "tasks" ? "task" : view === "timelines" ? "timeline" : "report"])} loadingMore={loadingMore === (view === "missions" ? "mission" : view === "tasks" ? "task" : view === "timelines" ? "timeline" : "report")} onLoadMore={(kind) => void loadMore(kind)} onCreate={(kind) => setCreateKind(kind)} onOpenMission={(mission) => void openMission(mission)} onOpenRecord={(selection) => void openRecord(selection)} />
          )}

          <details className="workspace-settings">
            <summary>Local workspace identity</summary>
            <div><label>Organization ID<input value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} /></label><label>Principal ID<input value={principalId} onChange={(event) => setPrincipalId(event.target.value)} /></label><button className="secondary-button" onClick={saveIdentity}>Save identity</button></div>
          </details>
        </div>
      </section>

      {createKind && <CreateModal kind={createKind} missions={missions} tasks={tasks} timelines={timelines} submitting={submitting} onClose={() => setCreateKind(null)} onSubmit={submitCreate} />}
      {selectedMission && <MissionDetail mission={selectedMission} history={missionHistory} tasks={tasks.filter((task) => task.mission_id === selectedMission.mission_id)} timelines={timelines.filter((timeline) => timeline.subject_ref.object_id === selectedMission.mission_id)} reports={reports.filter((report) => report.subject_ref.object_id === selectedMission.mission_id)} loading={detailLoading} actionLoading={actionLoading} onAction={(type) => void runMissionAction(type)} onOpenRecord={(selection) => void openRecord(selection)} onClose={closeDetails} />}
      {selectedRecord && <><RecordDetail selection={selectedRecord} history={recordHistory} missions={missions} tasks={tasks} timelines={timelines} reports={reports} loading={detailLoading} actionLoading={actionLoading} onTaskAction={(type) => void runTaskAction(type)} onOpenMission={(mission) => void openMission(mission)} onOpenRecord={(nextSelection) => void openRecord(nextSelection)} onClose={closeDetails} />{selectedRecord.kind === "timeline" && selectedRecord.record.status !== "ARCHIVED" && <TimelineActionPanel loading={actionLoading} onAction={(type) => void runTimelineAction(type)} />}{selectedRecord.kind === "report" && selectedRecord.record.status !== "ARCHIVED" && <ReportActionPanel report={selectedRecord.record} loading={actionLoading} onAction={(type) => void runReportAction(type)} />}</>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function OrganizationPanel({ organization, loading, onAction }: { organization: Organization | null; loading: string; onAction: (type: "initialize" | "workspace" | "department" | "team" | "group" | "move" | "archive-department" | "archive-organization") => void }) {
  if (!organization) return <section className="panel organization-panel organization-empty"><div><p className="eyebrow">ORGANIZATION STRUCTURE</p><h2>Initialize the hierarchy</h2><p>Create the organization aggregate before adding workspaces, departments, teams, and groups.</p></div><button className="primary-button" disabled={Boolean(loading)} onClick={() => onAction("initialize")}>{loading ? "Initializing…" : "Initialize organization"}</button></section>;
  const departments = Object.values(organization.departments), teams = Object.values(organization.teams);
  return <section className="panel organization-panel">
    <div className="organization-heading"><div><p className="eyebrow">ORGANIZATION STRUCTURE · V{organization.version}</p><h2>{organization.name}</h2><p>{organization.slug} · <span className={statusClass(organization.status)}>{organization.status}</span></p></div><div className="organization-counts"><span><strong>{Object.keys(organization.workspaces).length}</strong> workspaces</span><span><strong>{departments.length}</strong> departments</span><span><strong>{teams.length}</strong> teams</span><span><strong>{Object.keys(organization.groups).length}</strong> groups</span></div></div>
    <div className="organization-tree" aria-label="Organization hierarchy">
      {departments.length ? departments.map((department) => <article key={department.department_id}><div><span className="organization-node">◎</span><strong>{department.name}</strong><small>{department.status} · {shortId(department.department_id)}</small></div><ul>{teams.filter((team) => team.department_id === department.department_id).map((team) => <li key={team.team_id}><span>↳</span>{team.name}<small>{shortId(team.team_id)}</small></li>)}{!teams.some((team) => team.department_id === department.department_id) && <li className="empty-branch">No assigned teams</li>}</ul></article>) : <p className="organization-placeholder">Add a department to begin mapping the operating hierarchy.</p>}
    </div>
    {organization.status !== "ARCHIVED" && <div className="organization-actions"><button disabled={Boolean(loading)} onClick={() => onAction("workspace")}>＋ Workspace</button><button disabled={Boolean(loading)} onClick={() => onAction("department")}>＋ Department</button><button disabled={Boolean(loading)} onClick={() => onAction("team")}>＋ Team</button><button disabled={Boolean(loading)} onClick={() => onAction("group")}>＋ Group</button><button disabled={Boolean(loading)} onClick={() => onAction("move")}>Move team</button><button disabled={Boolean(loading)} onClick={() => onAction("archive-department")}>Archive department</button><button className="danger-control" disabled={Boolean(loading)} onClick={() => onAction("archive-organization")}>Archive organization</button></div>}
  </section>;
}

function IdentityPanel({ users, loading, onAction }: { users: UserIdentity[]; loading: string; onAction: (type: "create" | "assign-role" | "revoke-role" | "register-device" | "revoke-device" | "delegate" | "revoke-delegation" | "disable" | "enable", user?: UserIdentity) => void }) {
  const user = users[0];
  return <section className="panel identity-panel">
    <div className="identity-heading"><div><p className="eyebrow">IDENTITY & AUTHORITY</p><h2>Users, credentials, and delegated scope</h2><p>Epoch-fenced access control with immutable authority history.</p></div><button className="primary-button" disabled={Boolean(loading)} onClick={() => onAction("create")}>＋ Create user</button></div>
    <div className="identity-users">{users.length ? users.slice(0, 5).map((item) => <article key={item.user_id} className={item.user_id === user?.user_id ? "selected" : ""}><span>{item.display_name.split(/\s+/).map((word) => word[0]).join("").slice(0,2).toUpperCase()}</span><div><strong>{item.display_name}</strong><small>{item.email} · v{item.version}</small></div><b className={statusClass(item.status)}>{item.status}</b><div className="identity-stats"><small>{Object.keys(item.roles).length} roles</small><small>{Object.values(item.devices).filter((device) => device.status === "ACTIVE").length} devices</small><small>{Object.values(item.delegations).filter((delegation) => delegation.status === "ACTIVE").length} delegations</small></div></article>) : <p className="organization-placeholder">No users exist in this organization yet.</p>}</div>
    {user && <div className="organization-actions identity-actions"><button disabled={Boolean(loading) || user.status === "DISABLED"} onClick={() => onAction("assign-role", user)}>Assign role</button><button disabled={Boolean(loading) || user.status === "DISABLED"} onClick={() => onAction("revoke-role", user)}>Revoke role</button><button disabled={Boolean(loading) || user.status === "DISABLED"} onClick={() => onAction("register-device", user)}>Register device</button><button disabled={Boolean(loading) || user.status === "DISABLED"} onClick={() => onAction("revoke-device", user)}>Revoke device</button><button disabled={Boolean(loading) || user.status === "DISABLED"} onClick={() => onAction("delegate", user)}>Delegate authority</button><button disabled={Boolean(loading) || user.status === "DISABLED"} onClick={() => onAction("revoke-delegation", user)}>Revoke delegation</button>{user.status === "ACTIVE" ? <button className="danger-control" disabled={Boolean(loading)} onClick={() => onAction("disable", user)}>Disable user</button> : <button disabled={Boolean(loading)} onClick={() => onAction("enable", user)}>Enable user</button>}</div>}
  </section>;
}

function ContextGraphPanel({links,loading,onAction}:{links:ContextLink[];loading:string;onAction:(type:"create"|"metadata"|"strength"|"archive"|"restore",link?:ContextLink)=>void}){const link=links[0];return <section className="panel context-graph-panel"><div className="identity-heading"><div><p className="eyebrow">CONTEXT GRAPH</p><h2>Cross-domain relationships</h2><p>Validated edges connect existing objects without transferring aggregate ownership.</p></div><button className="primary-button" disabled={Boolean(loading)} onClick={()=>onAction("create")}>＋ Create link</button></div><div className="context-edge-grid">{links.length?links.slice(0,6).map((item)=><article key={item.context_link_id}><div className="context-node"><b>{item.source_ref.aggregate_type[0]}</b><span><strong>{item.source_ref.aggregate_type}</strong><small>{shortId(item.source_ref.object_id)}</small></span></div><div className="context-connector"><span>{item.relation_type.replaceAll("_"," ")}</span><i/><b>{item.strength}</b></div><div className="context-node"><b>{item.target_ref.aggregate_type[0]}</b><span><strong>{item.target_ref.aggregate_type}</strong><small>{shortId(item.target_ref.object_id)}</small></span></div><em className={statusClass(item.status)}>{item.status}</em></article>):<p className="organization-placeholder">No cross-domain edges exist yet.</p>}</div>{link&&<div className="organization-actions context-actions"><button disabled={Boolean(loading)||link.status!=="ACTIVE"} onClick={()=>onAction("metadata",link)}>Update metadata</button><button disabled={Boolean(loading)||link.status!=="ACTIVE"} onClick={()=>onAction("strength",link)}>Change strength</button>{link.status==="ACTIVE"?<button className="danger-control" disabled={Boolean(loading)} onClick={()=>onAction("archive",link)}>Archive link</button>:<button disabled={Boolean(loading)} onClick={()=>onAction("restore",link)}>Restore link</button>}</div>}</section>}

function MissionRow({ mission, index, taskCount, onOpen }: { mission: Mission; index: number; taskCount: number; onOpen: () => void }) {
  const colors = ["#7c6cf2", "#31b7c2", "#e19a43", "#59ad78", "#d76f91"];
  return <article className="mission-row"><div className="mission-code" style={{ background: `${colors[index % colors.length]}18`, color: colors[index % colors.length] }}>{String(index + 1).padStart(2, "0")}</div><button className="mission-main mission-open" onClick={onOpen}><div><strong>{mission.title || "Untitled mission"}</strong><span className={statusClass(mission.status)}>{mission.status.replaceAll("_", " ")}</span></div><p>{mission.objective}</p><small>ID {shortId(mission.mission_id)} · version {mission.version}</small></button><div className="mission-stat"><strong>{taskCount}</strong><small>work items</small></div><button className="row-action" onClick={onOpen} aria-label={`Open ${mission.title || "mission"}`}>›</button></article>;
}

function LoadingRows() {
  return <div className="loading-rows">{[1, 2, 3].map((item) => <div key={item}><i /><span><b /><b /></span></div>)}</div>;
}

function EmptyState({ icon, title, text, action }: { icon: string; title: string; text: string; action: () => void }) {
  return <div className="empty-state"><span>{icon}</span><strong>{title}</strong><p>{text}</p><button onClick={action}>Create now</button></div>;
}

function CollectionView({ view, missions, tasks, timelines, reports, loading, hasMore, loadingMore, onLoadMore, onCreate, onOpenMission, onOpenRecord }: { view: Exclude<View, "overview">; missions: Mission[]; tasks: Task[]; timelines: Timeline[]; reports: Report[]; loading: boolean; hasMore: boolean; loadingMore: boolean; onLoadMore: (kind: CreateKind) => void; onCreate: (kind: CreateKind) => void; onOpenMission: (mission: Mission) => void; onOpenRecord: (selection: RecordSelection) => void }) {
  const labels = { missions: ["Mission portfolio", "Every objective and its operational state."], tasks: ["Work queue", "Assignments moving each mission forward."], timelines: ["Timelines", "Cadence and timezone for operational subjects."], reports: ["Evidence library", "Versioned proof connected to mission outcomes."] } as const;
  const kind = view === "missions" ? "mission" : view === "tasks" ? "task" : view === "timelines" ? "timeline" : "report";
  const items = view === "missions" ? missions : view === "tasks" ? tasks : view === "timelines" ? timelines : reports;
  return <section className="collection-page"><div className="collection-heading"><div><p className="eyebrow">ONYX WORKSPACE</p><h1>{labels[view][0]}</h1><p>{labels[view][1]}</p></div><button className="primary-button" onClick={() => onCreate(kind)} disabled={kind !== "mission" && !missions.length}>＋ New {kind}</button></div><div className="collection-summary"><span><strong>{items.length}</strong> records loaded</span><span><i /> API synchronized</span><span>{hasMore ? "More records available" : "All records loaded"}</span></div><div className="data-panel">{loading ? <LoadingRows /> : !items.length ? <EmptyState icon={view === "missions" ? "◇" : view === "tasks" ? "✓" : view === "timelines" ? "◷" : "▤"} title={`No ${view} yet`} text={`Create your first ${kind} to populate this workspace.`} action={() => onCreate(kind)} /> : <table><thead><tr>{view === "missions" && <><th>Mission</th><th>Objective</th><th>Status</th><th>Version</th></>}{view === "tasks" && <><th>Task</th><th>Mission</th><th>Priority</th><th>Status</th></>}{view === "timelines" && <><th>Timeline</th><th>Subject</th><th>Timezone</th><th>Version</th></>}{view === "reports" && <><th>Report</th><th>Subject</th><th>Type</th><th>Version</th></>}</tr></thead><tbody>{view === "missions" && missions.map((item) => <tr key={item.mission_id} className="clickable-row" onClick={() => onOpenMission(item)}><td><strong>{item.title || "Untitled mission"}</strong><small>{shortId(item.mission_id)}</small></td><td>{item.objective}</td><td><span className={statusClass(item.status)}>{item.status}</span></td><td>v{item.version}</td></tr>)}{view === "tasks" && tasks.map((item) => <tr key={item.task_id} className="clickable-row" onClick={() => onOpenRecord({ kind: "task", record: item })}><td><strong>{item.title}</strong><small>{item.description}</small></td><td>{shortId(item.mission_id)}</td><td>{item.priority}</td><td><span className={statusClass(item.status)}>{item.status}</span></td></tr>)}{view === "timelines" && timelines.map((item) => <tr key={item.timeline_id} className="clickable-row" onClick={() => onOpenRecord({ kind: "timeline", record: item })}><td><strong>{shortId(item.timeline_id)}</strong></td><td>{item.subject_ref.aggregate_type} · {shortId(item.subject_ref.object_id)}</td><td>{item.timezone}</td><td>v{item.version}</td></tr>)}{view === "reports" && reports.map((item) => <tr key={item.report_id} className="clickable-row" onClick={() => onOpenRecord({ kind: "report", record: item })}><td><strong>{item.title}</strong><small>{shortId(item.report_id)}</small></td><td>{item.subject_ref.aggregate_type} · {shortId(item.subject_ref.object_id)}</td><td>{item.report_type.replaceAll("_", " ")}</td><td>v{item.version}</td></tr>)}</tbody></table>}</div>{items.length > 0 && <div className="collection-pagination"><span>{hasMore ? "Continue from the secure API cursor." : "You have reached the end of this collection."}</span>{hasMore && <button className="secondary-button" disabled={loadingMore} onClick={() => onLoadMore(kind)}>{loadingMore ? "Loading…" : "Load more"}</button>}</div>}</section>;
}

function MissionDetail({ mission, history, tasks, timelines, reports, loading, actionLoading, onAction, onOpenRecord, onClose }: { mission: Mission; history: DomainEvent[]; tasks: Task[]; timelines: Timeline[]; reports: Report[]; loading: boolean; actionLoading: string; onAction: (type: "plan" | "submit" | "activate" | "pause" | "resume" | "halt" | "restart" | "close" | "cancel" | "archive") => void; onOpenRecord: (selection: RecordSelection) => void; onClose: () => void }) {
  const primaryAction = mission.status === "DRAFT" ? ["plan", "Create plan"] : mission.status === "PLANNING" ? ["submit", "Submit plan"] : mission.status === "AWAITING_APPROVAL" ? ["activate", "Approve & activate"] : mission.status === "ACTIVE" ? ["pause", "Pause mission"] : mission.status === "PAUSED" ? ["resume", "Resume mission"] : mission.status === "HALTED" ? ["restart", "Restart mission"] : ["CANCELLED", "CLOSED"].includes(mission.status) ? ["archive", "Archive mission"] : null;
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="mission-drawer" role="dialog" aria-modal="true" aria-label="Mission details">
      <header><div><p className="eyebrow">MISSION RECORD</p><h2>{mission.title || "Untitled mission"}</h2></div><button onClick={onClose} aria-label="Close mission details">×</button></header>
      <div className="drawer-scroll">
        <div className="mission-identity"><span className={statusClass(mission.status)}>{mission.status.replaceAll("_", " ")}</span><code>{mission.mission_id}</code><p>{mission.objective}</p></div>
        <div className="detail-metrics"><div><strong>v{mission.version}</strong><small>Aggregate version</small></div><div><strong>{tasks.length}</strong><small>Work items</small></div><div><strong>{timelines.length}</strong><small>Timelines</small></div><div><strong>{reports.length}</strong><small>Evidence</small></div></div>
        {(tasks.length > 0 || timelines.length > 0 || reports.length > 0) && <section className="related-section">
          <div className="panel-header"><div><p className="eyebrow">CONNECTED RECORDS</p><h3>Operational graph</h3></div><small>{tasks.length + timelines.length + reports.length} direct links</small></div>
          <div className="related-grid">
            {tasks.map((task) => <button key={task.task_id} onClick={() => onOpenRecord({ kind: "task", record: task })}><span className="metric-icon cyan">✓</span><div><strong>{task.title}</strong><small>{task.status} · {task.priority}</small></div><b>›</b></button>)}
            {timelines.map((timeline) => <button key={timeline.timeline_id} onClick={() => onOpenRecord({ kind: "timeline", record: timeline })}><span className="metric-icon amber">◷</span><div><strong>{timeline.timezone}</strong><small>Timeline · {shortId(timeline.timeline_id)}</small></div><b>›</b></button>)}
            {reports.map((report) => <button key={report.report_id} onClick={() => onOpenRecord({ kind: "report", record: report })}><span className="metric-icon green">▤</span><div><strong>{report.title}</strong><small>{report.report_type.replaceAll("_", " ")}</small></div><b>›</b></button>)}
          </div>
        </section>}
        <section className="lifecycle-card"><div><p className="eyebrow">LIFECYCLE CONTROL</p><h3>Available operation</h3></div>{primaryAction ? <button className="primary-button" disabled={Boolean(actionLoading)} onClick={() => onAction(primaryAction[0] as "plan" | "submit" | "activate" | "pause" | "resume" | "restart" | "archive")}>{actionLoading === primaryAction[0] ? "Working…" : primaryAction[1]}</button> : <span className="status neutral">No transition</span>}</section>
        {["ACTIVE", "PAUSED"].includes(mission.status) && <button className="danger-action" disabled={Boolean(actionLoading)} onClick={() => onAction("halt")}>{actionLoading === "halt" ? "Halting…" : "Operational halt"}</button>}
        {["ACTIVE", "PAUSED", "HALTED", "REVIEW"].includes(mission.status) && <button className="danger-action" disabled={Boolean(actionLoading)} onClick={() => onAction("close")}>{actionLoading === "close" ? "Closing…" : "Close mission"}</button>}
        {!["CANCELLED", "CLOSED", "ARCHIVED"].includes(mission.status) && <button className="danger-action" disabled={Boolean(actionLoading)} onClick={() => onAction("cancel")}>Cancel mission</button>}
        <section className="history-section"><div className="panel-header"><div><p className="eyebrow">IMMUTABLE HISTORY</p><h3>Event timeline</h3></div><small>{history.length} events</small></div>{loading ? <LoadingRows /> : <div className="event-timeline">{[...history].reverse().map((event) => <article key={event.event_id}><i /><div><strong>{event.event_type.replace(/([A-Z])/g, " $1").trim()}</strong><p>Version {event.aggregate_version} · lifecycle {event.lifecycle_epoch}</p><small>{new Date(event.occurred_at).toLocaleString()}</small></div><code>{event.audit?.integrity_digest ? `${event.audit.integrity_digest.slice(0, 12)}…` : shortId(event.event_id)}</code></article>)}</div>}</section>
      </div>
    </aside>
  </div>;
}

function RecordDetail({ selection, history, missions, tasks, timelines, reports, loading, actionLoading, onTaskAction, onOpenMission, onOpenRecord, onClose }: { selection: RecordSelection; history: DomainEvent[]; missions: Mission[]; tasks: Task[]; timelines: Timeline[]; reports: Report[]; loading: boolean; actionLoading: string; onTaskAction: (type: "start" | "pause" | "block" | "submit" | "approve" | "close" | "reopen" | "cancel") => void; onOpenMission: (mission: Mission) => void; onOpenRecord: (selection: RecordSelection) => void; onClose: () => void }) {
  let id = "";
  let title = "";
  let description = "";
  let badge = "";
  let subject = { aggregate_type: "Mission", object_id: "" };
  if (selection.kind === "task") {
    id = selection.record.task_id;
    title = selection.record.title;
    description = selection.record.description;
    badge = selection.record.status;
    subject = { aggregate_type: "Mission", object_id: selection.record.mission_id };
  } else if (selection.kind === "timeline") {
    id = selection.record.timeline_id;
    title = `${selection.record.subject_ref.aggregate_type} timeline`;
    description = `Operational cadence anchored to ${selection.record.timezone}.`;
    badge = selection.record.timezone;
    subject = selection.record.subject_ref;
  } else {
    id = selection.record.report_id;
    title = selection.record.title;
    description = `Versioned ${selection.record.report_type.replaceAll("_", " ").toLowerCase()} evidence record.`;
    badge = selection.record.report_type;
    subject = selection.record.subject_ref;
  }
  const subjectTimeline = subject.aggregate_type === "Timeline" ? timelines.find((timeline) => timeline.timeline_id === subject.object_id) : undefined;
  const nestedSubject = subjectTimeline?.subject_ref;
  const taskId = subject.aggregate_type === "Task" ? subject.object_id : nestedSubject?.aggregate_type === "Task" ? nestedSubject.object_id : undefined;
  const subjectTask = tasks.find((task) => task.task_id === taskId);
  const missionId = subject.aggregate_type === "Mission" ? subject.object_id : nestedSubject?.aggregate_type === "Mission" ? nestedSubject.object_id : subjectTask?.mission_id;
  const mission = missions.find((item) => item.mission_id === missionId);
  const childTimelines = timelines.filter((item) => item.subject_ref.object_id === id);
  const childReports = reports.filter((item) => item.subject_ref.object_id === id);
  const relatedTimelines = childTimelines.length;
  const relatedReports = childReports.length;
  const version = selection.record.version;
  const kindLabel = selection.kind === "task" ? "WORK RECORD" : selection.kind === "timeline" ? "TIMELINE RECORD" : "EVIDENCE RECORD";
  const taskAction = selection.kind === "task" ? (selection.record.status === "DRAFT" ? ["start", "Start task"] : ["PAUSED", "BLOCKED"].includes(selection.record.status) ? ["start", "Resume task"] : selection.record.status === "ACTIVE" ? ["submit", "Submit completion"] : selection.record.status === "SUBMITTED" ? ["approve", "Approve completion"] : selection.record.status === "APPROVED" ? ["close", "Close task"] : selection.record.status === "CLOSED" ? ["reopen", "Reopen task"] : null) : null;
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="mission-drawer" role="dialog" aria-modal="true" aria-label={`${selection.kind} details`}><header><div><p className="eyebrow">{kindLabel}</p><h2>{title}</h2></div><button onClick={onClose} aria-label={`Close ${selection.kind} details`}>×</button></header><div className="drawer-scroll"><div className="mission-identity"><span className={selection.kind === "task" ? statusClass(badge) : "status neutral"}>{badge.replaceAll("_", " ")}</span><code>{id}</code><p>{description}</p></div><div className="detail-metrics"><div><strong>v{version}</strong><small>Aggregate version</small></div><div><strong>{history.length}</strong><small>Immutable events</small></div><div><strong>{relatedTimelines}</strong><small>Child timelines</small></div><div><strong>{relatedReports}</strong><small>Evidence links</small></div></div><section className="relationship-card"><div><p className="eyebrow">OPERATIONAL CONTEXT</p><h3>{subject.aggregate_type} · {shortId(subject.object_id)}</h3>{subjectTask && <small>{subjectTask.title}</small>}{subjectTimeline && <small>{subjectTimeline.timezone} timeline</small>}</div><div className="relationship-actions">{subjectTask && <button onClick={() => onOpenRecord({ kind: "task", record: subjectTask })}>Open task</button>}{subjectTimeline && <button onClick={() => onOpenRecord({ kind: "timeline", record: subjectTimeline })}>Open timeline</button>}{mission && <button onClick={() => onOpenMission(mission)}>Open mission <span>→</span></button>}</div></section>{(childTimelines.length > 0 || childReports.length > 0) && <section className="related-section compact"><div className="panel-header"><div><p className="eyebrow">DOWNSTREAM RECORDS</p><h3>Connected evidence</h3></div></div><div className="related-grid">{childTimelines.map((timeline) => <button key={timeline.timeline_id} onClick={() => onOpenRecord({ kind: "timeline", record: timeline })}><span className="metric-icon amber">◷</span><div><strong>{timeline.timezone}</strong><small>Timeline · {shortId(timeline.timeline_id)}</small></div><b>›</b></button>)}{childReports.map((report) => <button key={report.report_id} onClick={() => onOpenRecord({ kind: "report", record: report })}><span className="metric-icon green">▤</span><div><strong>{report.title}</strong><small>{report.report_type.replaceAll("_", " ")}</small></div><b>›</b></button>)}</div></section>}{selection.kind === "task" && <><section className="lifecycle-card"><div><p className="eyebrow">LIFECYCLE CONTROL</p><h3>Available operation</h3></div>{taskAction ? <button className="primary-button" disabled={Boolean(actionLoading)} onClick={() => onTaskAction(taskAction[0] as "start" | "submit" | "approve" | "close" | "reopen")}>{actionLoading === taskAction[0] ? "Working…" : taskAction[1]}</button> : <span className="status neutral">No transition</span>}</section>{selection.record.status === "ACTIVE" && <button className="danger-action" disabled={Boolean(actionLoading)} onClick={() => onTaskAction("pause")}>Pause task</button>}{["DRAFT", "ACTIVE", "PAUSED", "BLOCKED", "SUBMITTED", "APPROVED"].includes(selection.record.status) && <button className="danger-action" disabled={Boolean(actionLoading)} onClick={() => onTaskAction("cancel")}>Cancel task</button>}</>}<section className="history-section"><div className="panel-header"><div><p className="eyebrow">IMMUTABLE HISTORY</p><h3>Event timeline</h3></div><small>{history.length} events</small></div>{loading ? <LoadingRows /> : <div className="event-timeline">{[...history].reverse().map((event) => <article key={event.event_id}><i /><div><strong>{event.event_type.replace(/([A-Z])/g, " $1").trim()}</strong><p>Aggregate version {event.aggregate_version}</p><small>{new Date(event.occurred_at).toLocaleString()}</small></div><code>{event.audit?.integrity_digest ? `${event.audit.integrity_digest.slice(0, 12)}…` : shortId(event.event_id)}</code></article>)}</div>}</section></div></aside></div>;
}

function TimelineActionPanel({ loading, onAction }: { loading: string; onAction: (type: "deadline" | "move" | "milestone" | "marker" | "penalty" | "resolve" | "archive") => void }) {
  const actions = [["deadline", "Set deadline"], ["move", "Move deadline"], ["milestone", "Add milestone"], ["marker", "Critical marker"], ["penalty", "Penalty zone"], ["resolve", "Resolve exception"], ["archive", "Archive"]] as const;
  return <section className="timeline-action-panel" aria-label="Timeline contract operations"><strong>Schedule control</strong><div>{actions.map(([action, label]) => <button key={action} disabled={Boolean(loading)} onClick={() => onAction(action)}>{loading === action ? "Working…" : label}</button>)}</div></section>;
}

function ReportActionPanel({ report, loading, onAction }: { report: Report; loading: string; onAction: (type: "evidence" | "verify" | "reject-evidence" | "submit" | "approve" | "reject" | "archive") => void }) {
  const actions = report.status === "DRAFT" || report.status === "REJECTED"
    ? [["evidence", "Add evidence"], ["verify", "Verify evidence"], ["reject-evidence", "Reject evidence"], ["submit", "Submit report"]] as const
    : report.status === "SUBMITTED" ? [["approve", "Approve"], ["reject", "Reject"]] as const
    : report.status === "APPROVED" ? [["archive", "Archive"]] as const : [];
  return <section className="timeline-action-panel" aria-label="Report contract operations"><strong>Evidence control</strong><div>{actions.map(([action, label]) => <button key={action} disabled={Boolean(loading)} onClick={() => onAction(action)}>{loading === action ? "Working…" : label}</button>)}</div></section>;
}

function CreateModal({ kind, missions, tasks, timelines, submitting, onClose, onSubmit }: { kind: CreateKind; missions: Mission[]; tasks: Task[]; timelines: Timeline[]; submitting: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const titles = { mission: ["Create a mission", "Define the objective and establish a durable operational record."], task: ["Add a work item", "Connect a clear assignment to an existing mission."], timeline: ["Create a timeline", "Set the operating timezone for a mission or task."], report: ["Capture evidence", "Create a versioned report linked to a mission, task or timeline."] } as const;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button>
      <p className="eyebrow">NEW {kind.toUpperCase()}</p><h2 id="modal-title">{titles[kind][0]}</h2><p className="modal-intro">{titles[kind][1]}</p>
      <form onSubmit={onSubmit}>
        {kind === "task" && <label>Mission<select name="mission_id" required autoFocus defaultValue=""><option value="" disabled>Select a mission</option>{missions.map((mission) => <option key={mission.mission_id} value={mission.mission_id}>{mission.title || mission.objective.slice(0, 56)}</option>)}</select></label>}
        {(kind === "timeline" || kind === "report") && <label>Operational subject<select name="subject_ref" required autoFocus defaultValue=""><option value="" disabled>Select a subject</option><optgroup label="Missions">{missions.map((mission) => <option key={mission.mission_id} value={`Mission:${mission.mission_id}`}>{mission.title || mission.objective.slice(0, 56)}</option>)}</optgroup>{tasks.length > 0 && <optgroup label="Tasks">{tasks.map((task) => <option key={task.task_id} value={`Task:${task.task_id}`}>{task.title}</option>)}</optgroup>}{kind === "report" && timelines.length > 0 && <optgroup label="Timelines">{timelines.map((timeline) => <option key={timeline.timeline_id} value={`Timeline:${timeline.timeline_id}`}>{timeline.timezone} · {shortId(timeline.timeline_id)}</option>)}</optgroup>}</select></label>}
        {kind === "mission" && <><label>Mission title<input name="title" required autoFocus placeholder="e.g. Launch Tehran operations" maxLength={160} /></label><label>Objective<textarea name="objective" required placeholder="Describe the measurable outcome this mission must achieve…" rows={4} /></label></>}
        {kind === "task" && <><label>Task title<input name="title" required placeholder="e.g. Validate deployment readiness" /></label><label>Description<textarea name="description" required placeholder="What must be delivered?" rows={3} /></label><label>Priority<select name="priority" defaultValue="HIGH"><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label></>}
        {kind === "timeline" && <label>Timezone<select name="timezone" defaultValue="Asia/Tehran"><option>Asia/Tehran</option><option>UTC</option><option>Europe/London</option><option>America/New_York</option><option>Asia/Dubai</option></select></label>}
        {kind === "report" && <><label>Report title<input name="title" required placeholder="e.g. Weekly mission status" /></label><label>Report type<select name="report_type" defaultValue="MISSION_STATUS"><option value="MISSION_STATUS">Mission status</option><option value="RISK_REVIEW">Risk review</option><option value="OUTCOME_EVIDENCE">Outcome evidence</option><option value="EXECUTIVE_BRIEF">Executive brief</option></select></label></>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={submitting}>{submitting ? "Creating…" : `Create ${kind}`}</button></div>
      </form>
    </section>
  </div>;
}
