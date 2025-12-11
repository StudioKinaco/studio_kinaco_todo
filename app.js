// ===== Supabase 初期化 =====
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
const supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== DOM 取得 =====
const openTaskModalBtn = document.getElementById("open-task-modal");
const taskModal = document.getElementById("task-modal");
const taskModalClose = document.getElementById("task-modal-close");

const projectInput = document.getElementById("project-input");
const taskInput = document.getElementById("task-input");
const startInput = document.getElementById("start-input");
const endInput = document.getElementById("end-input");
const todayBtn = document.getElementById("today-btn");
const addBtn = document.getElementById("add-btn");
const statusEl = document.getElementById("status");
const projectListEl = document.getElementById("project-list");

const ganttGrid = document.getElementById("gantt-grid");

// 削除確認モーダル
const confirmModal = document.getElementById("confirm-modal");
const confirmMessageEl = document.getElementById("confirm-message");
const confirmCancelBtn = document.getElementById("confirm-cancel");
const confirmOkBtn = document.getElementById("confirm-ok");

let allTasks = [];
let pendingDeleteTask = null;
let editingTask = null; // ← 編集対象のタスク

// ===== 色設定 =====
const PROJECT_COLORS = [
  "#1a73e8", "#34a853", "#f9ab00",
  "#ea4335", "#a142f4", "#00acc1",
  "#ff7043", "#8e24aa"
];
const projectColorMap = {};

function getProjectColor(name) {
  const key = name || "(no project)";
  if (!projectColorMap[key]) {
    const idx = Object.keys(projectColorMap).length % PROJECT_COLORS.length;
    projectColorMap[key] = PROJECT_COLORS[idx];
  }
  return projectColorMap[key];
}

// ===== 共通ユーティリティ =====
function setStatus(msg) {
  statusEl.textContent = msg || "";
}
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}
function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dateRange(start, end) {
  const out = [];
  const cur = new Date(start.getTime());
  while (cur <= end) {
    out.push(dateToISO(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// ===== モーダル制御（新規／編集） =====
function openTaskModalForNew() {
  editingTask = null;
  addBtn.textContent = "追加";
  setStatus("");
  // 初期値
  projectInput.value = projectInput.value || "";
  taskInput.value = "";
  if (!startInput.value) startInput.value = todayISO();
  if (!endInput.value) endInput.value = startInput.value || todayISO();

  taskModal.classList.remove("hidden");
  taskInput.focus();
}

function openTaskModalForEdit(task) {
  editingTask = task;
  addBtn.textContent = "更新";
  setStatus("");

  projectInput.value = task.project || "";
  taskInput.value = task.text || "";
  startInput.value = task.task_date || "";
  endInput.value = task.end_date || task.task_date || "";

  taskModal.classList.remove("hidden");
  taskInput.focus();
}

function closeTaskModal() {
  editingTask = null;
  addBtn.textContent = "追加";
  taskModal.classList.add("hidden");
}

function openConfirmModal(task) {
  pendingDeleteTask = task;
  confirmMessageEl.textContent = `「${task.text}」を完了してOK？`;
  confirmModal.classList.remove("hidden");
}
function closeConfirmModal() {
  pendingDeleteTask = null;
  confirmModal.classList.add("hidden");
}

// ===== プロジェクト名候補 =====
function populateProjectList(tasks) {
  const names = Array.from(
    new Set(
      tasks
        .map((t) => (t.project || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "ja"));
  projectListEl.innerHTML = "";
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    projectListEl.appendChild(opt);
  }
}

// ===== レーン割り当て =====
function assignLanesForProject(tasks) {
  const sorted = [...tasks].sort((a, b) => {
    const as = toDate(a.task_date);
    const bs = toDate(b.task_date);
    if (!as || !bs) return 0;
    return as - bs;
  });

  const laneLastEnd = [];
  let maxLaneIndex = -1;

  for (const t of sorted) {
    const start = toDate(t.task_date);
    const end = toDate(t.end_date || t.task_date);
    if (!start || !end) {
      t.__lane = 0;
      continue;
    }

    let laneIndex = -1;
    for (let i = 0; i < laneLastEnd.length; i++) {
      if (start > laneLastEnd[i]) {
        laneIndex = i;
        laneLastEnd[i] = end;
        break;
      }
    }
    if (laneIndex === -1) {
      laneIndex = laneLastEnd.length;
      laneLastEnd.push(end);
    }

    t.__lane = laneIndex;
    if (laneIndex > maxLaneIndex) maxLaneIndex = laneIndex;
  }

  return maxLaneIndex + 1;
}

// ===== データロード & レンダリング =====
async function loadTasks() {
  setStatus("読み込み中…");
  const { data, error } = await supa
    .from("tasks")
    .select("*")
    .order("task_date", { ascending: true })
    .order("created_at", { ascendi_
