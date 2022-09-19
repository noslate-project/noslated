import { ControlPlane } from '#self/control_plane';
import { turf } from '#self/lib/turf';
import { TurfProcess } from '#self/lib/turf/types';
import { TurfContainerStates } from '#self/lib/turf/wrapper';
import assert from 'assert';

export async function killWorker(control: ControlPlane, name: string) {
  const broker = Array.from(control.capacityManager.workerStatsSnapshot.brokers.values())[0];
  assert.ok(broker != null);
  assert.strictEqual(broker.name, name);
  const worker = Array.from(broker.workers.values())[0];
  assert.ok(worker != null);

  const items: TurfProcess[] = await turf.ps();
  items.filter((it) => {
    return it.status === TurfContainerStates.running && it.name === worker.name;
  }).forEach((it) => {
    process.kill(it.pid, 'SIGKILL');
  });
}
