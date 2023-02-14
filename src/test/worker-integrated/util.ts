import { TurfProcess } from '#self/lib/turf/types';
import { TurfContainerStates } from '#self/lib/turf/wrapper';
import assert from 'assert';
import { DefaultEnvironment } from '../env/environment';

export async function killWorker(env: DefaultEnvironment, name: string) {
  const broker = Array.from(env.control.stateManager.brokers())[0];
  assert.ok(broker != null);
  assert.strictEqual(broker.name, name);
  const worker = Array.from(broker.workers.values())[0];
  assert.ok(worker != null);

  const items: TurfProcess[] = await env.turf.ps();
  items
    .filter(it => {
      return (
        it.status === TurfContainerStates.running && it.name === worker.name
      );
    })
    .forEach(it => {
      process.kill(it.pid, 'SIGKILL');
    });
}
