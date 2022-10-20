import path from 'path';
import * as fs from 'fs';
import assert from 'assert';
import { performance } from 'perf_hooks';

import mm from 'mm';
import _ from 'lodash';
import FakeTimers, { Clock } from '@sinonjs/fake-timers';

import { NoslatedClient } from '#self/sdk';
import * as common from '#self/test/common';
import { DataPlane } from '#self/data_plane';
import { createDeferred } from '#self/lib/util';
import { ControlPlane } from '#self/control_plane/index';
import { startTurfD, stopTurfD, turf } from '#self/lib/turf';
import * as starters from '#self/control_plane/starter/index';
import { FIXTURES_DIR, Roles, startAllRoles } from '#self/test/util';
import { CapacityManager } from '#self/control_plane/capacity_manager';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { StateManager } from '#self/control_plane/worker_stats/state_manager';

const simpleSandbox = path.resolve(FIXTURES_DIR, 'sandbox_simple');

describe(common.testName(__filename), () => {
    // let controlPlane: ControlPlane;
    let stateManager: StateManager;
    let capacityManager: CapacityManager;
    let clock: Clock;

    let agent: NoslatedClient;
    let controlPlane: ControlPlane;
    let data: DataPlane;

    beforeEach(async () => {
        const roles = await startAllRoles() as Required<Roles>;

        data = roles.data;
        agent = roles.agent;
        controlPlane = roles.control;

        ({ stateManager, capacityManager } = controlPlane);
        ({ capacityManager } = controlPlane);

        clock = FakeTimers.install({
            toFake: ['setTimeout']
        });

        startTurfD();
    });

    afterEach(async () => {
        clock.uninstall();
        await Promise.all([
            controlPlane.close(),
            agent.close(),
            data.close()
        ]);
        await turf.destroyAll();

        stopTurfD();
    });

    describe("updateContainerStatusByReport()", () => {
        it('should update regularly', async () => {
            const { functionProfileManager } = capacityManager;
            functionProfileManager.set([{
                name: 'func1',
                url: `file://${__dirname}`,
                runtime: 'aworker',
                signature: 'xxx',
                sourceFile: 'index.js',
            }, {
                name: 'func2',
                url: `file://${__dirname}`,
                runtime: 'aworker',
                signature: 'xxx',
                sourceFile: 'index.js',
            }], 'WAIT');

            const { promise, resolve } = createDeferred<void>();
            functionProfileManager.once('changed', () => {
                resolve();
            });
            await promise;

            controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker1', 'cred1', false);

            const worker = capacityManager.workerStatsSnapshot.getWorker('func1', false, 'worker1');

            assert(worker);

            stateManager.updateContainerStatusByReport(worker, {
                functionName: 'func',
                name: 'worker1',
                isInspector: true,
                timestamp: performance.now(),
                event: ContainerStatusReport.ContainerInstalled,
                requestId: ''
            });

            assert.strictEqual(worker.containerStatus, ContainerStatus.Ready);

            stateManager.updateContainerStatusByReport(worker, {
                functionName: 'func',
                name: 'worker1',
                isInspector: true,
                timestamp: performance.now(),
                event: ContainerStatusReport.RequestDrained,
                requestId: ''
            });

            assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

            stateManager.updateContainerStatusByReport(worker, {
                functionName: 'func',
                name: 'worker1',
                isInspector: true,
                timestamp: performance.now(),
                event: ContainerStatusReport.ContainerDisconnected,
                requestId: ''
            });

            assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

            stateManager.updateContainerStatusByReport(worker, {
                functionName: 'func',
                name: 'worker1',
                isInspector: true,
                timestamp: performance.now(),
                event: '赢',
                requestId: ''
            });

            assert.strictEqual(worker.containerStatus, ContainerStatus.Unknown);
        });


        it('should not update with illegal ContainerStatusReport order', async () => {
            const { functionProfileManager } = capacityManager;
            functionProfileManager.set([{
                name: 'func1',
                url: `file://${__dirname}`,
                runtime: 'aworker',
                signature: 'xxx',
                sourceFile: 'index.js',
            }], 'WAIT');

            const { promise, resolve } = createDeferred<void>();
            functionProfileManager.once('changed', () => {
                resolve();
            });
            await promise;

            controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker1', 'cred1', false);

            const worker = capacityManager.workerStatsSnapshot.getWorker('func1', false, 'worker1');

            assert(worker);

            const timestamp = performance.now();
            stateManager.updateContainerStatusByReport(worker, {
                functionName: 'func',
                name: 'worker1',
                isInspector: true,
                timestamp,
                event: ContainerStatusReport.RequestDrained,
                requestId: ''
            });

            assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

            stateManager.updateContainerStatusByReport(worker, {
                functionName: 'func',
                name: 'worker1',
                isInspector: true,
                timestamp: performance.now(),
                event: ContainerStatusReport.ContainerInstalled,
                requestId: ''
            });

            assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);
            assert.strictEqual(worker.latestUpdateContainerStatusTimestamp, timestamp);
        });
    });


    describe("syncWorkerData()", () => {
        it('should sync', async () => {
            const { functionProfileManager } = capacityManager;
            functionProfileManager.set([{
                name: 'func1',
                url: `file://${__dirname}`,
                runtime: 'aworker',
                signature: 'xxx',
                sourceFile: 'index.js',
            }], 'WAIT');

            const brokerStat1 = {
                functionName: 'func1',
                inspector: false,
                workers: [{
                    name: 'worker1',
                    maxActivateRequests: 10,
                    activeRequestCount: 1,
                }, {
                    name: 'worker2',
                    maxActivateRequests: 10,
                    activeRequestCount: 6,
                }],
            };

            const { promise, resolve } = createDeferred<void>();
            functionProfileManager.once('changed', () => {
                resolve();
            });
            await promise;

            controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker1', 'id1', false);
            controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker2', 'id2', false);

            await turf.create('worker1', simpleSandbox);
            await turf.create('worker2', simpleSandbox);
            await turf.start('worker1');
            await turf.start('worker2');

            await stateManager.syncWorkerData([brokerStat1]);

            assert.strictEqual(capacityManager.workerStatsSnapshot.brokers.size, 1);
            assert.strictEqual(capacityManager.workerStatsSnapshot.getBroker('func1', false)?.workers.size, 2);

            assert.deepStrictEqual(_.omit(capacityManager.workerStatsSnapshot.getBroker('func1', false)?.getWorker('worker1')?.toJSON(), 'pid', 'registerTime'), {
                name: 'worker1',
                credential: 'id1',
                turfContainerStates: 'running',
                containerStatus: ContainerStatus.Created,
                data: { maxActivateRequests: 10, activeRequestCount: 1 }
            });
            assert.deepStrictEqual(_.omit(capacityManager.workerStatsSnapshot.getBroker('func1', false)?.getWorker('worker2')?.toJSON(), 'pid', 'registerTime'), {
                name: 'worker2',
                credential: 'id2',
                turfContainerStates: 'running',
                containerStatus: ContainerStatus.Created,
                data: { maxActivateRequests: 10, activeRequestCount: 6 }
            });

            await turf.stop('worker2');
            await stateManager.syncWorkerData([brokerStat1]);

            assert.strictEqual(capacityManager.workerStatsSnapshot.brokers.size, 1);
            assert.strictEqual(capacityManager.workerStatsSnapshot.getBroker('func1', false)?.workers.size, 1);
            assert.deepStrictEqual(capacityManager.workerStatsSnapshot.getBroker('func1', false)?.getWorker('worker2'), null);

            // should delete directory after 5 minutes.
            let rmdirCalled = false;
            mm(fs.promises, 'rmdir', async (name: any, options: any) => {
                assert.strictEqual(name, path.dirname(starters.logPath(capacityManager.workerStatsSnapshot.config.logger.dir, 'worker2', 'dummy')));
                assert.deepStrictEqual(options, { recursive: true });
                rmdirCalled = true;
            });

            clock.tick(10 * 1000 * 60);
            assert(rmdirCalled);
        });

        it('should not sync with empty psData', async () => {
            const { functionProfileManager } = capacityManager;
            functionProfileManager.set([{
                name: 'func1',
                url: `file://${__dirname}`,
                runtime: 'aworker',
                signature: 'xxx',
                sourceFile: 'index.js',
            }], 'WAIT');

            const brokerStat1 = {
                functionName: 'func1',
                inspector: false,
                workers: [{
                    name: 'worerk1',
                    maxActivateRequests: 10,
                    activeRequestCount: 1,
                }],
            };

            const { promise, resolve } = createDeferred<void>();
            functionProfileManager.once('changed', () => {
                resolve();
            });
            await promise;

            controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker1', 'id1', false);

            const beforeSync = controlPlane.capacityManager.workerStatsSnapshot.getBroker('func1', false)?.getWorker('worker1')?.toJSON();

            await stateManager.syncWorkerData([brokerStat1]);

            const afterSync = controlPlane.capacityManager.workerStatsSnapshot.getBroker('func1', false)?.getWorker('worker1')?.toJSON();

            assert.deepStrictEqual(beforeSync, afterSync);
        });
    });
});