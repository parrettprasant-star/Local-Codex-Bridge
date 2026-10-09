/**
 * V4 name for the existing atomic TaskManager store. The alias keeps one
 * durable task authority instead of introducing a second persistence layer.
 */
export {
  TaskManager as TaskStore,
  TaskManagerValidationError,
  TaskNotFoundError,
  TASK_EXECUTION_SOURCES,
  TASK_MANAGER_SCHEMA_VERSION,
} from "./task-manager.js";
export type {
  TaskCreateInput,
  TaskEvent,
  TaskEventPayload,
  TaskEventType,
  TaskLifecycle,
  TaskManagerSnapshot,
  TaskRecord,
  TaskExecutionSource,
  TaskUpdateInput,
} from "./task-manager.js";
export type {
  ResultIntegrity,
  ResultIntegrityEntry,
  ResultIntegrityStatus,
  ResultManifest,
  ResultVerification,
  ReviewStatus,
} from "./result-manifest.js";
