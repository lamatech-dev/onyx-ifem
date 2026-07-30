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

type MissionEvent = {
  event_id: string;
  event_type: string;
  aggregate_version: number;
  lifecycle_epoch: number;
  occurred_at: string;
  payload: Record<string, unknown>;
  audit?: { provenance?: string; integrity_digest?: string };
};

type Task = {
  task_id: string;
  mission_id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  version: number;
};

type Timeline = {
  timeline_id: string;
  subject_ref: { aggregate_type: string; object_id: string };
  timezone: string;
  version: number;
};

type Report = {
  report_id: string;
  report_type: string;
  subject_ref: { aggregate_type: string; object_id: string };
  title: string;
  version: number;
};

type Ready = {
  status: string;
  persistence?: { mode?: string; durable?: boolean };
  messaging?: { outbox?: { pending?: number; delivered?: number; deadLettered?: number } };
};

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

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [ready, setReady] = useState<Ready | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");
  const [organizationId, setOrganizationId] = useState(DEFAULT_ORG);
  const [principalId, setPrincipalId] = useState(DEFAULT_USER);
  const [search, setSearch] = useState("");
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);
  const [missionHistory, setMissionHistory] = useState<MissionEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = `organization_id=${encodeURIComponent(organizationId)}&limit=100`;
      const [healthData, missionData, taskData, timelineData, reportData] = await Promise.all([
        api<Ready>("/readyz"),
        api<{ items: Mission[] }>(`/v1/missions?${query}`),
        api<{ items: Task[] }>(`/v1/tasks?${query}`),
        api<{ items: Timeline[] }>(`/v1/timelines?${query}`),
        api<{ items: Report[] }>(`/v1/reports?${query}`),
      ]);
      setReady(healthData);
      setMissions(missionData.items);
      setTasks(taskData.items);
      setTimelines(timelineData.items);
      setReports(reportData.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reach ONYX API");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    const storedOrg = localStorage.getItem("onyx.organization");
    const storedPrincipal = localStorage.getItem("onyx.principal");
    if (storedOrg) setOrganizationId(storedOrg);
    if (storedPrincipal) setPrincipalId(storedPrincipal);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!createKind) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setCreateKind(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [createKind]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openMission = useCallback(async (mission: Mission) => {
    setSelectedMission(mission);
    setDetailLoading(true);
    try {
      const history = await api<{ items: MissionEvent[] }>(`/v1/missions/${mission.mission_id}/history?organization_id=${organizationId}&after_version=0&limit=100`);
      setMissionHistory(history.items);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Unable to load mission history");
    } finally {
      setDetailLoading(false);
    }
  }, [organizationId]);

  async function runMissionAction(type: "plan" | "submit" | "activate" | "pause" | "resume" | "cancel" | "archive") {
    if (!selectedMission) return;
    if (["cancel", "archive"].includes(type) && !window.confirm(`${type === "cancel" ? "Cancel" : "Archive"} this mission? This lifecycle transition cannot be undone.`)) return;
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
      if (type === "cancel") { commandType = "CancelMission"; scope = "mission:cancel"; payload = { ...payload, reason_code: "OPERATOR_CANCEL", reason: "Cancelled from ONYX Command Center" }; }
      if (type === "archive") { commandType = "ArchiveMission"; scope = "mission:archive"; payload = { ...payload, retention_policy_id: uuidV7() }; }
      const command = envelope(commandType, "Mission", selectedMission.mission_id, organizationId, principalId, scope, payload);
      command.expected_version = selectedMission.version;
      command.expected_lifecycle_epoch = selectedMission.lifecycle_epoch;
      command.expected_authority_epoch = selectedMission.authority_epoch;
      await api(`/v1/mission/commands/${commandType}`, { method: "POST", body: JSON.stringify(command) });
      await refresh();
      const updated = await api<Mission>(`/v1/missions/${selectedMission.mission_id}?organization_id=${organizationId}`);
      await openMission(updated);
      setToast(`${commandType.replace(/([A-Z])/g, " $1").trim()} completed`);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Mission action failed");
    } finally {
      setActionLoading("");
    }
  }

  const activeMissions = missions.filter((item) => item.status === "ACTIVE").length;
  const openTasks = tasks.filter((item) => !["CLOSED", "CANCELLED"].includes(item.status)).length;
  const completion = tasks.length ? Math.round(((tasks.length - openTasks) / tasks.length) * 100) : 0;
  const filteredMissions = useMemo(() => {
    const needle = search.toLowerCase().trim();
    if (!needle) return missions;
    return missions.filter((mission) => `${mission.title} ${mission.objective} ${mission.status}`.toLowerCase().includes(needle));
  }, [missions, search]);

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
          subject_ref: { aggregate_type: "Mission", object_id: String(data.get("mission_id")) },
          timezone: String(data.get("timezone") || "Asia/Tehran"),
        });
        await api("/v1/timeline/commands/CreateTimeline", { method: "POST", body: JSON.stringify(command) });
      }
      if (createKind === "report") {
        const id = uuidV7();
        const command = envelope("CreateReport", "Report", id, organizationId, principalId, "reporting-evidence:create", {
          report_id: id,
          report_type: String(data.get("report_type") || "MISSION_STATUS"),
          subject_ref: { aggregate_type: "Mission", object_id: String(data.get("mission_id")) },
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
            <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}>
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
                <div className="hero-actions"><button className="secondary-button" onClick={() => setView("reports")}>View evidence</button><button className="primary-button" onClick={() => setCreateKind("mission")}>Create mission</button></div>
              </section>

              <section className="metrics-grid" aria-label="Workspace metrics">
                <article><div className="metric-top"><span className="metric-icon violet">◇</span><span className="trend">Live</span></div><strong>{loading ? "—" : missions.length}</strong><p>Total missions</p><small>{activeMissions} currently active</small></article>
                <article><div className="metric-top"><span className="metric-icon cyan">✓</span><span className="trend">Queue</span></div><strong>{loading ? "—" : openTasks}</strong><p>Open work items</p><small>{tasks.length} tracked across missions</small></article>
                <article><div className="metric-top"><span className="metric-icon amber">◷</span><span className="trend">Synced</span></div><strong>{loading ? "—" : timelines.length}</strong><p>Timelines</p><small>Operational schedules</small></article>
                <article><div className="metric-top"><span className="metric-icon green">▤</span><span className="trend positive-text">Verified</span></div><strong>{loading ? "—" : reports.length}</strong><p>Evidence reports</p><small>{completion}% task completion</small></article>
              </section>

              <section className="dashboard-grid">
                <article className="panel mission-panel">
                  <div className="panel-header"><div><p className="eyebrow">MISSION PORTFOLIO</p><h2>Priority operations</h2></div><button onClick={() => setView("missions")}>View all <span>→</span></button></div>
                  <div className="mission-list">
                    {loading ? <LoadingRows /> : filteredMissions.length ? filteredMissions.slice(0, 5).map((mission, index) => <MissionRow key={mission.mission_id} mission={mission} index={index} taskCount={tasks.filter((task) => task.mission_id === mission.mission_id).length} onOpen={() => void openMission(mission)} />) : <EmptyState icon="◇" title="No missions yet" text="Create the first mission to activate your command center." action={() => setCreateKind("mission")} />}
                  </div>
                </article>
                <aside className="right-column">
                  <article className="panel quick-panel"><div className="panel-header"><div><p className="eyebrow">QUICK ACTIONS</p><h2>Move work forward</h2></div></div><div className="quick-grid"><button onClick={() => setCreateKind("task")} disabled={!missions.length}><span className="metric-icon cyan">✓</span><strong>New task</strong><small>Assign work</small></button><button onClick={() => setCreateKind("timeline")} disabled={!missions.length}><span className="metric-icon amber">◷</span><strong>Timeline</strong><small>Set cadence</small></button><button onClick={() => setCreateKind("report")} disabled={!missions.length}><span className="metric-icon green">▤</span><strong>Report</strong><small>Capture proof</small></button><button onClick={() => setView("missions")}><span className="metric-icon violet">⌕</span><strong>Explore</strong><small>Review state</small></button></div></article>
                  <article className="panel pulse-panel"><div className="panel-header"><div><p className="eyebrow">SYSTEM PULSE</p><h2>Infrastructure</h2></div><span className="live-label"><i /> LIVE</span></div><div className="pulse-row"><span>Persistence</span><strong>{ready?.persistence?.mode || "—"}</strong></div><div className="pulse-row"><span>Pending events</span><strong>{ready?.messaging?.outbox?.pending ?? "—"}</strong></div><div className="pulse-row"><span>Dead letters</span><strong>{ready?.messaging?.outbox?.deadLettered ?? "—"}</strong></div><div className="uptime"><div style={{ width: ready?.status === "ready" ? "100%" : "14%" }} /><span>API readiness</span><b>{ready?.status === "ready" ? "100%" : "Degraded"}</b></div></article>
                </aside>
              </section>
            </>
          )}

          {view !== "overview" && (
            <CollectionView view={view} missions={filteredMissions} tasks={tasks} timelines={timelines} reports={reports} loading={loading} onCreate={(kind) => setCreateKind(kind)} onOpenMission={(mission) => void openMission(mission)} />
          )}

          <details className="workspace-settings">
            <summary>Local workspace identity</summary>
            <div><label>Organization ID<input value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} /></label><label>Principal ID<input value={principalId} onChange={(event) => setPrincipalId(event.target.value)} /></label><button className="secondary-button" onClick={saveIdentity}>Save identity</button></div>
          </details>
        </div>
      </section>

      {createKind && <CreateModal kind={createKind} missions={missions} submitting={submitting} onClose={() => setCreateKind(null)} onSubmit={submitCreate} />}
      {selectedMission && <MissionDetail mission={selectedMission} history={missionHistory} tasks={tasks.filter((task) => task.mission_id === selectedMission.mission_id)} timelines={timelines.filter((timeline) => timeline.subject_ref.object_id === selectedMission.mission_id)} reports={reports.filter((report) => report.subject_ref.object_id === selectedMission.mission_id)} loading={detailLoading} actionLoading={actionLoading} onAction={(type) => void runMissionAction(type)} onClose={() => setSelectedMission(null)} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

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

function CollectionView({ view, missions, tasks, timelines, reports, loading, onCreate, onOpenMission }: { view: Exclude<View, "overview">; missions: Mission[]; tasks: Task[]; timelines: Timeline[]; reports: Report[]; loading: boolean; onCreate: (kind: CreateKind) => void; onOpenMission: (mission: Mission) => void }) {
  const labels = { missions: ["Mission portfolio", "Every objective and its operational state."], tasks: ["Work queue", "Assignments moving each mission forward."], timelines: ["Timelines", "Cadence and timezone for operational subjects."], reports: ["Evidence library", "Versioned proof connected to mission outcomes."] } as const;
  const kind = view === "missions" ? "mission" : view === "tasks" ? "task" : view === "timelines" ? "timeline" : "report";
  const items = view === "missions" ? missions : view === "tasks" ? tasks : view === "timelines" ? timelines : reports;
  return <section className="collection-page"><div className="collection-heading"><div><p className="eyebrow">ONYX WORKSPACE</p><h1>{labels[view][0]}</h1><p>{labels[view][1]}</p></div><button className="primary-button" onClick={() => onCreate(kind)} disabled={kind !== "mission" && !missions.length}>＋ New {kind}</button></div><div className="collection-summary"><span><strong>{items.length}</strong> total records</span><span><i /> API synchronized</span><span>Durable history enabled</span></div><div className="data-panel">{loading ? <LoadingRows /> : !items.length ? <EmptyState icon={view === "missions" ? "◇" : view === "tasks" ? "✓" : view === "timelines" ? "◷" : "▤"} title={`No ${view} yet`} text={`Create your first ${kind} to populate this workspace.`} action={() => onCreate(kind)} /> : <table><thead><tr>{view === "missions" && <><th>Mission</th><th>Objective</th><th>Status</th><th>Version</th></>}{view === "tasks" && <><th>Task</th><th>Mission</th><th>Priority</th><th>Status</th></>}{view === "timelines" && <><th>Timeline</th><th>Subject</th><th>Timezone</th><th>Version</th></>}{view === "reports" && <><th>Report</th><th>Subject</th><th>Type</th><th>Version</th></>}</tr></thead><tbody>{view === "missions" && missions.map((item) => <tr key={item.mission_id} className="clickable-row" onClick={() => onOpenMission(item)}><td><strong>{item.title || "Untitled mission"}</strong><small>{shortId(item.mission_id)}</small></td><td>{item.objective}</td><td><span className={statusClass(item.status)}>{item.status}</span></td><td>v{item.version}</td></tr>)}{view === "tasks" && tasks.map((item) => <tr key={item.task_id}><td><strong>{item.title}</strong><small>{item.description}</small></td><td>{shortId(item.mission_id)}</td><td>{item.priority}</td><td><span className={statusClass(item.status)}>{item.status}</span></td></tr>)}{view === "timelines" && timelines.map((item) => <tr key={item.timeline_id}><td><strong>{shortId(item.timeline_id)}</strong></td><td>{item.subject_ref.aggregate_type} · {shortId(item.subject_ref.object_id)}</td><td>{item.timezone}</td><td>v{item.version}</td></tr>)}{view === "reports" && reports.map((item) => <tr key={item.report_id}><td><strong>{item.title}</strong><small>{shortId(item.report_id)}</small></td><td>{item.subject_ref.aggregate_type} · {shortId(item.subject_ref.object_id)}</td><td>{item.report_type.replaceAll("_", " ")}</td><td>v{item.version}</td></tr>)}</tbody></table>}</div></section>;
}

function MissionDetail({ mission, history, tasks, timelines, reports, loading, actionLoading, onAction, onClose }: { mission: Mission; history: MissionEvent[]; tasks: Task[]; timelines: Timeline[]; reports: Report[]; loading: boolean; actionLoading: string; onAction: (type: "plan" | "submit" | "activate" | "pause" | "resume" | "cancel" | "archive") => void; onClose: () => void }) {
  const primaryAction = mission.status === "DRAFT" ? ["plan", "Create plan"] : mission.status === "PLANNING" ? ["submit", "Submit plan"] : mission.status === "AWAITING_APPROVAL" ? ["activate", "Approve & activate"] : mission.status === "ACTIVE" ? ["pause", "Pause mission"] : mission.status === "PAUSED" ? ["resume", "Resume mission"] : mission.status === "CANCELLED" ? ["archive", "Archive mission"] : null;
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="mission-drawer" role="dialog" aria-modal="true" aria-label="Mission details"><header><div><p className="eyebrow">MISSION RECORD</p><h2>{mission.title || "Untitled mission"}</h2></div><button onClick={onClose} aria-label="Close mission details">×</button></header><div className="drawer-scroll"><div className="mission-identity"><span className={statusClass(mission.status)}>{mission.status.replaceAll("_", " ")}</span><code>{mission.mission_id}</code><p>{mission.objective}</p></div><div className="detail-metrics"><div><strong>v{mission.version}</strong><small>Aggregate version</small></div><div><strong>{tasks.length}</strong><small>Work items</small></div><div><strong>{timelines.length}</strong><small>Timelines</small></div><div><strong>{reports.length}</strong><small>Evidence</small></div></div><section className="lifecycle-card"><div><p className="eyebrow">LIFECYCLE CONTROL</p><h3>Available operation</h3></div>{primaryAction ? <button className="primary-button" disabled={Boolean(actionLoading)} onClick={() => onAction(primaryAction[0] as "plan" | "submit" | "activate" | "pause" | "resume" | "archive")}>{actionLoading === primaryAction[0] ? "Working…" : primaryAction[1]}</button> : <span className="status neutral">No transition</span>}</section>{!["CANCELLED", "ARCHIVED"].includes(mission.status) && <button className="danger-action" disabled={Boolean(actionLoading)} onClick={() => onAction("cancel")}>Cancel mission</button>}<section className="history-section"><div className="panel-header"><div><p className="eyebrow">IMMUTABLE HISTORY</p><h3>Event timeline</h3></div><small>{history.length} events</small></div>{loading ? <LoadingRows /> : <div className="event-timeline">{[...history].reverse().map((event) => <article key={event.event_id}><i /><div><strong>{event.event_type.replace(/([A-Z])/g, " $1").trim()}</strong><p>Version {event.aggregate_version} · lifecycle {event.lifecycle_epoch}</p><small>{new Date(event.occurred_at).toLocaleString()}</small></div><code>{event.audit?.integrity_digest ? `${event.audit.integrity_digest.slice(0, 12)}…` : shortId(event.event_id)}</code></article>)}</div>}</section></div></aside></div>;
}

function CreateModal({ kind, missions, submitting, onClose, onSubmit }: { kind: CreateKind; missions: Mission[]; submitting: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const titles = { mission: ["Create a mission", "Define the objective and establish a durable operational record."], task: ["Add a work item", "Connect a clear assignment to an existing mission."], timeline: ["Create a timeline", "Set the operating timezone for a mission."], report: ["Capture evidence", "Create a versioned report linked to a mission."] } as const;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button><p className="eyebrow">NEW {kind.toUpperCase()}</p><h2 id="modal-title">{titles[kind][0]}</h2><p className="modal-intro">{titles[kind][1]}</p><form onSubmit={onSubmit}>{kind !== "mission" && <label>Mission<select name="mission_id" required autoFocus defaultValue=""><option value="" disabled>Select a mission</option>{missions.map((mission) => <option key={mission.mission_id} value={mission.mission_id}>{mission.title || mission.objective.slice(0, 56)}</option>)}</select></label>}{kind === "mission" && <><label>Mission title<input name="title" required autoFocus placeholder="e.g. Launch Tehran operations" maxLength={160} /></label><label>Objective<textarea name="objective" required placeholder="Describe the measurable outcome this mission must achieve…" rows={4} /></label></>}{kind === "task" && <><label>Task title<input name="title" required placeholder="e.g. Validate deployment readiness" /></label><label>Description<textarea name="description" required placeholder="What must be delivered?" rows={3} /></label><label>Priority<select name="priority" defaultValue="HIGH"><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label></>}{kind === "timeline" && <label>Timezone<select name="timezone" defaultValue="Asia/Tehran"><option>Asia/Tehran</option><option>UTC</option><option>Europe/London</option><option>America/New_York</option><option>Asia/Dubai</option></select></label>}{kind === "report" && <><label>Report title<input name="title" required placeholder="e.g. Weekly mission status" /></label><label>Report type<select name="report_type" defaultValue="MISSION_STATUS"><option value="MISSION_STATUS">Mission status</option><option value="RISK_REVIEW">Risk review</option><option value="OUTCOME_EVIDENCE">Outcome evidence</option><option value="EXECUTIVE_BRIEF">Executive brief</option></select></label></>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={submitting}>{submitting ? "Creating…" : `Create ${kind}`}</button></div></form></section></div>;
}
