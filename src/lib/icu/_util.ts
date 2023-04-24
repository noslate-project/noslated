import { config } from '#self/config';

export class IcuError extends Error {}

export async function icu(promise: Promise<any>) {
  try {
    await promise;
  } catch (e) {
    if (!(e instanceof IcuError)) {
      console.error(e);
      return process.exit(2);
    }
    console.error('IcuError: %s', e.message);
    return process.exit(1);
  }
}

export function getSockAddr(service: string): string | undefined {
  const map = {
    'noslated.data.DataPlane': `unix://${config.dirs.noslatedSock}/dp-0.sock`,
    'noslated.data.PushServer': `unix://${config.dirs.noslatedSock}/dp-0.sock`,
    'noslated.control.ControlPlane': `unix://${config.dirs.noslatedSock}/cp-0.sock`,
  };
  return map[service];
}
