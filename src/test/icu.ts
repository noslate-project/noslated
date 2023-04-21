import { spawn } from './util';

const invokePath = require.resolve('#self/lib/icu/invoke');

export enum Service {
  ControlPlane = 'noslated.control.ControlPlane',
  DataPlane = 'noslated.data.DataPlane',
}

export async function icuInvoke(
  service: Service,
  method: string,
  params: unknown
) {
  const { stdout, stderr } = await spawn(
    process.execPath,
    [invokePath, '--service', service, method, JSON.stringify(params)],
    {
      env: {
        ...process.env,
        GRPC_TRACE: '',
        GRPC_VERBOSITY: 'NONE',
      },
    }
  );
  try {
    return JSON.parse(stdout);
  } catch (e) {
    return Object.assign(e as any, {
      stdout,
      stderr,
      service,
      method,
      params,
    });
  }
}
