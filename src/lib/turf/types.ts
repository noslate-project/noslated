export enum TurfContainerStates {
  // 刚创建的沙盒，未曾运行过
  init = 0,
  // 正在启动
  starting,
  // 正在运行
  running,
  // 等待 Warmfork
  forkwait,
  // 正在 Fork
  cloning,
  // 正在退出
  stopping,
  // 已经退出
  stopped,
  // 异常状态，识别非法用途
  unknown,
}

interface TurfCode {
  ENOENT: number;
  ECHILD: number;
  EAGAIN: number;
  EINVAL: number;
}
let TurfCode: TurfCode;
if (process.platform === 'darwin') {
  TurfCode = {
    ENOENT: -2,
    ECHILD: -10,
    EAGAIN: -35,
    EINVAL: -22,
  };
} else {
  TurfCode = {
    ENOENT: -2,
    ECHILD: -10,
    EAGAIN: -11,
    EINVAL: -22,
  };
}
export { TurfCode };

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
  'status.cpu_overload'?: string;
  'status.mem_overload'?: string;
  'status.killed'?: number;
  'killed.signal'?: number;
  exitcode?: number;
  'stat.utime'?: number;
  'stat.stime'?: number;
  'stat.cutime'?: number;
  'stat.cstime'?: number;
  'stat.vsize'?: number;
  'stat.rss'?: number;
  'stat.minflt'?: number;
  'stat.majflt'?: number;
  'stat.cminflt'?: number;
  'stat.cmajflt'?: number;
  'stat.num_threads'?: number;
  'rusage.utime'?: number;
  'rusage.stime'?: number;
  'rusage.maxrss'?: number;
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

export interface TurfRunOptions extends TurfStartOptions {
  bundlePath: string;
  config?: string;
}

export interface TurfSpecSyscall {
  names: string[];
  action: string;
}

export interface TurfSpec {
  ociVersion: string;
  process: {
    terminal: boolean;
    user: {
      uid: number;
      gid: number;
    };
    args: string[];
    env: string[];
    noNewPrivileges: boolean;
  };
  root: {
    path: string;
    readonly: boolean;
  };
  linux: {
    resources: {
      memory: {
        limit: number;
      };
    };
    seccomp: {
      defaultAction: string;
      syscalls: TurfSpecSyscall[];
    };
  };
  turf: {
    runtime: string;
    code: string;
  };
}
