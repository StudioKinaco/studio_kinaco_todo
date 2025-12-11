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
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    setStatus("読み込みエラー");
    return;
  }
  allTasks = data || [];
  render(allTasks);
  setStatus("");
}

function render(tasks) {
  ganttGrid.innerHTML = "";
  populateProjectList(tasks);

  const valid = tasks.filter((t) => t.task_date);
  if (!valid.length) {
    const div = document.createElement("div");
    div.className = "empty-msg";
    div.textContent = "まだタスクがありません。「＋ 新しいタスク」から追加してね。";
    ganttGrid.appendChild(div);
    return;
  }

  const projectGroups = {};
  for (const t of valid) {
    const name = (t.project || "(no project)").trim();
    if (!projectGroups[name]) projectGroups[name] = [];
    projectGroups[name].push(t);
  }
  const projectNames = Object.keys(projectGroups).sort((a, b) =>
    a.localeCompare(b, "ja")
  );

  const projectMeta = {};
  let totalDataCols = 0;

  for (const name of projectNames) {
    const tasksForProject = projectGroups[name];
    const laneCount = assignLanesForProject(tasksForProject);
    const startCol = 2 + totalDataCols;
    projectMeta[name] = { startCol, laneCount };
    totalDataCols += laneCount;
    getProjectColor(name);
  }

  let minStart = null;
  let maxEnd = null;
  for (const t of valid) {
    const s = toDate(t.task_date);
    const e = toDate(t.end_date || t.task_date);
    if (!s || !e) continue;
    if (!minStart || s < minStart) minStart = s;
    if (!maxEnd || e > maxEnd) maxEnd = e;
  }
  if (!minStart || !maxEnd) {
    const div = document.createElement("div");
    div.className = "empty-msg";
    div.textContent = "日付の入ったタスクがありません。";
    ganttGrid.appendChild(div);
    return;
  }

  const todayDate = toDate(todayISO());
  const todayIso = dateToISO(todayDate);

  let start = minStart;
  if (todayDate >= minStart && todayDate <= maxEnd) start = todayDate;

  const days = dateRange(start, maxEnd);

  ganttGrid.style.gridTemplateColumns =
    `120px repeat(${totalDataCols}, minmax(110px, 1fr))`;
  // 1 日の行高さを 2.5 倍くらいに（32px -> 80px）
  ganttGrid.style.gridTemplateRows =
    `40px repeat(${days.length}, 80px)`;

  const dateHeader = document.createElement("div");
  dateHeader.className = "gantt-header-cell date-header";
  dateHeader.textContent = "Date";
  dateHeader.style.gridColumn = "1 / 2";
  dateHeader.style.gridRow = "1 / 2";
  ganttGrid.appendChild(dateHeader);

  for (const name of projectNames) {
    const meta = projectMeta[name];
    const cell = document.createElement("div");
    cell.className = "gantt-header-cell";
    cell.textContent = name;
    cell.style.gridColumn = `${meta.startCol} / ${meta.startCol + meta.laneCount}`;
    cell.style.gridRow = "1 / 2";
    ganttGrid.appendChild(cell);
  }

  // 日付ラベル列（今日ハイライト）
  days.forEach((dayStr, i) => {
    const cell = document.createElement("div");
    cell.className = "gantt-day-cell";
    cell.textContent = dayStr;
    cell.style.gridColumn = "1 / 2";
    cell.style.gridRow = i + 2 + " / " + (i + 3);

    if (dayStr === todayIso) {
      cell.classList.add("today-row");
    }

    ganttGrid.appendChild(cell);
  });

  // 背景スロット（今日ハイライト）
  days.forEach((dayStr, i) => {
    const isToday = dayStr === todayIso;

    for (const name of projectNames) {
      const meta = projectMeta[name];
      for (let lane = 0; lane < meta.laneCount; lane++) {
        const col = meta.startCol + lane;
        const slot = document.createElement("div");
        slot.className = "gantt-slot";
        slot.style.gridColumn = `${col} / ${col + 1}`;
        slot.style.gridRow = i + 2 + " / " + (i + 3);

        if (isToday) {
          slot.classList.add("today-row");
        }

        ganttGrid.appendChild(slot);
      }
    }
  });

  // タスクバー
  for (const task of valid) {
    const projectName = (task.project || "(no project)").trim();
    const meta = projectMeta[projectName];
    if (!meta) continue;

    const laneIndex = task.__lane || 0;
    const column = meta.startCol + laneIndex;

    const s = toDate(task.task_date);
    const e = toDate(task.end_date || task.task_date);
    if (!s || !e) continue;
    if (e < toDate(days[0]) || s > toDate(days[days.length - 1])) continue;

    let startIdx = days.findIndex((d) => toDate(d) >= s);
    if (startIdx === -1) startIdx = 0;
    let endIdx = days.length - 1;
    for (let i = days.length - 1; i >= 0; i--) {
      if (toDate(days[i]) <= e) {
        endIdx = i;
        break;
      }
    }

    const pill = document.createElement("div");
    pill.className = "task-pill";
    pill.style.background = getProjectColor(projectName);
    pill.style.gridColumn = `${column} / ${column + 1}`;
    pill.style.gridRow = startIdx + 2 + " / " + (endIdx + 3);
    pill.style.zIndex = 5;

    // カードクリックで編集モード
    pill.addEventListener("click", () => openTaskModalForEdit(task));

    // 締切までの日数バッジ
    const badge = document.createElement("div");
    badge.className = "task-deadline-badge";
    const diffMs = e - todayDate;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      badge.textContent = "期限切れ";
      badge.classList.add("overdue");
    } else {
      badge.textContent = `あと${diffDays}日`;
      if (diffDays <= 3) badge.classList.add("urgent");
    }
    pill.appendChild(badge);

    // タスク名（text）
    const textDiv = document.createElement("div");
    textDiv.className = "task-text";
    textDiv.textContent = task.text;
    pill.appendChild(textDiv);

    // 期間
    const range = document.createElement("div");
    range.className = "task-range";
    range.textContent = `${task.task_date} 〜 ${task.end_date || task.task_date}`;
    pill.appendChild(range);

    // 完了ボタン（右下・丸ボタン＋チェックSVG）
    const doneBtn = document.createElement("button");
    doneBtn.className = "task-done-btn";
    doneBtn.innerHTML = `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M5 12l5 5l10 -10" />
      </svg>
    `;
    doneBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // カードの編集クリックを無効化
      openConfirmModal(task);
    });
    pill.appendChild(doneBtn);

    ganttGrid.appendChild(pill);
  }
}

