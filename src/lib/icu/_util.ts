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
