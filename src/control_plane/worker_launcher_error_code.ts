import { castError } from '#self/lib/util';
import * as root from '#self/proto/root';
import { format } from 'util';

const kLauncherErrors = {
  // Recoverable errors
  kReplicaLimitExceeded: {
    fatal: false,
    template: 'Replica count exceeded limit (%s / %s)',
  },

  // Fatal errors
  kReplicaLimitExceededInspector: {
    fatal: true,
    template: 'Replica count exceeded limit in inspect mode',
  },
  kNoEnoughVirtualMemoryPoolSize: {
    fatal: true,
    template: 'No enough virtual memory (used: %s + need: %s) > total: %s',
  },
  kEnsureCodeError: {
    fatal: true,
    template: 'Failed to ensure (or download) code: %s',
  },
  kInvalidRuntime: {
    fatal: true,
    template: 'Invalid runtime %s',
  },
  kNoFunction: {
    fatal: true,
    template: 'No function profile %s registered.',
  },
  kInvalidV8Option: {
    fatal: true,
    template: 'Invalid v8 options: %s',
  },
  kInternal: {
    fatal: true,
    template: 'Internal error: %s',
  },
} as const;
type ErrorCodes = keyof typeof kLauncherErrors;

export const ErrorCode = Object.fromEntries(
  Object.keys(kLauncherErrors).map(it => [it, it])
) as { [key in ErrorCodes]: key };

export class LauncherError extends Error {
  code: string;
  fatal: boolean;
  constructor(code: ErrorCodes, ...args: unknown[]) {
    const desc = kLauncherErrors[code] ?? kLauncherErrors.kInternal;
    const msg = format(desc.template, ...args);
    super(msg);
    this.code = code;
    this.fatal = desc.fatal;
  }
}

/**
 * Wrap launch error object.
 */
export function wrapLaunchErrorObject(
  name: string,
  isInspector: boolean,
  err: unknown
): root.noslated.data.IStartWorkerFastFailRequest {
  if (!(err instanceof LauncherError)) {
    err = new LauncherError(ErrorCode.kInternal, castError(err));
  }
  const e = err as LauncherError;

  return {
    funcName: name,
    inspect: isInspector,

    type: e.code,
    message: e.message,
    stack: e.stack,
    fatal: e.fatal,
  };
}
