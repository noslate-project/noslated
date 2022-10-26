/**
 * @enum
 */
export enum TurfContainerStates {
  // 刚创建的沙盒，未曾运行过
  init = 'init',
  // 正在启动
  starting = 'starting',
  // 正在运行
  running = 'running',
  // 正在退出
  stopping = 'stopping',
  // 已经退出
  stopped = 'stopped',
  // 等待 Warmfork
  forkwait = 'forkwait',
  // 正在 Fork
  cloning = 'cloning',
  // 异常状态，识别非法用途
  unknown = 'unknown',
}

export interface TurfProcess {
  status: TurfContainerStates;
  pid: number;
  name: string;
}

export interface TurfState {
  name: string;
  pid: number;
  state: TurfContainerStates;
  status: number;
  'status.cpu_overload': string;
  'status.mem_overload': string;
  'status.killed': number;
  'killed.signal': number;
  exitcode: number;
  'stat.utime': number;
  'stat.stime': number;
  'stat.cutime': number;
  'stat.cstime': number;
  'stat.vsize': number;
  'stat.rss': number;
  'stat.minflt': number;
  'stat.majflt': number;
  'stat.cminflt': number;
  'stat.cmajflt': number;
  'stat.num_threads': number;
  'rusage.utime': number;
  'rusage.stime': number;
  'rusage.maxrss': number;
}

export interface TurfException extends Error {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface TurfStartOptions {
  seed?: string;
  stdout?: string;
  stderr?: string;
}
