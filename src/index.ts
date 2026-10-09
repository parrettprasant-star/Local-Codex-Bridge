import { AppServerManager } from "./app-server.js";
import { CodexAppServerAdapter } from "./app-server-adapter.js";
import { CodexTaskSync } from "./codex-task-sync.js";
import { McpStdioServer } from "./mcp.js";
import { McpHealthState } from "./mcp-health.js";
import { ModelGuard } from "./model-guard.js";
import { NativeStateReconciler } from "./native-state-reconciler.js";
import { sanitizeForTransport } from "./runtime.js";
import { RuntimeStore } from "./runtime.js";
import { EphemeralTaskScheduler, type BridgeTaskScheduler } from "./ephemeral-scheduler.js";
import {
  resolveTaskManagerFile,
  TaskManager,
} from "./task-manager.js";
import { TaskRuntime } from "./task-runtime.js";
import { TaskService } from "./task-service.js";
import {
  resolveTaskStatusFile,
  resolveTaskStatusPort,
  TaskStatusStore,
} from "./task-status.js";
import { TaskStatusServer } from "./status-server.js";
import {
  isBridgeOwnedNativeProjectionHost,
  resolveBridgeOwnedNativeTaskSource,
} from "./bridge-owned-native-tasks.js";
import { ControlSurface } from "./tools.js";
import {
  LocalManifestUpdater,
  resolveLocalUpdateManifestFile,
} from "./updater.js";
import { createUxProjectionFromEnvironment } from "./ux-projection.js";
import {
  AgentGateway,
  AgentRegistry,
  CodexAgentProviderAdapter,
} from "./agent-gateway.js";
import { ProjectRegistry } from "./project-registry.js";
import { WorkingDirectoryResolver } from "./working-directory.js";
import { PortRegistry, resolveStatusUrlFile } from "./port-registry.js";
import { StartupSupervisor } from "./startup-supervisor.js";

const uxProjection = createUxProjectionFromEnvironment();
const startupSupervisor = new StartupSupervisor();
startupSupervisor.component("Bridge Backend", "starting", { owner_pid: process.pid });
const portRegistry = new PortRegistry(resolveStatusUrlFile());
const runtimeStore = new RuntimeStore(256, uxProjection);
const appServer = new AppServerManager(runtimeStore);
const appServerAdapter = new CodexAppServerAdapter(appServer);
// Bridge task execution is guarded by the fixed Luna/max policy locally; it does
// not need to start the persistent app-server merely to discover the same policy.
const modelGuard = new ModelGuard();
const mcpHealth = new McpHealthState();
const workingDirectoryResolver = new WorkingDirectoryResolver();
let control = new ControlSurface(appServer, undefined, modelGuard);

let taskStatusStore: TaskStatusStore | undefined;
let taskStatusServer: TaskStatusServer | undefined;
let codexTaskSync: CodexTaskSync | undefined;
let scheduler: BridgeTaskScheduler | undefined;
let nativeStateReconciler: NativeStateReconciler | undefined;

try {
  const taskManagerFile = resolveTaskManagerFile();
  const candidateNativeTaskSource = resolveBridgeOwnedNativeTaskSource();
  const bridgeOwnedNativeTaskSource = isBridgeOwnedNativeProjectionHost(
    taskManagerFile,
    candidateNativeTaskSource,
  ) ? candidateNativeTaskSource : null;
  const store = new TaskStatusStore(resolveTaskStatusFile());
  const manager = new TaskManager(taskManagerFile, store);
  const runtime = new TaskRuntime(manager);
  codexTaskSync = new CodexTaskSync(appServer.runtime, manager, runtime, {
    onError: reportStatusIssue,
  });
  scheduler = new EphemeralTaskScheduler(manager, appServerAdapter, modelGuard, runtime);
  nativeStateReconciler = new NativeStateReconciler(manager, appServerAdapter, appServer.runtime, {
    onError: reportStatusIssue,
  });
  const taskService = new TaskService(scheduler, workingDirectoryResolver);
  const updater = new LocalManifestUpdater(resolveLocalUpdateManifestFile());
  const codexAgentProvider = new CodexAgentProviderAdapter(
    (argumentsValue) => control.callForPlugin("codex_turn", argumentsValue),
    manager,
    appServer.runtime,
    () => appServer.status(),
  );
  const agentGateway = new AgentGateway(
    manager,
    appServer.runtime,
    new AgentRegistry([codexAgentProvider]),
    new ProjectRegistry(),
    workingDirectoryResolver,
  );
  control = new ControlSurface(
    appServer,
    undefined,
    modelGuard,
    taskService,
    appServerAdapter,
    agentGateway,
    workingDirectoryResolver,
  );
  store.setBridgeStatus("running");
  const statusServer = new TaskStatusServer(store, manager, runtime, {
    port: resolveTaskStatusPort(),
    modelGuard,
    scheduler,
    nativeStateReconciler,
    mcpHealth,
    taskService,
    nativeAdapter: appServerAdapter,
    controlSurface: control,
    bridgeOwnedNativeTaskSource,
    updater,
    workingDirectoryTrace: () => workingDirectoryResolver.lastTrace(),
    liveRuntime: appServer.runtime,
    portRegistry,
    startupSupervisor,
  });
  taskStatusStore = store;
  taskStatusServer = statusServer;
  void scheduler.reconcile()
    .then(() => nativeStateReconciler?.reconcile())
    .catch((error: unknown) => reportStatusIssue(error));
  void statusServer.start().catch((error: unknown) => reportStatusIssue(error));
} catch (error) {
  reportStatusIssue(error);
}

let shuttingDown = false;
let server: McpStdioServer;

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  const currentExitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = Math.max(currentExitCode, exitCode);
  try {
    taskStatusStore?.setBridgeStatus("stopped");
  } catch (error) {
    reportStatusIssue(error);
  }
  try {
    await taskStatusServer?.close();
  } catch (error) {
    reportStatusIssue(error);
  }
  codexTaskSync?.close();
  nativeStateReconciler?.close();
  scheduler?.close();
  await server.close();
  await appServer.close();
  appServer.runtime.closeUxProjection();
}

function reportFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const safe = sanitizeForTransport(message, {
    maxStringChars: 4_000,
    totalCharBudget: 4_000,
  });
  process.stderr.write(`local-codex-bridge: ${String(safe)}\n`);
}

function reportStatusIssue(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const safe = sanitizeForTransport(message, {
    maxStringChars: 2_000,
    totalCharBudget: 2_000,
  });
  process.stderr.write(`local-codex-bridge status page: ${String(safe)}\n`);
}

server = new McpStdioServer(control, {
  onClose: () => shutdown(0),
  health: mcpHealth,
});

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
process.once("uncaughtException", (error) => {
  reportFatal(error);
  void shutdown(1);
});
process.once("unhandledRejection", (error) => {
  reportFatal(error);
  void shutdown(1);
});

server.start();