// ===== タスク追加／更新 =====
async function submitTask() {
  const text = taskInput.value.trim();
  if (!text) return;

  let start = startInput.value;
  let end = endInput.value;
  const project = projectInput.value.trim() || null;

  if (!start && !end) start = todayISO();
  if (!start && end) start = end;
  if (!end) end = start;

  setStatus(editingTask ? "更新中…" : "追加中…");
  addBtn.disabled = true;

  let error;
  if (!editingTask) {
    ({ error } = await supa.from("tasks").insert({
      project,
      task_date: start,
      end_date: end,
      text,
      done: false,
    }));
  } else {
    ({ error } = await supa
      .from("tasks")
      .update({
        project,
        task_date: start,
        end_date: end,
        text,
      })
      .eq("id", editingTask.id));
  }

  addBtn.disabled = false;
  if (error) {
    console.error(error);
    setStatus(editingTask ? "更新エラー" : "追加エラー");
    return;
  }

  if (!editingTask) {
    taskInput.value = "";
  }

  setStatus("");
  closeTaskModal();
  await loadTasks();
}

// ===== タスク削除 =====
async function completeTask(task) {
  setStatus("削除中…");
  const { error } = await supa.from("tasks").delete().eq("id", task.id);

  if (error) {
    console.error(error);
    setStatus("削除エラー");
    return;
  }
  setStatus("");
  await loadTasks();
}

// ===== イベントバインド =====
openTaskModalBtn.addEventListener("click", () => {
  openTaskModalForNew();
});

taskModalClose.addEventListener("click", closeTaskModal);
taskModal.addEventListener("click", (e) => {
  if (e.target === taskModal) closeTaskModal();
});

todayBtn.addEventListener("click", () => {
  const t = todayISO();
  startInput.value = t;
  if (!endInput.value) endInput.value = t;
});

addBtn.addEventListener("click", submitTask);
taskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitTask();
  }
});

// 削除確認モーダル
confirmCancelBtn.addEventListener("click", closeConfirmModal);
confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) closeConfirmModal();
});
confirmOkBtn.addEventListener("click", async () => {
  if (pendingDeleteTask) {
    const t = pendingDeleteTask;
    closeConfirmModal();
    await completeTask(t);
  }
});

// 初期化
startInput.value = todayISO();
endInput.value = todayISO();
loadTasks();
