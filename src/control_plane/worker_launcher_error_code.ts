import * as root from '#self/proto/root';

enum ErrorCode {
  kEnsureCodeError = 'ENOENSR',
  kInvalidRuntime = 'EIVDRTM',
  kNoEnoughVirtualMemoryPoolSize = 'ENOMEM',
  kNoFunction = 'ENOFUNC',
  kReplicaLimitExceeded = 'EREPLIM',
  kInvalidV8Option = 'EIVDV8O',
}

/**
 * Wrap launch error object.
 * @param {string} name The function name.
 * @param {bool} isInspector Whether it's using inspector.
 * @param {Error} err The error object.
 * @return {root.noslated.data.StartWorkerFastFailRequest} The wrapped object.
 */
function wrapLaunchErrorObject(
  name: string,
  isInspector: boolean,
  err: Error
): root.noslated.data.IStartWorkerFastFailRequest {
  let displayMessage;
  switch (err.code) {
    case ErrorCode.kEnsureCodeError: {
      displayMessage = `Failed to ensure (or download) code for ${name} now.`;
      break;
    }

    case ErrorCode.kInvalidRuntime: {
      displayMessage = `Invalid runtime for function ${name}.`;
      break;
    }

    case ErrorCode.kNoEnoughVirtualMemoryPoolSize: {
      displayMessage = `No enough virtual memory to start worker process for ${name} now.`;
      break;
    }

    case ErrorCode.kNoFunction: {
      displayMessage = `No function profile ${name} registered.`;
      break;
    }

    case ErrorCode.kReplicaLimitExceeded: {
      displayMessage = `${err.message} for function ${name}.`;
      break;
    }

    case ErrorCode.kInvalidV8Option: {
      displayMessage = `Invalid v8 options config for function profile ${name}.`;
      break;
    }

    default: {
      displayMessage = 'Uncategoried start error: ' + err.stack;
      break;
    }
  }

  return {
    type: (err.code as string) || '',
    funcName: name,
    inspect: isInspector,
    message: err.message,
    stack: err.stack,
    displayMessage,
  };
}

export { ErrorCode, wrapLaunchErrorObject };
