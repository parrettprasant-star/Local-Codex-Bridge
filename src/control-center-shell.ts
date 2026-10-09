export const APP_SHELL_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local Codex Bridge</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101113;
      --sidebar: #141619;
      --panel: #17191d;
      --panel-soft: #1d2025;
      --panel-raised: #23272e;
      --line: #2d323b;
      --line-soft: rgba(45,50,59,.62);
      --text: #f2f4f6;
      --soft: #c8ced6;
      --muted: #929aa6;
      --accent: #9ae6b4;
      --action: #7dd3fc;
      --warning: #f6c76b;
      --danger: #fb8b8b;
      --content-max: 1320px;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; background: var(--bg); color: var(--text); }
    body { min-width: 900px; overflow: hidden; font-size: 15px; }
    button, input, textarea { font: inherit; }
    button { cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .48; }
    .app-shell { height: 100vh; display: grid; grid-template-columns: 232px minmax(0, 1fr); }
    .sidebar { min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--line); background: var(--sidebar); padding: 22px 14px 14px; }
    .brand { display: flex; align-items: center; gap: 10px; padding: 0 8px 28px; }
    .brand-mark { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 10px; background: linear-gradient(135deg,#a7f3d0,#60a5fa); color: #0e1217; font-weight: 800; letter-spacing: -.1em; }
    .brand-name { font-size: 16px; font-weight: 700; letter-spacing: -.02em; }
    .brand-subtitle { margin-top: 3px; color: var(--muted); font-size: 11px; }
    .nav { display: grid; gap: 5px; }
    .nav-item { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--soft); padding: 11px 11px; text-align: left; }
    .nav-item:hover { border-color: var(--line); background: rgba(255,255,255,.025); color: var(--text); }
    .nav-item.active { border-color: #3b5960; background: #1d2529; color: var(--text); }
    .nav-hint { color: var(--muted); font-size: 11px; }
    .nav-item.active .nav-hint { color: var(--accent); }
    .sidebar-note { margin-top: auto; border-top: 1px solid var(--line); padding: 14px 8px 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
    .main { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: radial-gradient(circle at 55% -12%,rgba(125,211,252,.055),transparent 34%),var(--bg); }
    .topbar { min-height: 78px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--line); padding: 14px clamp(18px,3vw,34px); }
    .topbar-heading { min-width: 0; }
    .eyebrow { color: var(--muted); font-size: 10px; letter-spacing: .16em; }
    h1 { margin: 4px 0 0; font-size: 20px; font-weight: 650; letter-spacing: -.035em; }
    .topbar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap; }
    .status-strip { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .status-pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.02); color: var(--soft); padding: 7px 9px; font-size: 11px; white-space: nowrap; }
    .status-pill:hover { border-color: #4d5664; color: var(--text); }
    .status-pill::before, .status-dot { content: ""; width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--muted); }
    .status-pill.ok::before, .status-dot.ok { background: var(--accent); }
    .status-pill.warn::before, .status-dot.warn { background: var(--warning); }
    .status-pill.bad::before, .status-dot.bad { background: var(--danger); }
    .status-value { color: var(--muted); }
    .toolbar-button, .secondary-button, .primary-button, .text-button { border: 1px solid var(--line); border-radius: 8px; background: var(--panel-soft); color: var(--soft); padding: 8px 11px; }
    .toolbar-button:hover, .secondary-button:hover, .text-button:hover { border-color: #566170; color: var(--text); }
    .primary-button { border-color: #527361; background: #638d73; color: #0d1511; font-weight: 700; }
    .primary-button:hover { background: #7aa98b; }
    .content-scroll { min-height: 0; flex: 1; overflow: auto; padding: 26px clamp(20px,4vw,70px) 44px; }
    .page { display: none; max-width: var(--content-max); margin: 0 auto; }
    .page.active { display: block; }
    .page-lead { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
    .page-lead h2 { margin: 0; font-size: 24px; letter-spacing: -.035em; }
    .page-lead p { margin: 6px 0 0; max-width: 680px; color: var(--muted); line-height: 1.55; }
    .page-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .surface { border: 1px solid var(--line); border-radius: 12px; background: rgba(23,25,29,.86); }
    .surface + .surface { margin-top: 16px; }
    .surface-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line-soft); padding: 15px 18px; }
    .surface-title { font-size: 14px; font-weight: 650; }
    .surface-caption { color: var(--muted); font-size: 12px; }
    .surface-body { padding: 18px; }
    .status-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 10px; }
    .status-card { min-width: 0; border: 1px solid var(--line-soft); border-radius: 10px; background: rgba(255,255,255,.015); padding: 13px 14px; text-align: left; }
    .status-card:hover { border-color: #4d5664; }
    .status-card-label { color: var(--muted); font-size: 11px; }
    .status-card-value { display: flex; align-items: center; gap: 7px; margin-top: 8px; font-size: 15px; }
    .status-card-note { margin-top: 5px; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .overview-grid { display: grid; grid-template-columns: minmax(0,1.45fr) minmax(270px,.55fr); gap: 16px; margin-top: 16px; }
    .metric-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; }
    .metric { min-width: 0; border: 1px solid var(--line-soft); border-radius: 9px; padding: 13px; }
    .metric-label { color: var(--muted); font-size: 11px; }
    .metric-value { margin-top: 6px; font-size: 20px; letter-spacing: -.03em; }
    .metric-note { margin-top: 3px; color: var(--muted); font-size: 11px; }
    .empty-state { border: 1px dashed #39404a; border-radius: 9px; color: var(--muted); padding: 24px 16px; text-align: center; line-height: 1.6; }
    .empty-state strong { display: block; color: var(--soft); font-weight: 600; }
    .item-list { display: grid; gap: 8px; }
    .list-row { width: 100%; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; border: 1px solid transparent; border-radius: 9px; background: rgba(255,255,255,.018); color: var(--text); padding: 12px 13px; text-align: left; }
    .list-row:hover, .list-row.selected { border-color: #43545a; background: #1b2428; }
    .row-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .native-full-row .row-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; }
    .row-meta { display: flex; gap: 9px; flex-wrap: wrap; margin-top: 5px; color: var(--muted); font-size: 11px; }
    .row-right { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; white-space: nowrap; }
    .badge { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 999px; padding: 4px 7px; color: var(--soft); font-size: 11px; }
    .badge.ok { color: var(--accent); border-color: #35584a; }
    .badge.warn { color: var(--warning); border-color: #614f2e; }
    .badge.bad { color: var(--danger); border-color: #633b42; }
    .task-row { border: 1px solid var(--line-soft); border-radius: 10px; padding: 14px; }
    .task-row-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .task-kind { margin-top: 5px; color: var(--muted); font-size: 11px; }
    .task-progress-panel { margin-top: 14px; border-top: 1px solid var(--line-soft); padding-top: 13px; }
    .task-progress-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .task-progress-stage { color: var(--soft); font-size: 13px; font-weight: 600; }
    .task-progress-percent { color: var(--action); font-size: 12px; white-space: nowrap; }
    .task-progress-track { height: 6px; margin-top: 9px; overflow: hidden; border-radius: 999px; background: #292f36; }
    .task-progress-track.recovery { display: none; }
    .task-progress-fill { height: 100%; border-radius: inherit; background: var(--action); }
    .task-progress-track.indeterminate .task-progress-fill { width: 38%; background: var(--accent); }
    .task-progress-category { margin-top: 9px; color: var(--muted); font-size: 11px; }
    .task-progress-steps { display: grid; gap: 6px; margin: 12px 0 0; padding: 0; list-style: none; }
    .task-progress-step { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 11px; }
    .task-progress-step .step-marker { width: 14px; color: var(--muted); text-align: center; }
    .task-progress-step.completed { color: var(--soft); }
    .task-progress-step.completed .step-marker { color: var(--accent); }
    .task-progress-step.current { color: var(--text); }
    .task-progress-step.current .step-marker { color: var(--action); }
    .task-progress-step.failed { color: var(--danger); }
    .task-progress-step.failed .step-marker { color: var(--danger); }
    .task-progress-next { margin-top: 11px; color: var(--muted); font-size: 11px; }
    .task-outcome, .task-failure { margin-top: 12px; border: 1px solid var(--line-soft); border-radius: 8px; padding: 10px 11px; }
    .task-outcome { background: rgba(154,230,180,.035); }
    .task-failure { border-color: rgba(251,139,139,.35); background: rgba(251,139,139,.035); }
    .task-outcome-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
    .task-output-location { margin-top: 4px; color: var(--soft); font-size: 12px; overflow-wrap: anywhere; }
    .task-detail { display: grid; grid-template-columns: minmax(130px,.55fr) minmax(0,1.45fr); gap: 13px; margin-top: 13px; }
    .detail-label { color: var(--muted); font-size: 11px; }
    .detail-value { margin-top: 4px; color: var(--soft); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .task-actions { display: flex; gap: 7px; margin-top: 13px; }
    details.execution-details { margin-top: 13px; border-top: 1px solid var(--line-soft); padding-top: 10px; }
    details.execution-details > summary { cursor: pointer; color: var(--action); font-size: 12px; }
    .timeline-list { display: grid; gap: 7px; margin-top: 10px; }
    .timeline-entry { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .native-layout { display: grid; min-height: 0; grid-template-columns: minmax(0,1.1fr) minmax(310px,.9fr); gap: 16px; align-items: stretch; }
    .search-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .search-input, .field-input, .composer-textarea { width: 100%; border: 1px solid var(--line); border-radius: 8px; background: #15171b; color: var(--text); outline: none; }
    .search-input:focus, .field-input:focus, .composer-textarea:focus { border-color: var(--action); box-shadow: 0 0 0 2px rgba(125,211,252,.12); }
    .search-input { flex: 1 1 220px; padding: 9px 11px; }
    .filter-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
    .filter-button { border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--muted); padding: 6px 9px; font-size: 11px; }
    .filter-button:hover, .filter-button.active { border-color: #486064; background: #1d292b; color: var(--accent); }
    .pagination { display: flex; justify-content: flex-end; gap: 7px; margin-top: 12px; }
    .detail-panel { position: sticky; top: 0; display: flex; min-width: 0; min-height: 0; max-height: min(720px, calc(100vh - 170px)); flex-direction: column; overflow: hidden; }
    .detail-panel .surface-header { flex: 0 0 auto; }
    .detail-panel .surface-body { min-height: 0; }
    .native-detail-scroll { min-height: 0; flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; }
    .detail-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
    .detail-grid .wide { grid-column: 1 / -1; }
    .detail-text { color: var(--soft); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
    .turn-list { display: grid; gap: 9px; max-height: none; overflow: visible; }
    .turn-item { border-left: 2px solid #3c4651; padding-left: 10px; }
    .turn-role { color: var(--muted); font-size: 11px; }
    .turn-content { margin-top: 3px; color: var(--soft); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
    .history-note { margin-top: 8px; color: var(--muted); font-size: 11px; line-height: 1.5; }
    .history-more { display: flex; justify-content: center; margin-top: 12px; }
    .scheduled-list { display: grid; gap: 10px; }
    .scheduled-card { min-width: 0; border: 1px solid var(--line-soft); border-radius: 10px; background: rgba(255,255,255,.018); padding: 14px; }
    .scheduled-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .scheduled-card-title { min-width: 0; color: var(--text); font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .scheduled-card-kind { margin-top: 5px; color: var(--muted); font-size: 11px; }
    .scheduled-meta { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin-top: 14px; }
    .scheduled-rule { margin-top: 14px; border-top: 1px solid var(--line-soft); padding-top: 11px; color: var(--soft); font: 12px/1.5 Consolas,"Cascadia Mono",monospace; overflow-wrap: anywhere; }
    .scheduled-thread { margin-top: 10px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
    .composer { display: grid; gap: 15px; }
    .composer-textarea { min-height: 128px; resize: vertical; padding: 13px; line-height: 1.55; }
    .form-grid { display: grid; grid-template-columns: minmax(180px,.8fr) minmax(260px,1.4fr) minmax(160px,.75fr) minmax(140px,.65fr); gap: 12px; align-items: end; }
    .field { min-width: 0; }
    .field-label { display: block; margin-bottom: 6px; color: var(--soft); font-size: 12px; }
    .field-label small { color: var(--muted); }
    .field-input { padding: 10px 11px; }
    .path-control { display: flex; min-width: 0; gap: 7px; }
    .path-control .field-input { min-width: 0; flex: 1; text-overflow: ellipsis; }
    .path-control .secondary-button { flex: 0 0 auto; white-space: nowrap; }
    .field-hint { min-height: 17px; margin-top: 5px; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .field-hint.warning { color: var(--warning); }
    .field-input.invalid { border-color: var(--danger); box-shadow: 0 0 0 2px rgba(251,139,139,.10); }
    .readonly-control { display: flex; align-items: center; justify-content: space-between; gap: 7px; min-height: 40px; border: 1px solid var(--line); border-radius: 8px; background: #15171b; color: var(--soft); padding: 9px 11px; }
    .readonly-control::after { content: "锁定"; color: var(--muted); font-size: 10px; }
    .composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .composer-note { color: var(--muted); font-size: 11px; }
    .hidden { display: none !important; }
    .diagnostic-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
    .diagnostic-row { display: grid; grid-template-columns: minmax(130px,.8fr) minmax(0,1.2fr); gap: 10px; border-bottom: 1px solid var(--line-soft); padding: 11px 0; }
    .diagnostic-row:last-child { border-bottom: 0; }
    .diagnostic-label { color: var(--muted); font-size: 12px; }
    .diagnostic-value { min-width: 0; color: var(--soft); font-size: 13px; overflow-wrap: anywhere; }
    .diagnostic-value.ok { color: var(--accent); }
    .diagnostic-value.warn { color: var(--warning); }
    .diagnostic-value.bad { color: var(--danger); }
    .diagnostic-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .legacy-note { margin-top: 8px; color: var(--muted); font-size: 11px; }
    .legacy-link { color: var(--action); text-decoration: none; }
    .legacy-link:hover { text-decoration: underline; }
    .raw-json { max-height: 460px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: #0e1012; color: #c7d2da; padding: 13px; font: 12px/1.55 Consolas,"Cascadia Mono",monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .task-detail-drawer { position: fixed; inset: 0; z-index: 5; display: flex; justify-content: flex-end; background: rgba(0,0,0,.42); }
    .task-detail-drawer.hidden { display: none; }
    .task-detail-drawer-card { width: min(560px, 92vw); height: 100%; overflow: auto; border-left: 1px solid var(--line); background: var(--panel); padding: 22px; box-shadow: -14px 0 36px rgba(0,0,0,.28); }
    .task-detail-drawer-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--line-soft); padding-bottom: 15px; }
    .task-detail-drawer-title { min-width: 0; font-size: 18px; font-weight: 650; overflow-wrap: anywhere; }
    .task-detail-grid { display: grid; grid-template-columns: minmax(110px,.65fr) minmax(0,1.35fr); gap: 12px; margin-top: 18px; }
    .task-detail-grid .detail-value { margin-top: 0; }
    .task-detail-section { margin-top: 20px; border-top: 1px solid var(--line-soft); padding-top: 13px; }
    .task-detail-events { display: grid; gap: 8px; margin-top: 9px; }
    .task-detail-event { border-left: 2px solid #3c4651; padding-left: 10px; color: var(--soft); font-size: 12px; line-height: 1.5; }
    .task-detail-event-meta { color: var(--muted); font-size: 11px; }
    .toast { position: fixed; right: 24px; bottom: 22px; z-index: 3; max-width: 420px; border: 1px solid #40575b; border-radius: 8px; background: #182124; color: var(--soft); padding: 10px 13px; box-shadow: 0 12px 32px rgba(0,0,0,.28); }
    .toast.hidden { display: none; }
    .client-fallback { position: fixed; inset: 0; z-index: 9; display: grid; place-items: center; background: #101113; padding: 28px; }
    .client-fallback.hidden { display: none; }
    .client-fallback-card { width: min(560px, 100%); border: 1px solid #4b3f32; border-radius: 12px; background: #17191d; padding: 24px; box-shadow: 0 18px 48px rgba(0,0,0,.32); }
    .client-fallback-card h2 { margin: 0; font-size: 20px; }
    .client-fallback-card p { color: var(--muted); line-height: 1.6; }
    .client-fallback-error { max-height: 130px; overflow: auto; border-left: 2px solid var(--warning); padding: 8px 11px; color: var(--soft); font: 12px/1.5 Consolas,"Cascadia Mono",monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .client-fallback-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    @media (max-width: 1180px) {
      .app-shell { grid-template-columns: 210px minmax(0,1fr); }
      .status-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
      .form-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
    }
    @media (max-width: 980px) {
      body { min-width: 760px; }
      .app-shell { grid-template-columns: 190px minmax(0,1fr); }
      .overview-grid, .native-layout { grid-template-columns: 1fr; }
      .detail-panel { position: static; max-height: none; overflow: visible; }
      .native-detail-scroll { overflow: visible; }
      .content-scroll { padding-left: 20px; padding-right: 20px; }
    }
  </style>
</head>
<body>
  <div class="app-shell" id="taskFlow">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">B·C</div>
        <div><div class="brand-name">Local Codex Bridge</div><div class="brand-subtitle">本机 Codex 控制台</div></div>
      </div>
      <nav class="nav" aria-label="主导航">
        <button class="nav-item active" data-page="overview"><span>总览</span><span class="nav-hint">系统</span></button>
        <button class="nav-item" data-page="native"><span>Native Threads</span><span class="nav-hint">持久会话</span></button>
        <button class="nav-item" data-page="agents"><span>AGENTS</span><span class="nav-hint" id="navAgentCount">0 / 5</span></button>
        <button class="nav-item" data-page="scheduled"><span>Scheduled Tasks</span><span class="nav-hint">自动化</span></button>
        <button class="nav-item" data-page="diagnostics"><span>诊断</span><span class="nav-hint">状态</span></button>
      </nav>
      <div class="sidebar-note">Native Thread：持久会话<br>AGENT Task：ephemeral 独立任务<br><span id="connectionNote">正在读取 Bridge 状态…</span></div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="topbar-heading"><div class="eyebrow">LOCAL CODEX BRIDGE / CONTROL CENTER</div><h1 id="pageTitle">总览</h1></div>
        <div class="topbar-actions">
          <div class="status-strip" aria-label="系统状态">
            <button class="status-pill" id="bridgePill" data-page="diagnostics">Bridge <span class="status-value">读取中</span></button>
            <button class="status-pill" id="tunnelPill" data-page="diagnostics">Tunnel <span class="status-value">读取中</span></button>
            <button class="status-pill" id="pluginPill" data-page="diagnostics">Plugin <span class="status-value">读取中</span></button>
            <button class="status-pill" id="codexPill" data-page="diagnostics">Codex <span class="status-value">读取中</span></button>
          </div>
          <button class="toolbar-button" id="diagnosticsButton" data-page="diagnostics">诊断</button>
        </div>
      </header>
      <div class="content-scroll">
        <section class="page active" id="page-overview" data-page-view="overview">
          <div class="page-lead"><div><h2>总览</h2><p>查看本机 Bridge、Tunnel、Plugin 与 Codex 的当前状态，以及正在执行的工作。</p></div></div>
          <section class="surface"><div class="surface-header"><div class="surface-title">系统状态</div><div class="surface-caption">点击状态可查看诊断</div></div><div class="surface-body"><div class="status-grid" id="overviewStatus"></div></div></section>
          <div class="overview-grid">
            <section class="surface"><div class="surface-header"><div class="surface-title">正在执行</div><div class="surface-caption" id="overviewActiveCaption"></div></div><div class="surface-body" id="overviewActive"></div></section>
            <section class="surface"><div class="surface-header"><div class="surface-title">AGENTS 概览</div><button class="text-button" data-page="agents">进入 AGENTS</button></div><div class="surface-body"><div class="metric-grid" id="overviewAgents"></div></div></section>
          </div>
          <section class="surface"><div class="surface-header"><div class="surface-title">最近 Native Threads</div><button class="text-button" data-page="native">查看全部</button></div><div class="surface-body" id="overviewThreads"></div></section>
        </section>

        <section class="page" id="page-native" data-page-view="native">
          <div class="page-lead"><div><h2>Native Threads</h2><p>查看与继续底层 Codex 的持久会话。这里使用官方 thread/list 与 thread/read，不替换原生 Codex Desktop。</p></div><div class="page-actions"><button class="secondary-button" id="nativeRefresh">刷新</button><button class="primary-button" id="newNativeThread">+ 新建持久会话</button></div></div>
          <section class="surface"><div class="surface-body"><div class="search-row"><input class="search-input" id="nativeSearch" placeholder="搜索会话…" aria-label="搜索会话"><button class="secondary-button" id="nativeSearchButton">搜索</button></div><div class="filter-row" id="nativeFilters"><button class="filter-button active" data-native-filter="all">全部</button><button class="filter-button" data-native-filter="running">运行中</button><button class="filter-button" data-native-filter="recent">最近</button><button class="filter-button" data-native-filter="bridge">Bridge 创建</button><button class="filter-button" data-native-filter="native">原生 Codex</button></div></div></section>
          <div class="native-layout" style="margin-top:16px">
            <section class="surface"><div class="surface-header"><div><div class="surface-title">持久会话列表</div><div class="surface-caption" id="nativeListCaption">官方 thread/list</div></div></div><div class="surface-body"><div class="item-list" id="nativeList"></div><div class="pagination"><button class="secondary-button" id="nativeNext" disabled>下一页</button></div></div></section>
            <aside class="surface detail-panel" id="nativeDetailPanel"><div class="surface-header"><div class="surface-title">会话详情</div><div class="surface-caption" id="nativeDetailStatus">未选择</div></div><div class="surface-body native-detail-scroll" id="nativeDetail"><div class="empty-state"><strong>选择一个 Native Thread</strong>点击列表项查看基本信息、最近内容和可用操作。</div></div></aside>
          </div>
          <section class="surface hidden" id="nativeComposerWrap" style="margin-top:16px"><div class="surface-header"><div><div class="surface-title">新建持久会话</div><div class="surface-caption">Native Thread 会保存在 Codex session history</div></div><button class="text-button" id="closeNativeComposer">收起</button></div><div class="surface-body"><form class="composer" id="nativeComposer"><textarea class="composer-textarea" id="nativePrompt" placeholder="描述要交给 Codex 的工作…" aria-label="Native Thread 任务描述"></textarea><div class="form-grid"><div class="field"><label class="field-label" for="nativeCwd">工作目录</label><div class="path-control"><input class="field-input" id="nativeCwd" placeholder="选择或输入项目目录" title="Codex 工作目录"><button class="secondary-button" type="button" id="pickNativeCwd">选择文件夹</button></div><div class="field-hint" id="nativeCwdHint">选择或输入项目目录</div></div><div class="field"><span class="field-label">模型</span><div class="readonly-control" id="nativeModel" data-value="gpt-5.6-luna" title="当前 Bridge 仅启用 GPT-5.6 Luna。">GPT-5.6 Luna</div></div><div class="field"><span class="field-label">推理强度</span><div class="readonly-control" id="nativeEffort" data-value="max" title="当前 Bridge 固定使用 Max 推理强度。">Max</div></div><div class="field"><label class="field-label" for="nativeTitle">会话标题 <small>可选</small></label><input class="field-input" id="nativeTitle" placeholder="输入会话标题"></div></div><div class="composer-footer"><span class="composer-note">Native Thread · persistent · 使用现有 app-server 会话</span><button class="primary-button" type="submit" id="nativeSendButton">创建会话</button></div></form></div></section>
        </section>

        <section class="page" id="page-agents" data-page-view="agents">
          <div class="page-lead"><div><h2>AGENTS</h2><p>提交独立的 ephemeral Codex 任务。任务状态保留在 Bridge，独立于 Native persistent threads。</p></div><div class="page-actions"><button class="primary-button" id="newAgentTask">+ 新建独立任务</button></div></div>
          <section class="surface"><div class="surface-header"><div class="surface-title">运行概况</div><div class="surface-caption">真实 Worker / queue 状态</div></div><div class="surface-body"><div class="metric-grid" id="agentsMetrics"></div></div></section>
          <section class="surface hidden" id="agentComposerWrap" style="margin-top:16px"><div class="surface-header"><div><div class="surface-title">新建独立任务</div><div class="surface-caption">AGENT Task · ephemeral，不进入 Native thread 历史</div></div><button class="text-button" id="closeAgentComposer">收起</button></div><div class="surface-body"><form class="composer" id="composer"><textarea class="composer-textarea" id="prompt" placeholder="描述要交给 AGENTS 的任务…" aria-label="AGENTS 任务描述"></textarea><div class="form-grid"><div class="field"><label class="field-label" for="title">任务标题 <small>可选</small></label><input class="field-input" id="title" placeholder="输入任务标题"></div><div class="field"><label class="field-label" for="cwd">工作目录</label><div class="path-control"><input class="field-input" id="cwd" placeholder="选择或输入项目目录" title="Codex 工作目录"><button class="secondary-button" type="button" id="pickCwd">选择文件夹</button></div><div class="field-hint" id="cwdHint">选择或输入项目目录</div></div><div class="field"><span class="field-label">模型</span><div class="readonly-control" id="model" data-value="gpt-5.6-luna" title="当前 Bridge 仅启用 GPT-5.6 Luna。">GPT-5.6 Luna</div></div><div class="field"><span class="field-label">推理强度</span><div class="readonly-control" id="effort" data-value="max" title="当前 Bridge 固定使用 Max 推理强度。">Max</div></div></div><div class="composer-footer"><span class="composer-note">AGENT Task · ephemeral · Ctrl + Enter 发送</span><button class="primary-button" type="submit" id="sendButton">发送</button></div></form></div></section>
          <section class="surface" style="margin-top:16px"><div class="surface-header"><div class="surface-title">任务记录</div><div class="surface-caption">完成任务默认精简，详情按需展开</div></div><div class="surface-body" id="agentTasks"></div></section>
        </section>

        <section class="page" id="page-scheduled" data-page-view="scheduled">
          <div class="page-lead"><div><h2>Scheduled Tasks</h2><p>只读显示 Codex Desktop 的本地自动化定义。Scheduled Tasks 与 Native Threads 是独立数据源。</p></div><div class="page-actions"><button class="secondary-button" id="scheduledRefresh">刷新</button></div></div>
          <section class="surface"><div class="surface-header"><div><div class="surface-title">本地自动化</div><div class="surface-caption" id="scheduledTasksCaption">读取 codex-dev.db</div></div></div><div class="surface-body" id="scheduledTasksContent"><div class="empty-state">打开此页面后读取本机 Scheduled Tasks。</div></div></section>
        </section>

        <section class="page" id="page-diagnostics" data-page-view="diagnostics">
          <div class="page-lead"><div><h2>诊断</h2><p>查看 Bridge、Tunnel、Plugin、Codex app-server 与 AGENTS 的真实运行状态。原始 JSON 默认折叠。</p></div><div class="page-actions"><button class="secondary-button" id="refreshDiagnostics">刷新</button></div></div>
          <section class="surface"><div class="surface-header"><div class="surface-title">状态概览</div><div class="surface-caption" id="diagnosticUpdated">实时 read model</div></div><div class="surface-body"><div class="diagnostic-grid"><div class="diagnostic-row"><div class="diagnostic-label">Build</div><div class="diagnostic-value" id="diagnosticBuild">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">UI bundle</div><div class="diagnostic-value" id="diagnosticUiBundleHash">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">EXE</div><div class="diagnostic-value" id="diagnosticExeHash">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Loaded asset</div><div class="diagnostic-value" id="diagnosticLoadedAssetHash">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Bridge</div><div class="diagnostic-value" id="diagnosticBridge">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Tunnel</div><div class="diagnostic-value" id="diagnosticTunnel">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Tunnel registration</div><div class="diagnostic-value" id="diagnosticTunnelRegistration">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Active tunnel id</div><div class="diagnostic-value" id="diagnosticTunnelId">未报告</div></div><div class="diagnostic-row"><div class="diagnostic-label">Plugin transport</div><div class="diagnostic-value" id="diagnosticPlugin">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Codex App Server</div><div class="diagnostic-value" id="diagnosticAppServer">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Native session transport</div><div class="diagnostic-value" id="diagnosticNative">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Tunnel client</div><div class="diagnostic-value" id="diagnosticTunnelVersion">未报告</div></div><div class="diagnostic-row"><div class="diagnostic-label">AGENTS / Workers</div><div class="diagnostic-value" id="diagnosticWorkers">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Queue</div><div class="diagnostic-value" id="diagnosticQueue">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Pending confirmation</div><div class="diagnostic-value" id="diagnosticPending">读取中</div></div><div class="diagnostic-row"><div class="diagnostic-label">Ports</div><div class="diagnostic-value" id="diagnosticPorts">读取中</div></div><div class="diagnostic-row wide"><div class="diagnostic-label">Last error</div><div class="diagnostic-value" id="diagnosticLastError">无</div></div></div></div></section>
          <section class="surface"><div class="surface-header"><div class="surface-title">高级工具</div></div><div class="surface-body"><div class="diagnostic-actions"><button class="secondary-button" id="copyDiagnostics">复制诊断信息</button><button class="secondary-button" id="openLogDirectory">打开日志目录</button><a class="secondary-button legacy-link" id="legacyStatusLink" href="/status" target="_blank" rel="noreferrer">旧版状态页 ↗</a></div><div class="legacy-note">用于高级诊断，将在系统浏览器打开。</div></div></section>
          <section class="surface"><div class="surface-header"><div class="surface-title">原始数据</div><div class="surface-caption">仅在需要排错时展开</div></div><div class="surface-body"><details id="rawDiagnostics"><summary id="rawToggle">查看原始 JSON</summary><div class="diagnostic-actions" style="margin:10px 0"><button class="secondary-button" id="copyRawDiagnostics">复制 JSON</button></div><pre class="raw-json" id="diagnosticsContent">点击后读取诊断数据。</pre></details></div></section>
        </section>
      </div>
    </main>
  </div>
  <div class="toast hidden" id="toast" role="status"></div>
  <aside class="task-detail-drawer hidden" id="taskDetailDrawer" role="dialog" aria-modal="true" aria-labelledby="taskDetailDrawerTitle">
    <div class="task-detail-drawer-card">
      <div class="task-detail-drawer-header"><div class="task-detail-drawer-title" id="taskDetailDrawerTitle">AGENTS 任务详情</div><button class="secondary-button" type="button" id="closeTaskDetail">关闭</button></div>
      <div id="taskDetailContent"><div class="empty-state">选择一个 AGENTS 任务查看详情。</div></div>
    </div>
  </aside>
  <div class="client-fallback hidden" id="clientFallback" role="alert" aria-live="assertive">
    <div class="client-fallback-card">
      <h2>Local Codex Bridge</h2>
      <p>Control Center failed to load</p>
      <div class="client-fallback-error" id="clientFallbackError">正在读取前端错误…</div>
      <div class="client-fallback-actions"><button class="secondary-button" type="button" id="clientFallbackReload">重新加载</button><a class="secondary-button legacy-link" href="/status" target="_blank" rel="noreferrer">打开诊断</a></div>
    </div>
  </div>
  <script>
    (() => {
      function errorText(value) {
        if (value && typeof value === "object") { if (typeof value.message === "string") return value.message; try { return JSON.stringify(value); } catch (_) { return "无法序列化前端错误"; } }
        return String(value || "未知前端错误");
      }
      function reportClientError(kind, value, source, line, column) {
        const message = errorText(value); const stack = value && typeof value === "object" && typeof value.stack === "string" ? value.stack : ""; const panel = document.getElementById("clientFallback"); const detail = document.getElementById("clientFallbackError");
        if (detail) detail.textContent = message + (stack ? "\n" + stack : ""); if (panel) panel.classList.remove("hidden");
        const webview = window.chrome && window.chrome.webview; if (webview && typeof webview.postMessage === "function") { try { webview.postMessage({ type: "client-error", kind, message, stack, source: source || "", line: line || 0, column: column || 0 }); } catch (_) {} }
      }
      window.__bridgeReportClientError = reportClientError;
      window.addEventListener("error", (event) => reportClientError("window.onerror", event.error || event.message, event.filename, event.lineno, event.colno));
      window.addEventListener("unhandledrejection", (event) => reportClientError("unhandledrejection", event.reason, "", 0, 0));
      const originalConsoleError = window.console && window.console.error; if (originalConsoleError) window.console.error = function() { const values = Array.prototype.slice.call(arguments).map(errorText); reportClientError("console.error", values.join(" "), "", 0, 0); try { return originalConsoleError.apply(window.console, arguments); } catch (_) {} };
      const reload = document.getElementById("clientFallbackReload"); if (reload) reload.addEventListener("click", () => window.location.reload());
    })();
  </script>
  <script>
    (() => {
      const $ = (id) => document.getElementById(id);
      const ControlCenterState = {
        page: "overview",
        status: null,
        diagnostics: null,
        sessions: null,
        native: { items: [], nextCursor: null, search: "", filter: "all", loaded: false, loading: false, error: null, selectedId: null, detail: null, history: { items: [], nextCursor: null, loaded: false, loading: false, error: null } },
        scheduled: { items: [], loaded: false, loading: false, error: null, available: false, source: null },
        taskDetails: { selectedId: null, data: null, loading: false, error: null, cancelRequested: false },
        agentComposerOpen: false,
        nativeComposerOpen: false,
        folderTarget: "agent",
        loading: false,
      };
      const state = ControlCenterState;
      const pages = { overview: "总览", native: "Native Threads", agents: "AGENTS", scheduled: "Scheduled Tasks", diagnostics: "诊断" };
      let eventSource = null;
      let refreshTimer = null;
      let toastTimer = null;

      function escapeHtml(value) {
        const safe = value !== null && typeof value === "object" ? scalar(value) || "" : value == null ? "" : value;
        return String(safe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
      }
      function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
      function safeNumber(value) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && value.trim() !== "") { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
        return null;
      }
      function scalar(value, fields) {
        if (typeof value === "string" && value.trim() !== "") return value.trim();
        const number = safeNumber(value); if (number !== null) return String(number);
        if (!isRecord(value)) return null;
        const names = fields || ["label", "name", "type", "value"];
        for (const field of names) { const nested = scalar(value[field]); if (nested) return nested; }
        return null;
      }
      function firstValue(object, fields) {
        if (!isRecord(object)) return null;
        for (const field of fields) if (object[field] !== null && object[field] !== undefined) return object[field];
        return null;
      }
      function normalizeTimestamp(value) {
        const number = safeNumber(value);
        if (number !== null) return Math.abs(number) < 100000000000 ? number * 1000 : number;
        if (typeof value === "string" && value.trim() !== "") { const parsed = Date.parse(value.trim()); return Number.isFinite(parsed) ? parsed : null; }
        if (isRecord(value)) return normalizeTimestamp(firstValue(value, ["timestamp", "time", "value", "updatedAt", "updated_at", "recencyAt", "recency_at", "createdAt", "created_at"]));
        return null;
      }
      function formatTime(value) {
        const timestamp = normalizeTimestamp(value); if (timestamp === null) return "未报告";
        const delta = Date.now() - timestamp; if (delta < 0 || delta < 10000) return "刚刚";
        const seconds = Math.floor(delta / 1000); if (seconds < 60) return seconds + "秒前";
        const minutes = Math.floor(seconds / 60); if (minutes < 60) return minutes + "分钟前";
        const hours = Math.floor(minutes / 60); if (hours < 24) return hours + "小时前";
        const then = new Date(timestamp); const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const thenStart = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
        if (todayStart - thenStart === 86400000) return "昨天";
        if (then.getFullYear() === today.getFullYear()) return (then.getMonth() + 1) + "月" + then.getDate() + "日";
        return then.getFullYear() + "年" + (then.getMonth() + 1) + "月" + then.getDate() + "日";
      }
      function text(value, fallback) { return scalar(value) || (fallback || "未报告"); }
      function fetchJson(path, options) {
        const init = Object.assign({ cache: "no-store" }, options || {});
        if (!["GET", "HEAD"].includes(String(init.method || "GET").toUpperCase())) {
          const authorization = document.querySelector('meta[name="bridge-request-token"]');
          if (!authorization || !authorization.content) return Promise.reject(new Error("页面授权已失效，请重新加载控制中心后再操作。"));
          const headers = new Headers(init.headers || {});
          headers.set("X-Bridge-Request-Token", authorization.content);
          init.headers = headers;
        }
        return fetch(path, init).then(async (response) => {
          const raw = await response.text();
          let body = null;
          try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = null; }
          if (!response.ok) throw new Error(body && body.error ? body.error : "Bridge 请求失败（" + response.status + "）");
          return body;
        });
      }
      function showToast(message) {
        const toast = $("toast");
        if (!toast) return;
        toast.textContent = message;
        toast.classList.remove("hidden");
        if (toastTimer) window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3200);
      }
      function statusClass(value) {
        const normalized = (scalar(value, ["state", "status", "process_state", "type", "value", "label"]) || "").toLowerCase();
        if (["ready", "running", "connected", "idle", "completed", "active", "ok"].some((item) => normalized.includes(item))) return "ok";
        if (["starting", "waiting", "registering", "pending", "paused", "cancel", "recovery", "notloaded", "not_reported", "not_configured"].some((item) => normalized.includes(item))) return "warn";
        if (["error", "failed", "disconnected", "not_ready", "not_registered"].some((item) => normalized.includes(item))) return "bad";
        return "";
      }
      function statusLabel(value, kind) {
        if (isRecord(value) && scalar(value.label)) return scalar(value.label);
        const normalized = (scalar(value, ["state", "status", "process_state", "type", "value", "label"]) || "").toLowerCase();
        if (kind === "bridge" && ["running", "connected", "ready"].includes(normalized)) return "已连接";
        if (normalized === "ready" || normalized === "running" || normalized === "connected" || normalized === "idle") return "已就绪";
        if (normalized === "starting" || normalized === "registering" || normalized === "opening" || normalized === "initializing") return "启动中";
        if (normalized === "waiting" || normalized === "not_started" || normalized === "lazy" || normalized === "pending") return "待启动";
        if (normalized === "not_configured" || normalized === "not_registered") return "未配置";
        if (normalized === "not_ready" || normalized === "disconnected") return "未连接";
        if (normalized === "failed" || normalized === "error" || normalized === "fatal") return "异常";
        return text(value, "未报告");
      }
      function makeBadge(value, kind) { return '<span class="badge ' + statusClass(value) + '"><span class="status-dot ' + statusClass(value) + '"></span>' + escapeHtml(statusLabel(value, kind)) + '</span>'; }
      function taskStatusLabel(value) {
        const map = { WAITING: "排队中", STARTING: "启动中", RUNNING: "运行中", RETRYING: "重试中", NEED_CONFIRM: "待确认", RECOVERY_REQUIRED: "需要处理", COMPLETED: "已完成", DONE: "已完成", FAILED: "失败", BLOCKED: "已阻塞", INTERRUPTED: "已中断", IDLE: "空闲", ACTIVE: "运行中", NOTLOADED: "历史较大，已分页加载", CANCEL_REQUESTED: "取消中", CANCELLED: "已取消" };
        const normalized = (scalar(value, ["status", "state", "type", "value"]) || "").toUpperCase();
        return map[normalized] || text(value, "未报告");
      }
      function taskKind(task) { return (scalar(task && task.execution_source, ["type", "source", "value"]) || "").toLowerCase().includes("native") || (scalar(task && task.source, ["type", "source", "value"]) || "").toLowerCase().includes("external") ? "Native Codex · 持久会话" : "AGENTS · ephemeral 独立任务"; }
      function payloadOf(data) { return data && isRecord(data.status) ? data.status : data || {}; }
      function subsystemState(value, kind) {
        const normalized = (scalar(value, ["state", "status", "process_state", "type", "value", "label"]) || "").toLowerCase();
        if (kind === "bridge" && ["running", "connected", "ready"].includes(normalized)) return { state: "connected", label: "已连接", detail: null };
        if (["ready", "running", "connected", "idle"].includes(normalized)) return { state: "ready", label: "已就绪", detail: null };
        if (["starting", "registering", "opening", "initializing"].includes(normalized)) return { state: "starting", label: "启动中", detail: null };
        if (["not_started", "waiting", "lazy", "pending"].includes(normalized)) return { state: "waiting", label: "待启动", detail: null };
        if (["not_configured", "not_registered"].includes(normalized)) return { state: "not_configured", label: "未配置", detail: null };
        if (["failed", "error", "fatal"].includes(normalized)) return { state: "error", label: "异常", detail: null };
        return { state: "disconnected", label: "未连接", detail: null };
      }
      function controlCenterState(data) {
        const value = payloadOf(data); if (isRecord(value.control_center)) return value.control_center;
        const tunnel = isRecord(value.tunnel) ? value.tunnel : {};
        const app = isRecord(value.appServer) ? value.appServer : (isRecord(value.app_server) ? value.app_server : {});
        const native = isRecord(value.native_session_transport) ? value.native_session_transport : {};
        const tunnelInfo = subsystemState(tunnel.status || tunnel, "tunnel"); const registrationInfo = subsystemState(tunnel.registration, "tunnel");
        const appProcess = scalar(app.process_state || app.status, ["state", "status", "process_state", "type", "value"]) || "not_started"; const nativeProcess = scalar(native.status, ["state", "status", "process_state", "type", "value"]) || ""; const codexRaw = appProcess === "running" ? "running" : nativeProcess === "disconnected" && appProcess === "not_started" ? "not_started" : native.status || app.process_state || app.status || "not_started";
        return {
          source: "normalized_status",
          bridge: subsystemState(value.bridge, "bridge"),
          tunnel: registrationInfo.state === "ready" && tunnelInfo.state !== "error" ? { state: "ready", label: "已就绪", detail: null, registration: "ready" } : { ...tunnelInfo, registration: registrationInfo.state },
          plugin: subsystemState(value.plugin_bridge, "plugin"),
          codex: subsystemState(codexRaw, "codex"),
          activeNativeTurns: value.tasks && Array.isArray(value.tasks.active) ? value.tasks.active.filter((task) => taskKind(task).startsWith("Native")) : [],
          agentJobs: { running: Number(value.agents && value.agents.active_jobs || value.workers && (value.workers.bridge_running || value.workers.running) || 0), queued: Number(value.agents && value.agents.queued_jobs || value.queue && value.queue.depth || 0), max: Number(value.agents && value.agents.max_jobs || value.workers && value.workers.max || 5), recentFailures: 0 },
        };
      }
      function currentStatus() { return state.status || {}; }
      function appServerStatus(data) { const value = payloadOf(data); const app = value.app_server || value.appServer; return isRecord(app) ? scalar(app.status || app.process_state, ["state", "status", "process_state", "type", "value"]) || "not_reported" : scalar(app, ["state", "status", "process_state", "type", "value"]) || "not_reported"; }
      function pluginStatus(data) { const value = payloadOf(data); return scalar(value.plugin_bridge, ["state", "status", "type", "value"]) || "not_ready"; }
      function nativeStatus(data) { const value = payloadOf(data); const native = value.native_session_transport; return scalar(native, ["state", "status", "process_state", "type", "value"]) || appServerStatus(value); }
      function tunnelStatus(data) { const value = payloadOf(data); return scalar(value.tunnel && value.tunnel.status, ["state", "status", "type", "value"]) || "not_configured"; }
      function tunnelRegistration(data) { const value = payloadOf(data); return scalar(value.tunnel && value.tunnel.registration, ["state", "status", "type", "value"]) || "not_registered"; }
      function agentSnapshot(data) { const value = payloadOf(data); return isRecord(value.agents) ? value.agents : (state.sessions && state.sessions.agents) || {}; }
      function activeTasks(data) {
        const value = payloadOf(data); const tasks = value.tasks && Array.isArray(value.tasks.active) ? value.tasks.active.slice() : [];
        const known = new Set(tasks.map((task) => scalar(task && task.id, ["id", "task_id"]) || "")); const native = controlCenterState(value).activeNativeTurns || [];
        for (const task of native) { const id = scalar(task && task.id, ["id", "task_id"]) || ""; if (id && !known.has(id)) tasks.push(task); }
        return tasks;
      }
      function threadSummary(raw) {
        const object = isRecord(raw) ? raw : {}; const source = isRecord(object.thread) ? object.thread : object; const provided = isRecord(object.control_center) ? object.control_center : null;
        const id = scalar(provided && provided.id || firstValue(source, ["id", "thread_id"]) || firstValue(object, ["id", "thread_id"]), ["id", "thread_id"]) || "";
        const title = scalar(provided && provided.title || firstValue(source, ["title", "name", "preview", "last_message"]) || firstValue(object, ["title", "name", "preview"]), ["title", "name", "preview", "last_message"]) || "未命名会话";
        const status = scalar(provided && provided.status || firstValue(source, ["status", "state", "type"]) || firstValue(object, ["status", "state", "type"]), ["status", "state", "type"]) || "idle";
        const cwd = scalar(provided && provided.cwd || firstValue(source, ["cwd", "working_directory", "workingDirectory"]) || firstValue(object, ["cwd", "working_directory", "workingDirectory"]), ["path", "fullPath", "absolutePath", "cwd", "value"]);
        const sourceLabel = scalar(provided && provided.source || firstValue(source, ["source", "threadSource", "created_by", "createdBy", "execution_source", "origin"]) || firstValue(object, ["source", "threadSource", "created_by", "createdBy", "execution_source", "origin"]), ["type", "source", "name", "label", "value"]);
        const model = scalar(provided && provided.model || firstValue(source, ["model", "modelProvider", "model_provider"]) || firstValue(object, ["model", "modelProvider", "model_provider"]), ["id", "model", "name", "provider", "modelProvider", "value"]);
        const updatedAt = provided && (provided.updatedAt || provided.recencyAt) || firstValue(source, ["updatedAt", "updated_at", "recencyAt", "recency_at", "createdAt", "created_at"]) || firstValue(object, ["updatedAt", "updated_at", "recencyAt", "recency_at", "createdAt", "created_at"]);
        return { raw, id, title, status, cwd: cwd || "", updatedAt: updatedAt || null, recencyLabel: provided && scalar(provided.recencyLabel) || formatTime(updatedAt), source: sourceLabel, model, displayCwd: provided && scalar(provided.displayCwd) || shortenPath(cwd) };
      }
      function threadSourceLabel(item) {
        const source = (scalar(item && item.source, ["type", "source", "name", "label", "value"]) || "").toLowerCase();
        if (!source) return null;
        if (source.includes("bridge")) return "Bridge 创建";
        if (source.includes("native") || source.includes("codex") || source.includes("cli")) return "原生 Codex";
        return scalar(item.source, ["type", "source", "name", "label", "value"]);
      }
      function shortenPath(value, maxLength) {
        const path = scalar(value, ["path", "fullPath", "absolutePath", "cwd", "value"]); if (!path) return null; const max = maxLength || 48; if (path.length <= max) return path;
        const separator = path.includes("\\") ? "\\" : "/"; const parts = path.split(/[\\/]+/).filter(Boolean); if (parts.length <= 2) return path.slice(0, Math.max(0, max - 1)) + "…";
        const prefix = path.match(/^[A-Za-z]:/) ? path.slice(0, 2) : ""; const suffix = parts.slice(-2).join(separator); const result = prefix + separator + "…" + separator + suffix; return result.length <= max ? result : result.slice(0, Math.max(0, max - 1)) + "…";
      }
      function shortHash(value, label) { const hash = scalar(value); return hash ? (label ? label + " · " : "") + hash.slice(0, 12) : "未报告"; }
      function scheduledStatusLabel(value) {
        const status = (scalar(value, ["status", "state", "type", "value"]) || "UNKNOWN").toUpperCase();
        if (status === "ACTIVE") return "ACTIVE · 已启用";
        if (status === "PAUSED") return "PAUSED · 已暂停";
        return status;
      }
      function scheduledRunStatus(value) {
        const status = (scalar(value, ["status", "state", "type", "value"]) || "").toUpperCase();
        const labels = { COMPLETED: "已完成", DONE: "已完成", FAILED: "失败", ERROR: "异常", PENDING_REVIEW: "待确认", ARCHIVED: "已归档", RUNNING: "运行中", ACTIVE: "运行中" };
        return labels[status] || status || "未报告";
      }
      function scheduledRule(value) { return scalar(value, ["rrule", "rule", "schedule", "value"]) || "未报告"; }
      function scheduledTime(value, emptyLabel) { return value === null || value === undefined || value === "" ? emptyLabel : formatTime(value); }
      function renderScheduledTasks() {
        const root = $("scheduledTasksContent"); if (!root) return;
        const items = Array.isArray(state.scheduled.items) ? state.scheduled.items : [];
        if (state.scheduled.loading && !state.scheduled.loaded) { root.innerHTML = '<div class="empty-state">正在读取 Scheduled Tasks…</div>'; return; }
        if (state.scheduled.error) { root.innerHTML = '<div class="empty-state"><strong>Scheduled Tasks 读取失败</strong>' + escapeHtml(state.scheduled.error) + '</div>'; return; }
        if (!state.scheduled.available) { root.innerHTML = '<div class="empty-state"><strong>Scheduled Tasks 当前不可用</strong>本机 Codex Desktop 自动化数据库尚未准备好。</div>'; return; }
        $("scheduledTasksCaption").textContent = items.length + " 条 · 只读 codex-dev.db";
        if (!items.length) { root.innerHTML = '<div class="empty-state"><strong>暂无 Scheduled Tasks</strong>当前数据库没有可显示的本地自动化。</div>'; return; }
        root.innerHTML = '<div class="scheduled-list">' + items.map((item) => {
          const latest = isRecord(item && item.latest_run) ? item.latest_run : null;
          const kind = scalar(item && item.kind, ["kind", "type", "value"]);
          const targetThread = scalar(item && item.target_thread_id, ["thread_id", "id", "value"]);
          const latestThread = scalar(latest && latest.thread_id, ["thread_id", "id", "value"]);
          const latestTitle = scalar(latest && (latest.thread_title || latest.inbox_title), ["thread_title", "inbox_title", "title", "name", "value"]);
          const result = latest ? scheduledRunStatus(latest.status) + (latestTitle ? " · " + latestTitle : "") : "暂无运行记录";
          const thread = targetThread || latestThread;
          return '<article class="scheduled-card"><div class="scheduled-card-header"><div><div class="scheduled-card-title" title="' + escapeHtml(scalar(item && item.name) || "未命名自动化") + '">' + escapeHtml(scalar(item && item.name) || "未命名自动化") + '</div>' + (kind ? '<div class="scheduled-card-kind">' + escapeHtml(kind) + '</div>' : '') + '</div><span class="badge ' + statusClass(item && item.status) + '">' + escapeHtml(scheduledStatusLabel(item && item.status)) + '</span></div><div class="scheduled-meta"><div><div class="detail-label">下次执行</div><div class="detail-value">' + escapeHtml(scheduledTime(item && item.next_run_at, "未安排")) + '</div></div><div><div class="detail-label">上次执行</div><div class="detail-value">' + escapeHtml(scheduledTime(item && item.last_run_at, "未报告")) + '</div></div><div><div class="detail-label">最近运行结果</div><div class="detail-value" title="' + escapeHtml(result) + '">' + escapeHtml(result) + '</div></div><div><div class="detail-label">关联 Thread</div><div class="detail-value" title="' + escapeHtml(thread || "") + '">' + escapeHtml(thread || "未关联") + '</div></div></div><div class="scheduled-rule" title="' + escapeHtml(scheduledRule(item && item.rrule)) + '">' + escapeHtml(scheduledRule(item && item.rrule)) + '</div></article>';
        }).join("") + '</div>';
      }
      function renderTopStatus() {
        const data = currentStatus(); const control = controlCenterState(data);
        const values = [
          ["bridgePill", control.bridge, "Bridge"],
          ["tunnelPill", control.tunnel, "Tunnel"],
          ["pluginPill", control.plugin, "Plugin"],
          ["codexPill", control.codex, "Codex"],
        ];
        values.forEach(([id, value, label]) => {
          const element = $(id); if (!element) return;
          element.className = "status-pill " + statusClass(value);
          element.innerHTML = escapeHtml(label) + ' <span class="status-value">' + escapeHtml(statusLabel(value)) + "</span>";
        });
        $("connectionNote").textContent = control.bridge.label || "Bridge 状态待确认";
      }
      function renderStatusOverview() {
        const data = currentStatus(); const value = payloadOf(data); const control = controlCenterState(value); const tunnel = isRecord(value.tunnel) ? value.tunnel : {}; const plugin = isRecord(value.plugin_bridge) ? value.plugin_bridge : {}; const app = isRecord(value.appServer) ? value.appServer : (isRecord(value.app_server) ? value.app_server : {});
        const items = [
          ["Bridge", control.bridge, scalar(value.bridge && value.bridge.version) || "本机控制中心"],
          ["Tunnel", control.tunnel, scalar(tunnel.client_version) || "MCP Tunnel"],
          ["Plugin", control.plugin, scalar(plugin.transport, ["type", "name", "label", "value"]) || "MCP transport"],
          ["Codex", control.codex, scalar(app.process_state || app.status, ["state", "status", "process_state", "type", "value"]) || control.codex.label],
        ];
        $("overviewStatus").innerHTML = items.map((item) => '<button class="status-card" data-page="diagnostics"><div class="status-card-label">' + escapeHtml(item[0]) + '</div><div class="status-card-value"><span class="status-dot ' + statusClass(item[1]) + '"></span>' + escapeHtml(statusLabel(item[1])) + '</div><div class="status-card-note" title="' + escapeHtml(item[2]) + '">' + escapeHtml(item[2]) + '</div></button>').join("");
      }
      function taskProgressView(task) {
        if (task && isRecord(task.progress_view)) return task.progress_view;
        const status = (scalar(task && task.status, ["status", "state", "type", "value"]) || "").toUpperCase();
        const completed = status === "DONE" || status === "COMPLETED";
        const failed = status === "FAILED" || status === "ERROR";
        const progress = safeNumber(task && (task.progress_percent !== undefined ? task.progress_percent : task.progress));
        return { phase: completed ? "completed" : failed ? "failed" : "executing", phase_label: completed ? "已完成" : failed ? "执行失败" : "执行中", category: "unclassified", category_label: "未分类", progress: completed ? 100 : progress, progress_known: progress !== null || completed, current_action: scalar(task && task.current_action, ["current_action", "label", "value"]), next_action: scalar(task && (task.next_action || task.next_step), ["next_action", "next_step", "label", "value"]), completed_at: scalar(task && task.completed_at), result_summary: scalar(task && (task.result_summary || task.final_answer), ["result_summary", "final_answer", "summary", "text", "value"]), output_locations: [], failure_stage: failed ? scalar(task && task.stage, ["stage", "phase", "label", "value"]) : null, failure_reason: failed ? scalar(task && task.last_error, ["last_error", "error", "message", "value"]) : null, last_successful_step: null, steps: [] };
      }
      function completionTime(value) {
        const timestamp = normalizeTimestamp(value); return timestamp === null ? "未报告" : new Date(timestamp).toLocaleString();
      }
      function taskOutputLocations(task, view) {
        const fromView = Array.isArray(view && view.output_locations) ? view.output_locations : [];
        const fromTask = [].concat(Array.isArray(task && task.output_files) ? task.output_files : [], Array.isArray(task && task.output_directories) ? task.output_directories : []);
        return fromView.concat(fromTask).map((value) => scalar(value, ["path", "fullPath", "absolutePath", "value"])).filter(Boolean).filter((value, index, all) => all.indexOf(value) === index);
      }
      function progressStepMarkup(step) {
        const status = (scalar(step && step.status, ["status", "state", "value"]) || "pending").toLowerCase();
        const marker = status === "completed" ? "✓" : status === "current" ? "●" : status === "failed" ? "✕" : "○";
        return '<li class="task-progress-step ' + escapeHtml(status) + '"><span class="step-marker">' + marker + '</span><span>' + escapeHtml(scalar(step && step.label, ["label", "name", "value"]) || "阶段") + '</span></li>';
      }
      function taskCancelled(task) { return task && task.cancelled === true || scalar(task && task.last_error, ["last_error", "error", "message", "value"]) === "任务已取消"; }
      function taskDisplayStatus(task) {
        if (task && task.cancel_requested === true) return "CANCEL_REQUESTED";
        if (taskCancelled(task)) return "CANCELLED";
        return task && task.status;
      }
      function isAgentTask(task) { return task && scalar(task.execution_source, ["execution_source", "source", "type", "value"]) === "bridge"; }
      function renderTaskProgressPanel(task) {
        const view = taskProgressView(task); const recovery = view && view.phase === "recovery"; const percentage = safeNumber(view && view.progress); const known = view && view.progress_known === true && percentage !== null; const bounded = known ? Math.max(0, Math.min(100, Math.round(percentage))) : null; const cancelRequested = task && task.cancel_requested === true; const cancelled = taskCancelled(task); const phase = cancelRequested ? "取消中" : cancelled ? "已取消" : scalar(view && view.phase_label, ["phase_label", "label", "value"]) || "正在处理"; const category = scalar(view && view.category_label, ["category_label", "label", "value"]) || "未分类"; const steps = Array.isArray(view && view.steps) ? view.steps : []; const progressText = recovery ? "需要处理" : known ? bounded + "%" : "进行中"; const trackClass = recovery ? "task-progress-track recovery" : known ? "task-progress-track" : "task-progress-track indeterminate"; const fillStyle = recovery ? "" : known ? ' style="width:' + bounded + '%"' : ""; const stepsMarkup = steps.length ? '<ul class="task-progress-steps">' + steps.map(progressStepMarkup).join("") + '</ul>' : ""; const next = scalar(view && view.next_action, ["next_action", "label", "value"]); const status = (scalar(taskDisplayStatus(task), ["status", "state", "type", "value"]) || "").toUpperCase(); const completed = status === "DONE" || status === "COMPLETED" || view.phase === "completed"; const failed = !cancelRequested && !cancelled && (status === "FAILED" || status === "ERROR" || view.phase === "failed"); const summary = scalar(view && view.result_summary, ["result_summary", "final_answer", "summary", "text", "value"]); const locations = taskOutputLocations(task, view); const completedAt = view && view.completed_at || task && task.completed_at; const failureStage = scalar(view && view.failure_stage, ["failure_stage", "stage", "label", "value"]); const failureReason = scalar(view && view.failure_reason, ["failure_reason", "last_error", "error", "message", "value"]); const lastSuccess = scalar(view && view.last_successful_step, ["last_successful_step", "label", "value"]);
        const outcome = completed ? '<div class="task-outcome"><div class="task-outcome-grid"><div><div class="detail-label">完成时间</div><div class="detail-value">' + escapeHtml(completionTime(completedAt)) + '</div></div><div><div class="detail-label">输出摘要</div><div class="detail-value">' + escapeHtml(summary || "暂无输出摘要") + '</div></div>' + (locations.length ? '<div class="wide"><div class="detail-label">输出位置</div><div class="task-output-location" title="' + escapeHtml(locations.join("\n")) + '">' + escapeHtml(locations.join(" · ")) + '</div></div>' : "") + '</div></div>' : "";
        const failure = failed ? '<div class="task-failure"><div class="detail-label">失败阶段</div><div class="detail-value">' + escapeHtml(failureStage || phase) + '</div><div class="detail-label" style="margin-top:8px">错误原因</div><div class="detail-value">' + escapeHtml(failureReason || "未报告具体原因") + '</div>' + (lastSuccess ? '<div class="detail-label" style="margin-top:8px">最后成功步骤</div><div class="detail-value">' + escapeHtml(lastSuccess) + '</div>' : "") + '</div>' : "";
        return '<div class="task-progress-panel"><div class="task-progress-heading"><span class="detail-label">当前阶段</span><span class="task-progress-percent">' + escapeHtml(progressText) + '</span></div><div class="task-progress-stage">' + escapeHtml(phase) + '</div><div class="' + trackClass + '"><div class="task-progress-fill"' + fillStyle + '></div></div><div class="task-progress-category">任务分类：' + escapeHtml(category) + '</div>' + stepsMarkup + (next && !completed && !failed ? '<div class="task-progress-next">下一步：' + escapeHtml(next) + '</div>' : "") + outcome + failure + '</div>';
      }
      function renderOverviewActive() {
        const active = activeTasks(currentStatus());
        $("overviewActiveCaption").textContent = active.length ? active.length + " 项" : "保持干净";
        if (!active.length) { $("overviewActive").innerHTML = '<div class="empty-state"><strong>当前没有正在执行的任务</strong>ChatGPT 或 AGENTS 新任务会在这里显示。</div>'; return; }
        $("overviewActive").innerHTML = '<div class="item-list">' + active.slice(0, 8).map((task) => {
          const isNative = taskKind(task).startsWith("Native");
          const id = scalar(task.id, ["id", "task_id"]) || ""; const title = scalar(task.name || task.title, ["name", "title", "label"]) || "未命名任务"; const cwd = shortenPath(task.cwd) || "未报告"; const turnId = scalar(task.turn_id, ["id", "turn_id"]);
          return '<div class="task-row"><div class="task-row-head"><div><div class="row-title" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</div><div class="task-kind">' + escapeHtml(taskKind(task)) + '</div></div>' + makeBadge(taskDisplayStatus(task)) + '</div>' + renderTaskProgressPanel(task) + '<div class="task-detail"><div class="wide"><div class="detail-label">工作目录</div><div class="detail-value" title="' + escapeHtml(scalar(task.cwd, ["path", "fullPath", "absolutePath", "cwd", "value"]) || "") + '">' + escapeHtml(cwd) + '</div></div></div><div class="task-actions"><button class="secondary-button" data-task-view="' + escapeHtml(id) + '" data-native="' + (isNative ? "true" : "false") + '">查看详情</button>' + (turnId ? '<button class="secondary-button" data-task-stop="' + escapeHtml(id) + '">停止</button>' : (!isNative && isAgentTask(task) && !task.cancel_requested && !taskCancelled(task) ? '<button class="secondary-button" data-task-cancel="' + escapeHtml(id) + '">取消任务</button>' : "")) + '</div></div>'; }).join("") + '</div>';
      }
      function renderAgentMetrics() {
        const control = controlCenterState(currentStatus()); const active = Number(control.agentJobs && control.agentJobs.running || 0); const max = Number(control.agentJobs && control.agentJobs.max || 5); const queued = Number(control.agentJobs && control.agentJobs.queued || 0); const recentFailures = Number(control.agentJobs && control.agentJobs.recentFailures || 0); const failureValue = recentFailures > 0 ? String(recentFailures) : "无"; const failureClass = recentFailures > 0 ? " warn" : "";
        const html = '<div class="metric"><div class="metric-label">运行中</div><div class="metric-value">' + active + ' / ' + max + '</div><div class="metric-note">Worker</div></div><div class="metric"><div class="metric-label">等待</div><div class="metric-value">' + queued + '</div><div class="metric-note">Queue</div></div><div class="metric"><div class="metric-label">最近失败</div><div class="metric-value' + failureClass + '">' + escapeHtml(failureValue) + '</div><div class="metric-note">24 小时内</div></div>';
        $("overviewAgents").innerHTML = html; $("agentsMetrics").innerHTML = html; $("navAgentCount").textContent = active + " / " + max;
      }
      function renderTaskCard(task) {
        const events = Array.isArray(task.events) ? task.events : [];
        const title = scalar(task.name || task.title, ["name", "title", "label"]) || "未命名任务"; const finalAnswer = scalar(task.final_answer || task.finalAnswer || task.result_summary || task.summary, ["text", "content", "summary", "message", "value"]) || ""; const next = scalar(task.next_action || task.next_step, ["text", "content", "label", "value"]) || ""; const recovery = (scalar(task.status, ["status", "state", "type", "value"]) || "").toUpperCase() === "RECOVERY_REQUIRED";
        return '<article class="task-row"><div class="task-row-head"><div><div class="row-title" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</div><div class="task-kind">' + escapeHtml(taskKind(task)) + '</div></div>' + makeBadge(taskDisplayStatus(task)) + '</div>' + renderTaskProgressPanel(task) + '<div class="task-detail"><div><div class="detail-label">状态</div><div class="detail-value">' + escapeHtml(taskStatusLabel(taskDisplayStatus(task))) + '</div></div><div><div class="detail-label">最终结果</div><div class="detail-value">' + escapeHtml(finalAnswer || "暂无结果摘要") + '</div></div></div>' + (next ? '<div class="next-step"><span class="detail-label">下一步</span><div class="detail-value">' + escapeHtml(next) + '</div></div>' : "") + '<div class="task-actions"><button class="secondary-button" data-task-view="' + escapeHtml(scalar(task.id, ["id", "task_id"]) || "") + '" data-native="false">查看详情</button>' + (isAgentTask(task) && !task.cancel_requested && !taskCancelled(task) && !["DONE", "COMPLETED", "FAILED", "INTERRUPTED", "BLOCKED"].includes((scalar(task.status, ["status", "state", "type", "value"]) || "").toUpperCase()) ? '<button class="secondary-button" data-task-cancel="' + escapeHtml(scalar(task.id, ["id", "task_id"]) || "") + '">' + (recovery ? "结束任务" : "取消任务") + '</button>' : "") + '</div><details class="execution-details"><summary>展开执行详情</summary><div class="timeline-list">' + (events.length ? events.slice(-20).map((event) => '<div class="timeline-entry">' + escapeHtml(scalar(event && (event.timestamp || event.at), ["timestamp", "at", "value"]) || "") + ' · ' + escapeHtml(scalar(event && (event.stage || event.type), ["stage", "type", "label", "value"]) || "event") + ' · ' + escapeHtml(scalar(event && (event.message || event.current_action), ["message", "current_action", "text", "value"]) || "") + '</div>').join("") : '<div class="timeline-entry">暂无事件时间线。</div>') + '</div></details></article>';
      }
      function renderAgentTasks() {
        const data = currentStatus(); const tasks = data.tasks || {}; const items = [].concat(Array.isArray(tasks.active) ? tasks.active : [], Array.isArray(tasks.waiting) ? tasks.waiting : [], Array.isArray(tasks.attention) ? tasks.attention : [], Array.isArray(tasks.recent_completed) ? tasks.recent_completed : []);
        $("agentTasks").innerHTML = items.length ? '<div class="item-list">' + items.slice(0, 30).map(renderTaskCard).join("") + '</div>' : '<div class="empty-state"><strong>暂无 AGENTS 任务</strong>点击“新建独立任务”提交一个 ephemeral Codex 工作。</div>';
      }
      function renderTaskDetailDrawer() {
        const drawer = $("taskDetailDrawer"); const content = $("taskDetailContent"); if (!drawer || !content) return;
        if (!state.taskDetails.selectedId) { drawer.classList.add("hidden"); return; }
        drawer.classList.remove("hidden");
        if (state.taskDetails.loading && !state.taskDetails.data) { content.innerHTML = '<div class="empty-state">正在读取任务详情…</div>'; return; }
        if (state.taskDetails.error) { content.innerHTML = '<div class="empty-state"><strong>任务详情读取失败</strong>' + escapeHtml(state.taskDetails.error) + '</div>'; return; }
        const data = state.taskDetails.data; const task = data && isRecord(data.task) ? data.task : null;
        if (!task) { content.innerHTML = '<div class="empty-state">暂无任务详情。</div>'; return; }
        const progress = taskProgressView(task); const events = Array.isArray(data.events) ? data.events : Array.isArray(task.events) ? task.events : []; const input = scalar(data.input, ["input", "text", "value"]) || "当前运行记录未保留原始输入内容"; const cwd = scalar(task.cwd, ["path", "fullPath", "absolutePath", "cwd", "value"]) || "未报告"; const status = taskStatusLabel(taskDisplayStatus(task)); const phase = scalar(progress && progress.phase_label, ["phase_label", "label", "value"]) || scalar(task.stage, ["stage", "phase", "label", "value"]) || "未报告"; const output = data && isRecord(data.output) ? data.output : {}; const summary = scalar(output.summary || progress && progress.result_summary || task.result_summary || task.final_answer, ["summary", "result_summary", "final_answer", "text", "value"]) || "暂无输出结果"; const locations = taskOutputLocations(task, progress); const error = scalar(data && data.error || task.last_error, ["error", "last_error", "message", "value"]); const terminal = ["DONE", "COMPLETED", "FAILED", "INTERRUPTED", "BLOCKED"].includes((scalar(task.status, ["status", "state", "type", "value"]) || "").toUpperCase()) || taskCancelled(task); const canCancel = isAgentTask(task) && !terminal && task.cancel_requested !== true; const eventMarkup = events.length ? '<div class="task-detail-events">' + events.slice(-20).map((event) => '<div class="task-detail-event"><div class="task-detail-event-meta">' + escapeHtml(formatTime(event && (event.timestamp || event.at))) + ' · ' + escapeHtml(scalar(event && (event.stage || event.type), ["stage", "type", "label", "value"]) || "事件") + '</div><div>' + escapeHtml(scalar(event && (event.message || event.current_action), ["message", "current_action", "text", "value"]) || "无事件说明") + '</div></div>').join("") + '</div>' : '<div class="empty-state">暂无最近事件。</div>';
        content.innerHTML = '<div class="task-detail-grid"><div class="detail-label">task_id</div><div class="detail-value" title="' + escapeHtml(scalar(task.id, ["id", "task_id"]) || state.taskDetails.selectedId) + '">' + escapeHtml(scalar(task.id, ["id", "task_id"]) || state.taskDetails.selectedId) + '</div><div class="detail-label">创建时间</div><div class="detail-value">' + escapeHtml(completionTime(task.created_at)) + '</div><div class="detail-label">当前状态</div><div class="detail-value">' + escapeHtml(status) + '</div><div class="detail-label">当前阶段</div><div class="detail-value">' + escapeHtml(phase) + '</div><div class="detail-label">工作目录</div><div class="detail-value" title="' + escapeHtml(cwd) + '">' + escapeHtml(cwd) + '</div></div><div class="task-detail-section"><div class="detail-label">输入任务</div><div class="detail-text" style="margin-top:6px">' + escapeHtml(input) + '</div></div><div class="task-detail-section"><div class="detail-label">最近事件</div>' + eventMarkup + '</div><div class="task-detail-section"><div class="detail-label">输出结果</div><div class="detail-value" style="margin-top:6px">' + escapeHtml(summary) + '</div>' + (locations.length ? '<div class="task-output-location" style="margin-top:7px" title="' + escapeHtml(locations.join("\n")) + '">' + escapeHtml(locations.join(" · ")) + '</div>' : '') + '</div><div class="task-detail-section"><div class="detail-label">错误信息</div><div class="detail-value" style="margin-top:6px">' + escapeHtml(error || "无") + '</div></div><div class="task-actions">' + (canCancel ? '<button class="secondary-button" data-task-cancel="' + escapeHtml(state.taskDetails.selectedId) + '">' + (status === "需要处理" ? "结束任务" : "取消任务") + '</button>' : task.cancel_requested === true ? '<button class="secondary-button" disabled>取消中…</button>' : '') + '</div>';
      }
      async function openTaskDetails(id) {
        if (!id) return;
        state.taskDetails = { selectedId: id, data: null, loading: true, error: null, cancelRequested: false }; renderTaskDetailDrawer();
        try { const data = await fetchJson("/api/service-codex/tasks/" + encodeURIComponent(id)); if (state.taskDetails.selectedId === id) { state.taskDetails.data = data; state.taskDetails.cancelRequested = data && data.cancel_requested === true; } }
        catch (error) { if (state.taskDetails.selectedId === id) state.taskDetails.error = String(error && error.message || error); }
        finally { if (state.taskDetails.selectedId === id) { state.taskDetails.loading = false; render(); } }
      }
      async function waitForAgentCancellation(id) {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          if (state.taskDetails.selectedId !== id) return;
          try {
            const data = await fetchJson("/api/service-codex/tasks/" + encodeURIComponent(id)); state.taskDetails.data = data; state.taskDetails.cancelRequested = data && data.cancel_requested === true; renderTaskDetailDrawer();
            const task = data && isRecord(data.task) ? data.task : null; const status = (scalar(task && task.status, ["status", "state", "type", "value"]) || "").toUpperCase(); if (["DONE", "COMPLETED", "FAILED", "INTERRUPTED", "BLOCKED"].includes(status) || data.cancelled === true) { await refresh(true); return; }
          } catch (_) { return; }
        }
      }
      async function cancelAgentTask(id) {
        if (!id || state.taskDetails.cancelRequested) return;
        state.taskDetails.cancelRequested = true; renderTaskDetailDrawer();
        try { const result = await fetchJson("/api/service-codex/tasks/" + encodeURIComponent(id) + "/cancel", { method: "POST" }); showToast(result && result.status === "cancel_requested" ? "正在取消任务…" : "任务已取消"); await refresh(true); await waitForAgentCancellation(id); }
        catch (error) { state.taskDetails.cancelRequested = false; showToast(String(error && error.message || error)); render(); }
      }
      function renderOverviewThreads() {
        const items = state.native.items.slice(0, 5);
        if (!state.native.loaded) { $("overviewThreads").innerHTML = '<div class="empty-state">正在读取 Native Threads…</div>'; return; }
        if (state.native.error) { $("overviewThreads").innerHTML = '<div class="empty-state"><strong>无法读取此会话列表。</strong>' + escapeHtml(state.native.error) + '</div>'; return; }
        if (!items.length) { $("overviewThreads").innerHTML = '<div class="empty-state"><strong>暂无 Native Threads</strong>ChatGPT 或原生 Codex 创建的持久会话会显示在这里。</div>'; return; }
        $("overviewThreads").innerHTML = '<div class="item-list">' + items.map((item) => renderNativeRow(item, false)).join("") + '</div>';
      }
      function renderNativeRow(item, fullPage) {
        const selected = item.id && item.id === state.native.selectedId ? " selected" : "";
        const title = scalar(item && item.title, ["title", "name", "label"]) || "未命名会话"; const cwd = scalar(item && (item.displayCwd || item.cwd), ["path", "fullPath", "absolutePath", "cwd", "value"]); const source = threadSourceLabel(item); const metadata = [taskStatusLabel(item && item.status), source, cwd].filter(Boolean); const recency = scalar(item && item.recencyLabel) || formatTime(item && item.updatedAt);
        return '<button class="list-row' + (fullPage ? " native-full-row" : "") + selected + '" data-native-id="' + escapeHtml(item && item.id || "") + '"><div><div class="row-title" title="' + escapeHtml(title) + '"><span class="status-dot ' + statusClass(item && item.status) + '"></span> ' + escapeHtml(title) + '</div><div class="row-meta">' + metadata.map((value) => '<span title="' + escapeHtml(value) + '">' + escapeHtml(value) + '</span>').join("") + '</div></div><div class="row-right">' + escapeHtml(recency) + '</div></button>';
      }
      function filteredNativeItems() {
        const filter = state.native.filter;
        return state.native.items.filter((item) => {
          if (filter === "running") return /run|active|thinking|working/i.test(item.status);
          if (filter === "recent") return true;
          if (filter === "bridge") return item.source ? /bridge/i.test(item.source) : false;
          if (filter === "native") return item.source ? /native|codex|cli/i.test(item.source) : false;
          return true;
        });
      }
      function renderNativeList() {
        const items = filteredNativeItems();
        $("nativeListCaption").textContent = state.native.error ? "thread/list 读取失败" : (items.length ? items.length + " 条 · 官方 thread/list" : "官方 thread/list");
        if (state.native.loading && !state.native.loaded) { $("nativeList").innerHTML = '<div class="empty-state">正在读取 Native Threads…</div>'; return; }
        if (state.native.error) { $("nativeList").innerHTML = '<div class="empty-state"><strong>无法读取此会话。</strong>' + escapeHtml(state.native.error) + '</div>'; return; }
        if (!items.length && (state.native.filter === "bridge" || state.native.filter === "native")) { $("nativeList").innerHTML = '<div class="empty-state"><strong>没有可确认来源的会话</strong>当前 thread/list 未报告可靠来源字段。</div>'; return; }
        if (!items.length) { $("nativeList").innerHTML = '<div class="empty-state"><strong>暂无 Native Threads</strong>ChatGPT 或原生 Codex 创建的持久会话会显示在这里。</div>'; return; }
        $("nativeList").innerHTML = items.map((item) => renderNativeRow(item, true)).join(""); $("nativeNext").disabled = !state.native.nextCursor || state.native.loading;
      }
      function detailThread(value) { return value && isRecord(value.thread) ? value.thread : isRecord(value) ? value : {}; }
      function turnContent(turn) { return isRecord(turn) ? scalar(firstValue(turn, ["final_answer", "finalAnswer", "text", "content", "summary", "message", "output"]), ["text", "content", "summary", "message", "output", "value"]) || "" : ""; }
      function historyItemLabel(item) {
        const type = (scalar(item && item.item_type, ["item_type", "type", "value"]) || "").toLowerCase();
        const labels = { usermessage: "用户", agentmessage: "Codex", reasoning: "推理", commandexecution: "命令执行", filechange: "文件变更", websearch: "搜索", mcptoolcall: "MCP 工具", imagegeneration: "图片生成", dynamictoolcall: "工具调用" };
        return labels[type] || scalar(item && item.item_type, ["item_type", "type", "label", "value"]) || "历史项";
      }
      function renderNativeHistory() {
        const history = state.native.history || { items: [], nextCursor: null, loaded: false, loading: false, error: null };
        if (history.loading && !history.loaded) return '<div class="empty-state">正在加载历史内容…</div>';
        if (history.error) return '<div class="empty-state"><strong>历史内容读取失败</strong>' + escapeHtml(history.error) + '</div>';
        if (!history.loaded) return '<div class="empty-state">历史内容尚未加载。</div>';
        const items = Array.isArray(history.items) ? history.items : [];
        const itemMarkup = items.length ? items.map((item) => {
          const when = scalar(item && item.created_at) || formatTime(item && item.created_at);
          const textValue = scalar(item && item.text, ["text", "value"]) || "（该历史项没有可显示的文本摘要）";
          const suffix = item && item.truncated ? " · 大型数据已省略" : "";
          return '<div class="turn-item"><div class="turn-role">' + escapeHtml(historyItemLabel(item)) + ' · ' + escapeHtml(when) + escapeHtml(suffix) + '</div><div class="turn-content">' + escapeHtml(textValue) + '</div></div>';
        }).join("") : '<div class="empty-state">暂无可显示的历史内容。</div>';
        const more = history.nextCursor ? '<div class="history-more"><button class="secondary-button" id="nativeHistoryMore" type="button">加载更早内容</button></div>' : '';
        return '<div class="history-note">历史较大，已分页加载；需要时可继续加载更早内容。</div><div class="turn-list" style="margin-top:9px">' + itemMarkup + '</div>' + more;
      }
      function renderNativeDetail() {
        const item = state.native.items.find((candidate) => candidate.id === state.native.selectedId);
        const detail = state.native.detail; const root = detailThread(detail || item && item.raw); const summary = threadSummary(detail || item && item.raw); const id = state.native.selectedId || summary.id;
        $("nativeDetailStatus").textContent = id ? taskStatusLabel(summary.status || "idle") : "未选择";
        if (!id) { $("nativeDetail").innerHTML = '<div class="empty-state"><strong>选择一个 Native Thread</strong>点击列表项查看基本信息、最近内容和可用操作。</div>'; return; }
        if (!detail) { $("nativeDetail").innerHTML = '<div class="empty-state">正在读取 thread/read…</div>'; return; }
        const activeTask = activeTasks(currentStatus()).find((task) => scalar(task && task.thread_id, ["id", "thread_id"]) === id);
        const currentTurnId = scalar(activeTask && activeTask.turn_id, ["id", "turn_id"]) || scalar(root.turn_id || root.active_turn_id, ["id", "turn_id", "active_turn_id"]) || "";
        const source = threadSourceLabel(summary); const sourceMarkup = source ? '<div><div class="detail-label">来源</div><div class="detail-value">' + escapeHtml(source) + '</div></div>' : ""; const detailCwd = summary.cwd || "";
        $("nativeDetail").innerHTML = '<div class="detail-grid"><div><div class="detail-label">标题</div><div class="detail-value">' + escapeHtml(summary.title) + '</div></div><div><div class="detail-label">状态</div><div class="detail-value">' + makeBadge(summary.status) + '</div></div><div><div class="detail-label">Thread ID</div><div class="detail-value" title="' + escapeHtml(id) + '">' + escapeHtml(id) + '</div></div><div><div class="detail-label">更新时间</div><div class="detail-value">' + escapeHtml(summary.recencyLabel || formatTime(summary.updatedAt)) + '</div></div><div class="wide"><div class="detail-label">工作目录</div><div class="detail-value" title="' + escapeHtml(detailCwd) + '">' + escapeHtml(summary.displayCwd || detailCwd || "未报告") + '</div></div><div><div class="detail-label">模型</div><div class="detail-value">' + escapeHtml(summary.model || "未报告") + '</div></div>' + sourceMarkup + '</div><div class="task-actions"><button class="secondary-button" id="copyThreadId">复制 Thread ID</button>' + (currentTurnId ? '<button class="secondary-button" id="interruptNative">停止当前 Turn</button>' : "") + '</div><div style="margin-top:18px"><div class="detail-label">最近历史内容</div>' + renderNativeHistory() + '</div><form class="composer" id="nativeContinueForm" style="margin-top:18px"><label class="field-label" for="nativeContinuePrompt">继续这个线程</label><textarea class="composer-textarea" id="nativeContinuePrompt" style="min-height:86px" placeholder="给这个 Codex thread 继续发送内容…"></textarea><button class="primary-button" type="submit">继续这个线程</button></form>';
        const copy = $("copyThreadId"); if (copy) copy.addEventListener("click", async () => { showToast(await copyText(id) ? "Thread ID 已复制" : "无法复制 Thread ID"); });
        const stop = $("interruptNative"); if (stop) stop.addEventListener("click", () => void interruptNative(id, currentTurnId));
        const form = $("nativeContinueForm"); if (form) form.addEventListener("submit", (event) => void continueNative(event, id));
        const more = $("nativeHistoryMore"); if (more) more.addEventListener("click", () => void loadNativeHistory(id, false));
      }
      function renderDiagnostics(data) {
        const value = payloadOf(data); const control = controlCenterState(value); const build = isRecord(value.build) ? value.build : {}; const tunnel = isRecord(value.tunnel) ? value.tunnel : {}; const plugin = isRecord(value.plugin_bridge) ? value.plugin_bridge : {}; const app = isRecord(value.app_server) ? value.app_server : (isRecord(value.appServer) ? value.appServer : {});
        const rows = {
          diagnosticBuild: [scalar(build.label) || "构建信息未报告"],
          diagnosticUiBundleHash: [shortHash(build.ui_bundle_sha256, scalar(build.ui_bundle) || "UI bundle")],
          diagnosticExeHash: [shortHash(build.executable_sha256, scalar(build.executable) || "EXE")],
          diagnosticLoadedAssetHash: [shortHash(build.loaded_asset_sha256, scalar(build.loaded_asset) || "Loaded asset")],
          diagnosticBridge: [control.bridge.label],
          diagnosticTunnel: [control.tunnel.label],
          diagnosticTunnelRegistration: [statusLabel(control.tunnel.registration)],
          diagnosticTunnelId: [scalar(tunnel.active_tunnel_id, ["id", "tunnel_id", "value"]) || "未报告"],
          diagnosticPlugin: [control.plugin.label],
          diagnosticAppServer: [statusLabel(subsystemState(app.process_state || app.status || "not_started", "codex"))],
          diagnosticNative: [control.codex.label],
          diagnosticTunnelVersion: [scalar(tunnel.client_version) || "未报告"],
          diagnosticWorkers: [String(Number(control.agentJobs && control.agentJobs.running || 0) + " / " + Number(control.agentJobs && control.agentJobs.max || 5))],
          diagnosticQueue: [String(Number(control.queue && control.queue.depth || 0))],
          diagnosticPending: [String(Number(control.queue && control.queue.pending || 0))],
          diagnosticPorts: [control.tunnel.state === "ready" ? "正常" : "待确认"],
          diagnosticLastError: [scalar(tunnel.last_registration_error || plugin.last_error || app.last_error, ["message", "error", "code", "value"]) || "无"],
        };
        Object.keys(rows).forEach((id) => { const element = $(id); if (!element) return; const item = scalar(rows[id][0]) || "未报告"; element.textContent = item; element.className = "diagnostic-value " + statusClass(item); });
        $("diagnosticUpdated").textContent = "更新于 " + new Date().toLocaleTimeString();
      }
      function render() {
        renderTopStatus(); renderStatusOverview(); renderOverviewActive(); renderAgentMetrics(); renderAgentTasks(); renderOverviewThreads(); renderNativeList(); renderNativeDetail(); renderScheduledTasks(); renderTaskDetailDrawer();
        if (state.diagnostics) renderDiagnostics(state.diagnostics); else if (state.page === "diagnostics") renderDiagnostics(currentStatus());
        $("agentComposerWrap").classList.toggle("hidden", !state.agentComposerOpen); $("nativeComposerWrap").classList.toggle("hidden", !state.nativeComposerOpen);
      }
      async function loadSnapshot() { state.status = await fetchJson("/api/status"); return state.status; }
      async function loadSessions() { try { state.sessions = await fetchJson("/api/service-sessions"); } catch (_) { state.sessions = null; } return state.sessions; }
      async function loadScheduledTasks() {
        if (state.scheduled.loading) return;
        state.scheduled.loading = true; renderScheduledTasks();
        try {
          const result = await fetchJson("/api/scheduled-tasks");
          state.scheduled.items = Array.isArray(result && result.items) ? result.items : [];
          state.scheduled.available = result && result.available === true;
          state.scheduled.source = scalar(result && result.source);
          state.scheduled.error = result && result.error ? scalar(result.error) : null;
          state.scheduled.loaded = true;
        } catch (error) { state.scheduled.error = String(error && error.message || error); state.scheduled.loaded = true; state.scheduled.available = false; }
        finally { state.scheduled.loading = false; render(); }
      }
      async function loadNativeThreads(reset) {
        if (state.native.loading) return;
        if (reset) { state.native.nextCursor = null; state.native.loaded = false; state.native.error = null; }
        state.native.loading = true; renderNativeList();
        try {
          const params = new URLSearchParams(); params.set("limit", "20"); if (state.native.search) params.set("search", state.native.search); if (!reset && state.native.nextCursor) params.set("cursor", state.native.nextCursor);
          const result = await fetchJson("/api/native-threads?" + params.toString());
          const values = Array.isArray(result && result.data) ? result.data.map(threadSummary) : [];
          state.native.items = reset ? values : state.native.items.concat(values); state.native.nextCursor = result && result.nextCursor || null; state.native.loaded = true; state.native.error = null;
        } catch (error) { state.native.error = String(error && error.message || error); state.native.loaded = true; }
        finally { state.native.loading = false; render(); }
      }
      async function loadNativeHistory(id, reset) {
        if (state.native.history.loading) return;
        if (reset) state.native.history = { items: [], nextCursor: null, loaded: false, loading: false, error: null };
        const cursor = reset ? null : state.native.history.nextCursor;
        state.native.history.loading = true; renderNativeDetail();
        try {
          const params = new URLSearchParams(); params.set("limit", "20"); if (cursor) params.set("cursor", cursor);
          const result = await fetchJson("/api/native-threads/" + encodeURIComponent(id) + "/history?" + params.toString());
          if (state.native.selectedId !== id) return;
          const values = Array.isArray(result && result.items) ? result.items : [];
          state.native.history.items = reset ? values : state.native.history.items.concat(values);
          state.native.history.nextCursor = result && typeof result.next_cursor === "string" ? result.next_cursor : null;
          state.native.history.loaded = true; state.native.history.error = result && result.error ? scalar(result.error) : null;
        } catch (error) { if (state.native.selectedId === id) { state.native.history.error = String(error && error.message || error); state.native.history.loaded = true; } }
        finally { if (state.native.selectedId === id) { state.native.history.loading = false; render(); } }
      }
      async function loadNativeDetail(id) {
        state.native.selectedId = id; state.native.detail = null; renderNativeDetail();
        const historyPromise = loadNativeHistory(id, true);
        try { state.native.detail = await fetchJson("/api/native-threads/" + encodeURIComponent(id)); }
        catch (error) { state.native.error = String(error && error.message || error); }
        await historyPromise;
        render();
      }
      async function readDiagnostics() {
        try { state.diagnostics = await fetchJson("/api/diagnostics"); if (state.diagnostics && isRecord(state.diagnostics.status)) state.status = state.diagnostics.status; renderDiagnostics(state.diagnostics); }
        catch (error) { state.diagnostics = null; renderDiagnostics(currentStatus()); showToast("诊断读取失败：" + String(error && error.message || error)); }
      }
      async function refresh(quiet) {
        if (state.loading) return;
        state.loading = true;
        try { await Promise.all([loadSnapshot(), loadSessions()]); if (!state.native.loaded || state.page === "native" || state.page === "overview") await loadNativeThreads(true); if (state.page === "diagnostics") await readDiagnostics(); render(); }
        catch (error) { if (!quiet) showToast(String(error && error.message || error)); }
        finally { state.loading = false; }
      }
      function setPage(page) {
        if (!pages[page]) return;
        state.page = page; document.querySelectorAll("[data-page-view]").forEach((element) => element.classList.toggle("active", element.dataset.pageView === page)); document.querySelectorAll(".nav-item").forEach((element) => element.classList.toggle("active", element.dataset.page === page)); $("pageTitle").textContent = pages[page];
        if ((page === "overview" || page === "native") && !state.native.loaded) void loadNativeThreads(true);
        if (page === "scheduled") void loadScheduledTasks();
        if (page === "diagnostics") void readDiagnostics();
        render();
      }
      function rememberCwd(value) { const clean = String(value || "").trim(); if (clean) { try { localStorage.setItem("localCodexBridge.recentCwd", clean); } catch (_) {} } }
      function recentCwd() { try { return localStorage.getItem("localCodexBridge.recentCwd") || ""; } catch (_) { return ""; } }
      function pathInputFor(target) { return target === "native" ? $("nativeCwd") : $("cwd"); }
      function pathHintFor(target) { return target === "native" ? $("nativeCwdHint") : $("cwdHint"); }
      function setPathState(target, mode, message) { const input = pathInputFor(target); const hint = pathHintFor(target); if (!input || !hint) return; input.classList.toggle("invalid", mode === "invalid"); hint.className = "field-hint" + (mode === "warning" ? " warning" : ""); hint.textContent = message || (mode === "invalid" ? "工作目录不存在，请重新选择。" : "选择或输入项目目录"); }
      async function validateWorkingDirectory(target, showError) {
        const input = pathInputFor(target); if (!input) return false; const value = input.value.trim();
        if (!value) { setPathState(target, showError ? "invalid" : "normal", showError ? "请先选择工作目录。" : "选择或输入项目目录"); return false; }
        try { const result = await fetchJson("/api/validate-directory?path=" + encodeURIComponent(value)); if (!result || result.valid !== true) throw new Error(result && result.error || "工作目录不存在，请重新选择。"); setPathState(target, "normal", "目录有效"); rememberCwd(value); return true; }
        catch (error) { setPathState(target, showError ? "invalid" : "warning", String(error && error.message || error).includes("不存在") ? "工作目录不存在，请重新选择。" : "无法验证工作目录，请重新选择。"); return false; }
      }
      function initializeCwd(target) { const value = recentCwd(); const input = pathInputFor(target); if (!input || !value) return; input.value = value; void validateWorkingDirectory(target, false).then((valid) => { if (!valid && input.value === value) { input.value = ""; setPathState(target, "warning", "上次使用的工作目录不存在，请重新选择。"); } }); }
      function requestFolderPicker(event) {
        if (event && event.preventDefault) event.preventDefault(); if (event && event.stopPropagation) event.stopPropagation();
        state.folderTarget = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.folderTarget || "agent";
        const webview = window.chrome && window.chrome.webview;
        if (!webview || typeof webview.postMessage !== "function") { showToast("当前环境不支持文件夹选择，请手动输入工作目录。"); return; }
        try { webview.postMessage({ type: "select-folder" }); } catch (_) { showToast("当前环境不支持文件夹选择，请手动输入工作目录。"); }
      }
      function handleWebViewMessage(event) {
        let payload = event && event.data; try { if (typeof payload === "string") payload = JSON.parse(payload); } catch (_) {}
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "folder-selected" && typeof payload.path === "string") { const input = pathInputFor(state.folderTarget); if (input) input.value = payload.path; setPathState(state.folderTarget, "normal", "目录已选择，正在验证…"); void validateWorkingDirectory(state.folderTarget, true); showToast("已选择工作目录"); }
        else if (payload.type === "folder-picker-cancelled") { /* cancel is intentionally a no-op */ }
      }
      async function copyText(value) { const source = String(value || ""); try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(source); return true; } } catch (_) {} try { const helper = document.createElement("textarea"); helper.value = source; helper.style.position = "fixed"; helper.style.opacity = "0"; document.body.appendChild(helper); helper.select(); const copied = document.execCommand("copy"); helper.remove(); return copied; } catch (_) { return false; } }
      function diagnosticsSnapshot() { return state.diagnostics || state.status || {}; }
      async function submitAgentTask(event) {
        event.preventDefault(); const prompt = $("prompt").value.trim(); const cwd = $("cwd").value.trim();
        if (!prompt) { showToast("请输入任务内容。"); $("prompt").focus(); return; }
        if (!cwd) { setPathState("agent", "invalid", "请先选择工作目录。"); showToast("请先选择工作目录。"); return; }
        const button = $("sendButton"); button.disabled = true; button.textContent = "提交中…";
        try { if (!await validateWorkingDirectory("agent", true)) return; const body = { text: prompt, cwd, title: $("title").value.trim(), model: $("model").dataset.value, effort: $("effort").dataset.value, sandbox: "read-only", approval_policy: "on-request", task_type: "desktop-app" }; const result = await fetchJson("/api/service-codex/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); $("prompt").value = ""; $("title").value = ""; showToast("已提交到 AGENTS：" + (result.task_title || result.task_id || "任务")); await refresh(false); }
        catch (error) { showToast(String(error && error.message || error)); } finally { button.disabled = false; button.textContent = "发送"; }
      }
      async function submitNativeTask(event) {
        event.preventDefault(); const prompt = $("nativePrompt").value.trim(); const cwd = $("nativeCwd").value.trim();
        if (!prompt) { showToast("请输入 Native Thread 任务内容。"); $("nativePrompt").focus(); return; }
        if (!cwd) { setPathState("native", "invalid", "请先选择工作目录。"); showToast("请先选择工作目录。"); return; }
        const button = $("nativeSendButton"); button.disabled = true; button.textContent = "创建中…";
        try { if (!await validateWorkingDirectory("native", true)) return; const result = await fetchJson("/api/native-threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: prompt, cwd, title: $("nativeTitle").value.trim(), model: $("nativeModel").dataset.value, effort: $("nativeEffort").dataset.value, sandbox: "read-only", approval_policy: "on-request" }) }); $("nativePrompt").value = ""; $("nativeTitle").value = ""; state.nativeComposerOpen = false; showToast("已创建 Native Thread：" + (result.thread_id || "已接受")); await loadNativeThreads(true); }
        catch (error) { showToast(String(error && error.message || error)); } finally { button.disabled = false; button.textContent = "创建会话"; }
      }
      async function continueNative(event, id) {
        event.preventDefault(); const input = $("nativeContinuePrompt"); const value = input && input.value.trim(); if (!value) { showToast("请输入要继续的内容。"); return; }
        try { const result = await fetchJson("/api/native-threads/" + encodeURIComponent(id) + "/continue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: value }) }); input.value = ""; showToast("已继续这个线程：" + (result.turn_id || "已接受")); await loadNativeDetail(id); }
        catch (error) { showToast(String(error && error.message || error)); }
      }
      async function interruptNative(id, turnId) { try { await fetchJson("/api/native-threads/" + encodeURIComponent(id) + "/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turn_id: turnId }) }); showToast("已请求停止当前 Turn"); await loadNativeDetail(id); } catch (error) { showToast(String(error && error.message || error)); } }
      function scheduleRefresh() { if (refreshTimer) return; refreshTimer = window.setTimeout(() => { refreshTimer = null; void refresh(true); }, 120); }
      function connectEvents() { if (!window.EventSource) return; eventSource = new EventSource("/api/events"); eventSource.addEventListener("change", scheduleRefresh); eventSource.onerror = () => { $("connectionNote").textContent = "事件流重连中"; }; }
      document.querySelectorAll("[data-native-filter]").forEach((element) => element.addEventListener("click", () => { state.native.filter = element.dataset.nativeFilter || "all"; document.querySelectorAll("[data-native-filter]").forEach((candidate) => candidate.classList.toggle("active", candidate === element)); renderNativeList(); }));
      $("nativeSearchButton").addEventListener("click", () => { state.native.search = $("nativeSearch").value.trim(); void loadNativeThreads(true); });
      $("nativeSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); state.native.search = $("nativeSearch").value.trim(); void loadNativeThreads(true); } });
      $("nativeRefresh").addEventListener("click", () => void loadNativeThreads(true)); $("nativeNext").addEventListener("click", () => void loadNativeThreads(false));
      $("scheduledRefresh").addEventListener("click", () => void loadScheduledTasks());
      $("newNativeThread").addEventListener("click", () => { state.nativeComposerOpen = true; render(); window.setTimeout(() => $("nativePrompt").focus(), 0); }); $("closeNativeComposer").addEventListener("click", () => { state.nativeComposerOpen = false; render(); }); $("nativeComposer").addEventListener("submit", submitNativeTask);
      $("newAgentTask").addEventListener("click", () => { state.agentComposerOpen = true; render(); window.setTimeout(() => $("prompt").focus(), 0); }); $("closeAgentComposer").addEventListener("click", () => { state.agentComposerOpen = false; render(); }); $("composer").addEventListener("submit", submitAgentTask);
      $("pickCwd").dataset.folderTarget = "agent"; $("pickNativeCwd").dataset.folderTarget = "native"; $("pickCwd").addEventListener("click", requestFolderPicker); $("pickNativeCwd").addEventListener("click", requestFolderPicker);
      $("cwd").addEventListener("input", () => setPathState("agent", "normal", "选择或输入项目目录")); $("cwd").addEventListener("blur", () => void validateWorkingDirectory("agent", false)); $("nativeCwd").addEventListener("input", () => setPathState("native", "normal", "选择或输入项目目录")); $("nativeCwd").addEventListener("blur", () => void validateWorkingDirectory("native", false));
      $("refreshDiagnostics").addEventListener("click", () => void readDiagnostics()); $("copyDiagnostics").addEventListener("click", async () => showToast(await copyText(JSON.stringify(diagnosticsSnapshot(), null, 2)) ? "诊断信息已复制" : "无法复制诊断信息")); $("copyRawDiagnostics").addEventListener("click", async () => showToast(await copyText(JSON.stringify(diagnosticsSnapshot(), null, 2)) ? "JSON 已复制" : "无法复制 JSON"));
      $("rawDiagnostics").addEventListener("toggle", () => { if ($("rawDiagnostics").open) { $("diagnosticsContent").textContent = JSON.stringify(diagnosticsSnapshot(), null, 2); } });
      $("closeTaskDetail").addEventListener("click", () => { state.taskDetails = { selectedId: null, data: null, loading: false, error: null, cancelRequested: false }; render(); });
      if (window.chrome && window.chrome.webview) window.chrome.webview.addEventListener("message", handleWebViewMessage);
      window.addEventListener("focus", () => { if (state.page === "native" || state.page === "overview") void loadNativeThreads(true); }); window.addEventListener("beforeunload", () => { if (eventSource) eventSource.close(); }); document.addEventListener("visibilitychange", () => { if (!document.hidden && (state.page === "native" || state.page === "overview")) void loadNativeThreads(true); });
      document.addEventListener("click", (event) => { const cancelTarget = event.target.closest && event.target.closest("[data-task-cancel]"); if (cancelTarget) { event.preventDefault(); event.stopPropagation(); void cancelAgentTask(cancelTarget.dataset.taskCancel); return; } const detailTarget = event.target.closest && event.target.closest("[data-task-view]"); if (detailTarget && detailTarget.dataset.native !== "true") { event.preventDefault(); event.stopPropagation(); void openTaskDetails(detailTarget.dataset.taskView); return; } const pageTarget = event.target.closest && event.target.closest("[data-page]"); if (pageTarget) { setPage(pageTarget.dataset.page); return; } const target = event.target.closest && event.target.closest("[data-native-id]"); if (target) void loadNativeDetail(target.dataset.nativeId); });
      document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.taskDetails.selectedId) { state.taskDetails = { selectedId: null, data: null, loading: false, error: null, cancelRequested: false }; render(); } });
      initializeCwd("agent"); initializeCwd("native");
      document.documentElement.dataset.controlCenterReady = "true";
      void refresh(false).then(connectEvents);
    })();
  </script>
</body>
</html>`;
