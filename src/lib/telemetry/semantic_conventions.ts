const DelegateMetrics = {
  TRIGGER_COUNT: 'noslate.delegate.trigger_count',
  TRIGGER_DURATION: 'noslate.delegate.trigger_duration',
};

const DelegateMetricAttributes = {
  TRIGGER_METHOD: 'noslate.delegate.trigger_method',
};

const DataPanelMetrics = {
  INVOKE_COUNT: 'noslate.data.invoke_count',
  INVOKE_DURATION: 'noslate.data.invoke_duration',

  QUEUED_REQUEST_COUNT: 'noslate.data.queued_request_count',
  QUEUED_REQUEST_DURATION: 'noslate.data.queued_request_duration',
};

const PanelMetricAttributes = {
  FUNCTION_NAME: 'noslate.function_name',
  SERVICE_NAME: 'noslate.service_name',
};

const DataPanelMetricAttributes = {
  // TODO(chengzhong.wcz): invoke status code, etc.
};

const ControlPanelMetrics = {
  REPLICA_CPU_USER: 'noslate.control.replica_cpu_user',
  REPLICA_CPU_SYSTEM: 'noslate.control.replica_cpu_system',
  REPLICA_MEM_RSS: 'noslate.control.replica_mem_rss',
  REPLICA_MEM_VM: 'noslate.control.replica_mem_vm',
  FUNCTION_REPLICA_EXIT_COUNT: 'noslate.control.function_replica_exit_count',
  FUNCTION_REPLICA_TOTAL_COUNT: 'noslate.control.function_replica_total_count',
};

const ControlPanelMetricAttributes = {
  RUNTIME_TYPE: 'noslate.runtime_type',
  PROCESS_PID: 'noslate.process_pid',
  EXIT_CODE: 'noslate.exit_code',
  EXIT_SIGNAL: 'noslate.exit_signal',
  EXIT_REASON: 'noslate.exit_reason',
};

const WorkerMetrics = {
  TOTAL_HEAP_SIZE: 'noslate.worker.total_heap_size',
  USED_HEAP_SIZE: 'noslate.worker.used_heap_size',
};

const WorkerMetricsAttributes = {
  WORKER_PID: 'noslate.worker.pid',
};

export {
  DelegateMetrics,
  DelegateMetricAttributes,

  PanelMetricAttributes,

  DataPanelMetrics,
  DataPanelMetricAttributes,

  ControlPanelMetrics,
  ControlPanelMetricAttributes,

  WorkerMetrics,
  WorkerMetricsAttributes,
};
