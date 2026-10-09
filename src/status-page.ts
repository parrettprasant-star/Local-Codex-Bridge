export const STATUS_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="legacy-product" content="Local Codex Bridge compatibility">
  <title>Local Codex Bridge · status</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      color: #243247;
      background: #f3f5f7;
      line-height: 1.5;
      --border: #dce2e8;
      --muted: #718096;
      --accent: #2879a4;
      --surface: #ffffff;
      --waiting: #7a6b35;
      --running: #236f97;
      --confirm: #a45c15;
      --done: #28744c;
      --failed: #a44a3f;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; }
    button, input { font: inherit; }
    button { cursor: pointer; }
    .shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
    header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: clamp(25px, 4vw, 36px); letter-spacing: .01em; }
    h2 { margin: 0; font-size: 21px; overflow-wrap: anywhere; }
    h3 { margin: 0; font-size: 16px; }
    .subtitle { margin: 6px 0 0; color: var(--muted); }
    .connection { color: var(--done); font-size: 14px; white-space: nowrap; padding-top: 7px; }
    .connection.offline { color: var(--failed); }
    .overview { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; box-shadow: 0 2px 8px rgba(35, 48, 68, .035); }
    .overview-card { padding: 14px 15px; }
    .label { color: var(--muted); font-size: 13px; margin-bottom: 5px; }
    .value { font-size: 20px; font-weight: 650; overflow-wrap: anywhere; }
    .value.small { font-size: 16px; font-weight: 550; }
    .meta { color: var(--muted); font-size: 13px; margin-top: 7px; overflow-wrap: anywhere; }
    .section { margin-top: 14px; }
    .section-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
    .section-copy { min-width: 0; }
    .status-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 9px; border: 1px solid currentColor; font-size: 12px; font-weight: 650; white-space: nowrap; }
    .status-WAITING { color: var(--waiting); background: #f7f3e5; }
    .status-STARTING, .status-RUNNING, .status-RETRYING { color: var(--running); background: #edf7fb; }
    .status-NEED_CONFIRM { color: var(--confirm); background: #fff3e6; }
    .status-RECOVERY_REQUIRED, .status-BLOCKED { color: var(--failed); background: #fff0ee; }
    .status-PAUSED { color: var(--waiting); background: #f8f1e8; }
    .status-DONE, .status-COMPLETED { color: var(--done); background: #edf8f2; }
    .status-INTERRUPTED, .status-FAILED { color: var(--failed); background: #fff0ee; }
    .progress-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-top: 18px; }
    .percent { font-size: 28px; font-weight: 750; color: var(--accent); }
    .track { height: 12px; background: #e8edf1; border-radius: 999px; overflow: hidden; margin-top: 9px; }
    .bar { height: 100%; width: 0; background: var(--accent); border-radius: inherit; transition: width .25s ease; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .summary-item { border: 1px solid #e5e9ed; border-radius: 9px; padding: 12px; min-width: 0; }
    .attention { border: 1px solid #e3ad67; background: #fff8ee; color: #71460e; }
    .attention h3 { color: #8a5108; }
    .attention-list { display: grid; gap: 7px; margin-top: 10px; }
    .attention-item { padding: 9px 10px; background: rgba(255, 255, 255, .65); border-radius: 8px; }
    .task-list { display: grid; gap: 9px; margin-top: 12px; }
    .task-card { border: 1px solid #e2e7ec; border-radius: 9px; padding: 11px 12px; min-width: 0; }
    .task-card.active { border-color: #71a8c4; background: #f2f9fc; }
    .task-card.confirm { border-color: #e3ad67; background: #fff8ee; }
    .task-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .task-name { font-weight: 650; overflow-wrap: anywhere; }
    .task-meta { color: var(--muted); font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
    .task-action { margin-top: 6px; overflow-wrap: anywhere; }
    .empty { color: #8a95a3; font-size: 13px; padding: 8px 0; }
    .button-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .ui-button { border: 1px solid #9bb8c8; border-radius: 7px; background: #f3f9fc; color: #215c7c; padding: 5px 9px; }
    .ui-button:disabled { cursor: not-allowed; opacity: .55; }
    details { border: 1px solid #e2e7ec; border-radius: 9px; padding: 10px 12px; }
    details summary { cursor: pointer; color: var(--accent); font-weight: 650; }
    .details-body { margin-top: 10px; }
    .detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .detail-item { border: 1px solid #edf0f3; border-radius: 8px; padding: 9px 10px; min-width: 0; }
    .detail-value { overflow-wrap: anywhere; font-size: 13px; }
    .worker-summary { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 9px; }
    .worker-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .worker-card { border: 1px solid #e2e7ec; border-radius: 9px; padding: 11px; min-width: 0; }
    .worker-card.running { border-color: #71a8c4; background: #f2f9fc; }
    .worker-card.confirm { border-color: #e3ad67; background: #fff8ee; }
    .worker-title { font-weight: 650; }
    .worker-line { color: var(--muted); font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
    .logs { display: grid; gap: 7px; margin-top: 12px; }
    .log-row { display: grid; grid-template-columns: 84px minmax(130px, .8fr) 64px minmax(180px, 1.6fr); gap: 10px; align-items: start; padding: 9px 10px; border-left: 3px solid #c6dce7; background: #f8fafb; border-radius: 0 8px 8px 0; }
    .log-time { color: var(--muted); font-size: 12px; white-space: nowrap; padding-top: 3px; }
    .log-event { font-size: 13px; font-weight: 650; overflow-wrap: anywhere; padding-top: 2px; }
    .log-message { color: #536174; font-size: 13px; overflow-wrap: anywhere; padding-top: 2px; }
    .event-progress { color: var(--accent); font-size: 13px; font-weight: 700; padding-top: 2px; white-space: nowrap; }
    .change-list { display: grid; gap: 8px; margin-top: 12px; }
    footer { color: #8a95a3; font-size: 12px; margin-top: 18px; }
    @media (max-width: 900px) {
      .overview { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .summary-grid { grid-template-columns: 1fr; }
      .detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .worker-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .log-row { grid-template-columns: 76px 1fr auto; }
      .log-message { grid-column: 2 / -1; }
    }
    @media (max-width: 620px) {
      .shell { width: min(100% - 20px, 1120px); padding-top: 20px; }
      header { display: block; }
      .connection { margin-top: 8px; }
      .overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .detail-grid { grid-template-columns: 1fr; }
      .worker-grid { grid-template-columns: 1fr; }
      .section-head { display: block; }
      .log-row { grid-template-columns: 1fr auto; }
      .log-time, .log-event { grid-column: 1; }
      .log-row .event-progress { grid-column: 2; grid-row: 1 / span 2; text-align: right; }
      .log-message { grid-column: 1 / -1; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>Local Codex Bridge · status</h1>
        <p class="subtitle">任务状态 · 并发监控 · 结果交接</p>
      </div>
      <div id="connection" class="connection">正在连接…</div>
    </header>

    <section class="overview" aria-live="polite">
      <div class="card overview-card"><div class="label">Bridge</div><div id="bridgeStatus" class="value">—</div></div>
      <div class="card overview-card"><div class="label">Codex</div><div id="codexStatus" class="value">—</div></div>
      <div class="card overview-card"><div class="label">模型</div><div id="modelSummary" class="value small">—</div></div>
      <div class="card overview-card"><div class="label">当前状态</div><div id="overallStatus" class="value small">—</div></div>
      <div class="card overview-card"><div class="label">待确认</div><div id="confirmationCount" class="value">0</div></div>
      <div class="card overview-card"><div class="label">排队</div><div id="queueCount" class="value">0</div></div>
    </section>

    <section id="confirmationAlert" class="card attention section" style="display:none" aria-live="assertive">
      <h3>需要你的确认</h3>
      <div id="confirmationSummary" class="meta"></div>
      <div id="confirmationList" class="attention-list"></div>
    </section>

    <section class="card section">
      <div class="section-head">
        <div class="section-copy">
          <div class="label">当前任务</div>
          <h2 id="currentName">暂无任务</h2>
          <div id="currentKind" class="meta">空闲</div>
          <div id="currentMeta" class="meta">等待任务状态上报</div>
        </div>
        <div id="currentStatus"></div>
      </div>
      <div class="progress-row"><div class="label">完成进度</div><div id="progressPercent" class="percent">0%</div></div>
      <div id="progressTrack" class="track" role="progressbar" aria-label="任务进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="progressBar" class="bar"></div></div>
      <div class="summary-grid">
        <div class="summary-item"><div class="label">当前阶段</div><div id="currentStage" class="value small">—</div></div>
        <div class="summary-item"><div class="label">正在做什么</div><div id="currentAction" class="value small">—</div></div>
        <div class="summary-item"><div class="label">下一步</div><div id="nextAction" class="value small">—</div></div>
      </div>
      <div class="summary-grid">
        <div class="summary-item"><div class="label">任务来源</div><div id="executionSource" class="value small">—</div></div>
        <div class="summary-item"><div class="label">结果摘要</div><div id="resultSummary" class="value small">—</div></div>
        <div class="summary-item"><div class="label">输出</div><div id="outputSummary" class="value small">—</div></div>
      </div>
      <details id="currentTaskDetails" class="section">
        <summary>任务详情</summary>
        <div id="sessionDetailText" class="details-body meta">—</div>
        <div id="taskResultDetails" class="details-body meta">—</div>
        <div class="button-row"><button id="openOutputDirectory" class="ui-button" type="button" disabled>打开输出目录</button><button id="markReviewed" class="ui-button" type="button" disabled>标记已审核</button><button id="copySessionCommand" class="ui-button" type="button" disabled>复制恢复命令</button></div>
      </details>
    </section>

    <section class="card section">
      <div class="section-head"><div><h2>任务概览</h2><div class="meta">执行任务、原生任务和观察/读取请求分别统计；观察不会生成新的业务任务。</div></div></div>
      <div class="summary-grid">
        <div class="summary-item"><div class="label">Bridge 并发槽位</div><div id="bridgeSlots" class="value">0 / 5</div></div>
        <div class="summary-item"><div class="label">Codex 原生活跃</div><div id="nativeActivity" class="value">0</div></div>
        <div class="summary-item"><div class="label">等待任务</div><div id="waitingTasksCount" class="value">0</div></div>
      </div>
      <details id="slotDetails" class="section">
        <summary>查看槽位详情</summary>
        <div id="workerCards" class="worker-grid"><div class="empty">暂无槽位信息</div></div>
      </details>
    </section>

    <section class="card section">
      <div class="section-head"><div><h2>执行中任务</h2><div class="meta">只显示当前快照中的非终态任务。</div></div></div>
      <div id="runningTasks" class="task-list"><div class="empty">暂无执行中任务</div></div>
    </section>

    <section class="card section">
      <div class="section-head"><div><h2>等待任务</h2><div class="meta">等待 Bridge 调度槽位或后续执行。</div></div></div>
      <div id="waitingTasks" class="task-list"><div class="empty">暂无等待任务</div></div>
    </section>

    <section class="card section">
      <div class="section-head"><div><h2>最近完成</h2><div class="meta">默认显示最近 5 条。</div></div><button id="toggleHistory" class="ui-button" type="button">查看全部历史</button></div>
      <div id="historyTasks" class="task-list"><div class="empty">暂无最近完成任务</div></div>
    </section>

    <details id="technicalDetails" class="card section">
      <summary>技术详情</summary>
      <div class="detail-grid details-body">
        <div class="detail-item"><div class="label">Bridge 运行时</div><div id="bridgeRuntime" class="detail-value">—</div></div>
        <div class="detail-item"><div class="label">Codex 服务</div><div id="appServerHealth" class="detail-value">—</div></div>
        <div class="detail-item"><div class="label">MCP 端点</div><div id="mcpEndpoint" class="detail-value">—</div></div>
        <div class="detail-item"><div class="label">MCP 会话</div><div id="mcpBinding" class="detail-value">—</div></div>
        <div class="detail-item"><div class="label">模型策略</div><div id="guardHealth" class="detail-value">—</div></div>
        <div class="detail-item"><div class="label">执行模型</div><div id="requiredModel" class="detail-value">—</div></div>
        <div class="detail-item"><div class="label">推理强度</div><div id="requiredEffort" class="detail-value">—</div></div>
        <div class="detail-item"><div class="label">写入冲突</div><div id="writeConflicts" class="detail-value">0</div></div>
        <div class="detail-item"><div class="label">待恢复任务</div><div id="recoveryNeeded" class="detail-value">0</div></div>
        <div class="detail-item"><div class="label">观察请求（不计任务）</div><div id="observeRequests" class="detail-value">0</div></div>
        <div class="detail-item"><div class="label">Bridge 进程</div><div id="bridgePid" class="detail-value">—</div></div>
        <div class="detail-item"><div class="label">Codex 服务进程</div><div id="appServerPid" class="detail-value">—</div></div>
      </div>
      <div id="apiState" class="meta details-body">等待状态快照</div>
    </details>

    <details id="executionDetails" class="card section">
      <summary>执行详情与实时事件日志</summary>
      <div class="summary-grid details-body">
        <div class="summary-item"><div class="label">最近事件</div><div id="recentEvent" class="change-list"><div class="empty">暂无事件</div></div></div>
        <div class="summary-item"><div class="label">阶段变化</div><div id="stageChanges" class="change-list"><div class="empty">暂无阶段变化</div></div></div>
        <div class="summary-item"><div class="label">进度变化</div><div id="progressChanges" class="change-list"><div class="empty">暂无进度变化</div></div></div>
      </div>
      <div id="eventTimeline" class="logs details-body"><div class="empty">暂无事件</div></div>
    </details>

    <footer>页面每 2 秒读取一次本机状态 API；不会查询模型服务，不会把 observe/read 请求计为执行任务。</footer>
  </main>

  <script>
    const statusLabels = {
      IDLE: "空闲", WAITING: "等待中", STARTING: "启动中", RUNNING: "执行中", RETRYING: "重试中",
      BLOCKED: "已阻塞", RECOVERY_REQUIRED: "需要恢复", PAUSED: "已暂停", NEED_CONFIRM: "等待确认",
      DONE: "已完成", COMPLETED: "已完成", INTERRUPTED: "已中断", FAILED: "失败"
    };
    const sourceLabels = { bridge: "Bridge AGENTS · ephemeral", "external/native": "Codex 原生任务" };
    const reviewLabels = { NOT_READY: "未就绪", READY: "待审核", REVIEWED: "已审核", UNKNOWN: "未知", LEGACY: "历史任务" };
    const integrityLabels = { NOT_CHECKED: "未检查", PASS: "正常", WARN: "有提醒", FAILED: "异常", UNVERIFIED: "未验证", ERROR: "校验异常" };
    const bindingLabels = { ACTIVE_SESSION: "会话已连接", UNBOUND: "暂无会话", UNKNOWN: "未知" };
    const policyLabels = { active: "策略正常", blocked: "策略阻断", unavailable: "Luna 不可用", "manual-confirmation-required": "等待人工确认" };
    const eventLabels = {
      TASK_CREATED: "创建任务", TASK_STARTED: "开始执行", STAGE_CHANGED: "阶段变化", PROGRESS_UPDATED: "进度更新",
      WAITING_CONFIRM: "等待确认", FILE_FOUND: "发现文件", FILE_PROCESSED: "处理文件", ERROR: "执行错误",
      TASK_COMPLETED: "任务完成", "task.created": "创建任务", "task.started": "开始执行", "task.progressed": "进度更新",
      "task.needs_confirmation": "等待确认", "task.confirmed": "确认完成", "task.completed": "任务完成", "task.failed": "执行失败"
    };
    const activeStatuses = ["STARTING", "RUNNING", "RETRYING", "NEED_CONFIRM", "RECOVERY_REQUIRED", "PAUSED", "BLOCKED"];
    const waitingStatuses = ["WAITING"];
    const terminalStatuses = ["DONE", "COMPLETED", "FAILED", "INTERRUPTED"];
    let showAllHistory = false;

    const text = (id, value, fallback = "—") => {
      const element = document.getElementById(id);
      if (element) element.textContent = value === null || value === undefined || value === "" ? fallback : String(value);
    };
    const formatStatus = (status) => statusLabels[status] || String(status || "未知");
    const formatSource = (source) => sourceLabels[source] || "未知";
    const formatReview = (status) => reviewLabels[status] || String(status || "未知");
    const formatIntegrity = (status) => integrityLabels[status] || String(status || "未检查");
    const formatBinding = (binding) => bindingLabels[binding] || String(binding || "未知");
    const formatBridgeStatus = (status) => status === "running" ? "已连接" : status === "stopped" ? "已停止" : "异常";
    const formatCodexStatus = (status) => status === "running" ? "正常" : status === "stopped" || status === "exited" ? "已停止" : "不可用";
    const formatModel = (model, effort) => {
      const value = String(model || "").toLowerCase();
      if (value.includes("luna")) return "Luna " + (String(effort || "max").toLowerCase() === "max" ? "Max" : String(effort || "max"));
      return model || "未知";
    };
    const formatTime = (value, includeDate = false) => {
      if (!value) return "—";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString("zh-CN", includeDate
        ? { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }
        : { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };
    const statusBadge = (status) => {
      const badge = document.createElement("span");
      const normalized = statusLabels[status] ? status : "WAITING";
      badge.className = "status-badge status-" + normalized;
      badge.textContent = formatStatus(status);
      return badge;
    };
    const manifestFor = (task) => task && task.result_manifest ? task.result_manifest : {};
    const integrityFor = (task) => manifestFor(task).integrity || {};
    const outputFilesFor = (task) => Array.isArray(manifestFor(task).output_files) ? manifestFor(task).output_files : (task && Array.isArray(task.output_files) ? task.output_files : []);
    const outputDirectoriesFor = (task) => Array.isArray(manifestFor(task).output_directories) ? manifestFor(task).output_directories : (task && Array.isArray(task.output_directories) ? task.output_directories : []);
    const appendEmpty = (host, message) => {
      const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = message; host.append(empty);
    };
    const appendLine = (host, value) => {
      const line = document.createElement("div"); line.className = "worker-line"; line.textContent = String(value); host.append(line);
    };
    const localWrite = (url) => {
      const authorization = document.querySelector('meta[name="bridge-request-token"]');
      if (!authorization || !authorization.content) throw new Error("页面授权已失效，请重新加载状态页后再操作。");
      return fetch(url, { method: "POST", cache: "no-store", headers: { "X-Bridge-Request-Token": authorization.content } });
    };
    const openOutputDirectory = async (taskId) => {
      try {
        const response = await localWrite("/api/tasks/" + encodeURIComponent(taskId) + "/open-output-directory");
        const body = await response.json();
        if (!response.ok) throw new Error(body && body.error ? body.error : "输出目录不可用");
        text("apiState", "输出目录已打开");
      } catch (error) { text("apiState", String(error && error.message ? error.message : "输出目录不可用")); }
    };
    const markReviewed = async (taskId) => {
      try {
        const response = await localWrite("/api/tasks/" + encodeURIComponent(taskId) + "/review");
        const body = await response.json();
        if (!response.ok) throw new Error(body && body.error ? body.error : "审核状态更新失败");
        text("apiState", "任务已标记为已审核"); void refresh();
      } catch (error) { text("apiState", String(error && error.message ? error.message : "审核状态更新失败")); }
    };
    const copySessionCommand = async (command) => {
      if (!command) return;
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(command); text("apiState", "恢复命令已复制"); return; }
      } catch { }
      text("apiState", "恢复命令：" + command);
    };
    const taskMeta = (task) => [formatSource(task && task.execution_source), task && task.stage, Number.isInteger(task && task.progress) ? String(task.progress) + "%" : "—"].filter(Boolean).join(" · ");
    const taskCard = (task, mode) => {
      const card = document.createElement("div"); card.className = "task-card" + (task.status === "NEED_CONFIRM" ? " confirm" : mode === "active" ? " active" : "");
      const head = document.createElement("div"); head.className = "task-card-head";
      const name = document.createElement("div"); name.className = "task-name"; name.textContent = String(task.name || "未命名任务"); head.append(name, statusBadge(task.status)); card.append(head);
      const meta = document.createElement("div"); meta.className = "task-meta"; meta.textContent = taskMeta(task); card.append(meta);
      if (mode === "history") {
        const summary = document.createElement("div"); summary.className = "task-meta"; summary.textContent = formatTime(task.completed_at || task.updated_at, true) + " · " + formatSource(task.execution_source) + " · " + (manifestFor(task).result_summary || task.result_summary || "无结果摘要"); card.append(summary);
        if (String(task.final_answer || "").trim()) { const answer = document.createElement("div"); answer.className = "task-action"; answer.style.whiteSpace = "pre-wrap"; answer.textContent = String(task.final_answer); card.append(answer); }
      } else {
        const action = document.createElement("div"); action.className = "task-action"; action.textContent = (task.current_action || "—") + " · 下一步：" + (task.next_action || "—"); card.append(action);
      }
      return card;
    };
    const renderTaskList = (id, tasks, mode, currentId) => {
      const host = document.getElementById(id); if (!host) return; host.replaceChildren();
      let items = Array.isArray(tasks) ? tasks : [];
      if ((mode === "active" || mode === "waiting") && currentId) items = items.filter((task) => task.id !== currentId);
      if (items.length === 0) { appendEmpty(host, mode === "active" && currentId ? "当前任务已在上方展示" : mode === "history" ? "暂无已完成任务" : mode === "waiting" ? "暂无等待任务" : "暂无执行中任务"); return; }
      for (const task of items) host.append(taskCard(task, mode));
    };
    const renderCurrent = (task, kind, modelPolicy) => {
      const statusHost = document.getElementById("currentStatus"); if (statusHost) statusHost.replaceChildren();
      const outputButton = document.getElementById("openOutputDirectory"); const reviewButton = document.getElementById("markReviewed"); const copyButton = document.getElementById("copySessionCommand");
      if (!task) {
        text("currentName", "暂无任务"); text("currentKind", "空闲"); text("currentMeta", "等待任务状态上报"); text("currentStage", "—"); text("currentAction", "—"); text("nextAction", "—"); text("executionSource", "—"); text("resultSummary", "—"); text("outputSummary", "—"); text("sessionDetailText", "—"); text("taskResultDetails", "—");
        if (statusHost) statusHost.textContent = "空闲";
        if (outputButton) { outputButton.disabled = true; outputButton.onclick = null; } if (reviewButton) { reviewButton.disabled = true; reviewButton.onclick = null; } if (copyButton) { copyButton.disabled = true; copyButton.onclick = null; }
      } else {
        const manifest = manifestFor(task); const currentKindLabel = kind === "recent_completed" ? "最近完成" : kind === "waiting" ? "等待任务" : "执行中"; const sessionCommand = manifest.resume_command || (task.thread_id ? "codex resume " + task.thread_id : "");
        text("currentName", task.name, "暂无任务"); text("currentKind", currentKindLabel); text("currentMeta", taskMeta(task)); text("currentStage", task.stage); text("currentAction", task.current_action); text("nextAction", task.next_action); text("executionSource", formatSource(task.execution_source)); text("resultSummary", manifest.result_summary || task.result_summary || "—"); text("outputSummary", outputFilesFor(task).length + " 个文件 · " + outputDirectoriesFor(task).length + " 个目录");
        if (statusHost) statusHost.append(statusBadge(task.status));
        text("sessionDetailText", ["任务 ID：" + String(task.id || "—"), "线程 ID：" + String(task.thread_id || "—"), "回合 ID：" + String(task.turn_id || "—"), "槽位 ID：" + String(task.worker_id || "—"), "任务来源：" + formatSource(task.execution_source) + "（" + String(task.execution_source || "—") + "）", "工作目录：" + String(task.cwd || "—"), "执行状态：" + formatStatus(task.status) + "（" + String(task.status || "—") + "）", "模型策略：" + formatModel(modelPolicy && modelPolicy.policy_model, modelPolicy && modelPolicy.policy_effort), "审核状态：" + formatReview(manifest.review_status), "结果校验：" + formatIntegrity(integrityFor(task).status), "创建时间：" + formatTime(task.created_at, true), "开始时间：" + formatTime(task.started_at, true), "完成时间：" + formatTime(task.completed_at, true), "写入声明：" + (Array.isArray(task.write_claims) && task.write_claims.length > 0 ? task.write_claims.join("、") : "—"), "恢复命令：" + (sessionCommand || "—")].join(String.fromCharCode(10)));
        const integrity = integrityFor(task); const warnings = Array.from(new Set([...(Array.isArray(manifest.warnings) ? manifest.warnings : []), ...(Array.isArray(integrity.warnings) ? integrity.warnings : [])]));
        text("taskResultDetails", ["最终回答：" + String(task.final_answer || "—"), "结果摘要：" + String(manifest.result_summary || task.result_summary || "—"), "输出文件：" + (outputFilesFor(task).length > 0 ? outputFilesFor(task).join("、") : "—"), "输出目录：" + (outputDirectoriesFor(task).length > 0 ? outputDirectoriesFor(task).join("、") : "—"), "校验提醒：" + (warnings.length > 0 ? warnings.join(" · ") : "—")].join(String.fromCharCode(10)));
        if (outputButton) { outputButton.disabled = outputDirectoriesFor(task).length === 0; outputButton.onclick = outputDirectoriesFor(task).length === 0 ? null : () => void openOutputDirectory(task.id); }
        if (reviewButton) { reviewButton.disabled = manifest.review_status !== "READY"; reviewButton.onclick = manifest.review_status === "READY" ? () => void markReviewed(task.id) : null; }
        if (copyButton) { copyButton.disabled = !sessionCommand; copyButton.onclick = sessionCommand ? () => void copySessionCommand(sessionCommand) : null; }
      }
      const percent = task && Number.isInteger(task.progress) ? Math.max(0, Math.min(100, task.progress)) : 0; text("progressPercent", String(percent) + "%");
      const bar = document.getElementById("progressBar"); const track = document.getElementById("progressTrack"); if (bar) bar.style.width = String(percent) + "%"; if (track) track.setAttribute("aria-valuenow", String(percent));
    };
    const renderConfirmations = (tasks) => {
      const host = document.getElementById("confirmationAlert"); const list = document.getElementById("confirmationList"); if (!host || !list) return; list.replaceChildren();
      if (!Array.isArray(tasks) || tasks.length === 0) { host.style.display = "none"; text("confirmationSummary", ""); return; }
      host.style.display = "block"; text("confirmationSummary", "有 " + tasks.length + " 个任务等待审批或用户输入，请通过 codex_respond 处理。");
      for (const task of tasks) { const item = document.createElement("div"); item.className = "attention-item"; item.textContent = String(task.name || "未命名任务") + " · " + String(task.current_action || "等待确认") + " · 进度 " + String(task.progress || 0) + "%"; list.append(item); }
    };
    const renderWorkers = (workers, tasksById, nativeActive) => {
      const slots = Array.isArray(workers && workers.slots) ? workers.slots : []; const running = Number(workers && (workers.bridge_running ?? workers.running)) || 0; const max = Number(workers && workers.max) || 5;
      text("bridgeSlots", running + " / " + max); text("nativeActivity", Number((workers && workers.native_active) ?? nativeActive) || 0);
      const host = document.getElementById("workerCards"); if (!host) return; host.replaceChildren(); const activeSlots = slots.filter((slot) => slot && slot.status !== "IDLE");
      if (activeSlots.length === 0) { appendEmpty(host, "当前没有 Bridge 调度槽位在执行；空闲槽位已压缩显示。"); return; }
      for (const slot of activeSlots) {
        const card = document.createElement("div"); card.className = "worker-card" + (slot.status === "NEED_CONFIRM" ? " confirm" : " running"); const title = document.createElement("div"); title.className = "worker-title"; title.textContent = String(slot.worker_id || "槽位"); card.append(title, statusBadge(slot.status)); const task = slot.task_id ? tasksById.get(slot.task_id) : null;
        appendLine(card, "任务：" + (task ? String(task.name || "未命名任务") : String(slot.task_id || "—"))); appendLine(card, "进度：" + (task && Number.isInteger(task.progress) ? String(task.progress) + "%" : "—")); appendLine(card, "阶段：" + String(task && task.stage || slot.phase || "—"));
        const details = document.createElement("details"); details.className = "section"; const summary = document.createElement("summary"); summary.textContent = "槽位详情"; details.append(summary); const body = document.createElement("div"); body.className = "details-body";
        ["任务 ID：" + String(slot.task_id || "—"), "线程 ID：" + String(slot.thread_id || "—"), "回合 ID：" + String(slot.turn_id || "—"), "运行时：" + String(slot.runtime || "—"), "策略：" + String(slot.policy_model || "—") + " / " + String(slot.policy_effort || "—"), "请求：" + String(slot.requested_model || "—") + " / " + String(slot.requested_effort || "—"), "观察：" + String(slot.observed_model || "—") + " / " + String(slot.observed_effort || "—"), "写入声明：" + String(slot.write_claim || "—"), "最近事件：" + String(slot.last_event || "—"), "重试：" + String(slot.retry_count || 0), "错误：" + String(slot.error || "—")].forEach((line) => appendLine(body, line)); details.append(body); card.append(details); host.append(card);
      }
      if (activeSlots.length < max) appendEmpty(host, "其余 " + (max - activeSlots.length) + " 个槽位空闲。");
    };
    const taskNameForEvent = (event, tasksById) => { const task = tasksById.get(event.task_id); return task ? String(task.name || "未命名任务") : String(event.task_id || "未知任务"); };
    const renderRecentEvent = (event, tasksById) => { const host = document.getElementById("recentEvent"); if (!host) return; host.replaceChildren(); if (!event) { appendEmpty(host, "暂无事件"); return; } appendLine(host, (eventLabels[event.type] || "任务事件") + " · " + taskNameForEvent(event, tasksById)); appendLine(host, formatTime(event.timestamp, true) + " · " + String(event.message || event.stage || "—")); };
    const renderChanges = (id, events, kind, currentId) => {
      const host = document.getElementById(id); if (!host) return; host.replaceChildren(); const selected = (Array.isArray(events) ? events : []).filter((event) => !currentId || event.task_id === currentId); const changes = []; let previous;
      for (const event of selected) { const value = kind === "stage" ? String(event.stage || "") : Number.isInteger(event.progress) ? event.progress : null; if (value === "" || value === null || value === previous) continue; previous = value; changes.push(event); }
      const recent = changes.slice(-6).reverse(); if (recent.length === 0) { appendEmpty(host, kind === "stage" ? "暂无阶段变化" : "暂无进度变化"); return; }
      for (const event of recent) appendLine(host, (kind === "stage" ? String(event.stage || "—") : String(event.progress) + "%") + " · " + String(event.message || "—"));
    };
    const renderEvents = (events, tasksById) => {
      const list = document.getElementById("eventTimeline"); if (!list) return; list.replaceChildren(); const recent = Array.isArray(events) ? events.slice(-40).reverse() : [];
      if (recent.length === 0) { appendEmpty(list, "暂无事件"); return; }
      for (const event of recent) { const row = document.createElement("div"); row.className = "log-row"; const time = document.createElement("div"); time.className = "log-time"; time.textContent = formatTime(event.timestamp); const name = document.createElement("div"); name.className = "log-event"; name.textContent = eventLabels[event.type] || String(event.type || "任务事件"); const progress = document.createElement("div"); progress.className = "event-progress"; progress.textContent = String(Number.isInteger(event.progress) ? event.progress : 0) + "%"; const message = document.createElement("div"); message.className = "log-message"; message.textContent = taskNameForEvent(event, tasksById) + " · " + String(event.stage || "—") + " · " + String(event.message || "—"); row.append(time, name, progress, message); list.append(row); }
    };
    const renderTechnical = (data) => {
      const model = data.modelPolicy || {}; const appServer = data.appServer; const mcp = data.mcp || {};
      text("bridgeRuntime", String(data.bridge && data.bridge.status || "unknown") + " · " + String(data.bridge && data.bridge.runtime || "local-codex-bridge")); text("appServerHealth", appServer && appServer.status ? String(appServer.status.process_state || "unknown") + " · " + String(appServer.status.transport || "—") : "不可用"); text("mcpEndpoint", mcp.endpoint || "stdio"); text("mcpBinding", formatBinding(mcp.binding) + "（" + String(mcp.binding || "UNKNOWN") + "）"); text("guardHealth", (policyLabels[model.model_policy_status] || model.model_policy_status || "未知") + "（" + String(model.guard_status || "UNKNOWN") + "）"); text("requiredModel", String(model.policy_model || "未知")); text("requiredEffort", String(model.policy_effort || "max")); text("writeConflicts", Array.isArray(data.writeClaims) ? data.writeClaims.length : 0); text("recoveryNeeded", data.tasks && data.tasks.counts ? data.tasks.counts.RECOVERY_REQUIRED || 0 : 0); text("observeRequests", data.activities ? data.activities.observe_requests || 0 : (mcp.active_requests || 0)); text("bridgePid", data.bridge && data.bridge.pid || "—"); text("appServerPid", appServer && appServer.status && appServer.status.app_server_pid || "—"); text("apiState", data._source === "primary" ? "normalized status · 主接口" : "normalized status · 兼容回退");
    };
    const deriveDashboardFallback = (tasks) => {
      const items = Array.isArray(tasks) ? tasks : []; const active = items.filter((task) => activeStatuses.includes(task.status)); const waiting = items.filter((task) => waitingStatuses.includes(task.status)); const history = items.filter((task) => terminalStatuses.includes(task.status)); const confirmations = active.filter((task) => task.status === "NEED_CONFIRM"); const priority = ["NEED_CONFIRM", "RUNNING", "RECOVERY_REQUIRED", "STARTING", "RETRYING", "BLOCKED", "PAUSED", "WAITING"]; const current = active.concat(waiting).sort((left, right) => priority.indexOf(left.status) - priority.indexOf(right.status))[0] || history[0] || null;
      return { current, current_kind: current ? (active.includes(current) ? "active" : waiting.includes(current) ? "waiting" : "recent_completed") : "idle", active, waiting, recent_completed: history.slice(0, 5), history, pending_confirmations: confirmations };
    };
    const normalizeCompatibility = (legacy, events) => {
      if (!legacy || !Array.isArray(legacy.tasks)) throw new Error("API incompatible: missing tasks"); const modelGuard = legacy.model_guard || {}; const groups = deriveDashboardFallback(legacy.tasks);
      return { _source: "compatibility", bridge: { status: legacy.bridge_status || "unknown" }, appServer: null, modelPolicy: modelGuard, workers: { running: 0, bridge_running: 0, native_active: groups.active.filter((task) => task.execution_source === "external/native").length, max: 5, slots: [] }, queue: { depth: groups.waiting.length, waiting_task_ids: [], waiting_count: groups.waiting.length, retrying: 0, blocked: 0 }, tasks: { items: legacy.tasks, current: groups.current, current_kind: groups.current_kind, active: groups.active, waiting: groups.waiting, recent_completed: groups.recent_completed, history: groups.history, pending_confirmations: groups.pending_confirmations, counts: {} }, dashboard: { current_kind: groups.current_kind, current_task_id: groups.current && groups.current.id || null, active_count: groups.active.length, waiting_count: groups.waiting.length, pending_confirmation_count: groups.pending_confirmations.length, recent_completed_count: groups.recent_completed.length }, activities: { bridge_scheduler: 0, native_codex: groups.active.filter((task) => task.execution_source === "external/native").length, observe_requests: 0 }, events: Array.isArray(events) ? events : [], writeClaims: [], mcp: { endpoint: "stdio", binding: "UNKNOWN", chatgpt_conversation_binding: "UNKNOWN" } };
    };
    const fetchJson = async (url) => { const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error(url + " returned HTTP " + response.status); return await response.json(); };
    const loadSnapshot = async () => {
      try { const primary = await fetchJson("/api/status"); if (!primary || !primary.bridge || !primary.workers || !primary.tasks || !primary.modelPolicy) throw new Error("API incompatible: normalized status fields missing"); return { ...primary, _source: "primary" }; }
      catch (primaryError) { try { const pair = await Promise.all([fetchJson("/api/tasks"), fetchJson("/api/task-events?limit=100")]); return normalizeCompatibility(pair[0], pair[1].events); } catch (compatibilityError) { throw new Error("Bridge unavailable: primary and compatibility APIs failed (" + String(primaryError.message || primaryError) + "; " + String(compatibilityError.message || compatibilityError) + ")"); } }
    };
    const renderHistory = (data, current) => { const dashboard = data.tasks || {}; let tasks = showAllHistory ? (dashboard.history || []) : (dashboard.recent_completed || []); if (current) tasks = tasks.filter((task) => task.id !== current.id); renderTaskList("historyTasks", tasks, "history", null); const button = document.getElementById("toggleHistory"); if (button) button.textContent = showAllHistory ? "只看最近 5 条" : "查看全部历史"; };
    const render = (data) => {
      const tasks = Array.isArray(data.tasks && data.tasks.items) ? data.tasks.items : []; const dashboard = data.tasks && data.tasks.active ? data.tasks : deriveDashboardFallback(tasks); const tasksById = new Map(tasks.map((task) => [task.id, task])); const model = data.modelPolicy || {}; const appServer = data.appServer; const current = dashboard.current || null; const currentKind = dashboard.current_kind || "idle";
      text("bridgeStatus", formatBridgeStatus(data.bridge && data.bridge.status)); text("codexStatus", formatCodexStatus(appServer && appServer.status && appServer.status.process_state)); text("modelSummary", formatModel(model.observed_model || model.policy_model, model.observed_effort || model.policy_effort)); text("overallStatus", currentKind === "active" ? formatStatus(current && current.status) : currentKind === "waiting" ? "等待任务" : currentKind === "recent_completed" ? "最近完成" : "空闲"); text("confirmationCount", Array.isArray(dashboard.pending_confirmations) ? dashboard.pending_confirmations.length : 0); text("queueCount", data.queue && data.queue.depth || 0); text("waitingTasksCount", Array.isArray(dashboard.waiting) ? dashboard.waiting.length : 0);
      renderConfirmations(dashboard.pending_confirmations || []); renderCurrent(current, currentKind, model); renderTaskList("runningTasks", dashboard.active || [], "active", current && currentKind === "active" ? current.id : null); renderTaskList("waitingTasks", dashboard.waiting || [], "waiting", current && currentKind === "waiting" ? current.id : null); renderHistory(data, current && currentKind === "recent_completed" ? current : null); renderWorkers(data.workers || {}, tasksById, data.activities && data.activities.native_codex || data.dashboard && data.dashboard.native_active_count || 0); renderTechnical(data); renderRecentEvent((data.events || []).at(-1) || null, tasksById); renderChanges("stageChanges", data.events || [], "stage", current && current.id); renderChanges("progressChanges", data.events || [], "progress", current && current.id); renderEvents(data.events || [], tasksById);
    };
    const refresh = async () => { const connection = document.getElementById("connection"); try { const data = await loadSnapshot(); render(data); if (connection) { connection.textContent = "本机接口已连接"; connection.classList.remove("offline"); } } catch (error) { if (connection) { connection.textContent = String(error && error.message ? error.message : "Bridge 不可用"); connection.classList.add("offline"); } } };
    const historyButton = document.getElementById("toggleHistory"); if (historyButton) historyButton.onclick = () => { showAllHistory = !showAllHistory; void refresh(); };
    void refresh(); setInterval(() => void refresh(), 2000);
  </script>
</body>
</html>
`;
