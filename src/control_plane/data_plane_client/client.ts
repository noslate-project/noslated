import path from 'path';
import { descriptor } from '#self/lib/rpc/util';
import { DataPlaneSubscription as Subscription } from './subscription';
import { BasePlaneClient } from '#self/lib/base_plane_client';
import { Config } from '#self/config';
import * as root from '#self/proto/root';
import { EventBus } from '#self/lib/event-bus';

// @ts-ignore protobuf's proprietary EventEmitter
export interface DataPlaneClient extends root.noslated.data.DataPlane {} // eslint-disable-line @typescript-eslint/no-empty-interface
export class DataPlaneClient extends BasePlaneClient {
  #serverSockPath: string;
  subscription: Subscription | null;

  constructor(private eventBus: EventBus, planeId: number, config: Config) {
    const dataPlaneSockPath = path.join(
      config.dirs.noslatedSock,
      `dp-${planeId}.sock`
    );
    super('data plane guest', dataPlaneSockPath, planeId, config);
    this.#serverSockPath = '';
    this.subscription = null;
  }

  async _init() {
    // descriptor 未生成符合 ServiceClientConstructor 的定义
    // import { ProtoGrpcType } from 'src/proto/data-plane'
    this.addService((descriptor as any).noslated.data.DataPlane);
    await super._init();
    this.subscription = new Subscription(this.eventBus, this);
    this.subscription.subscribe();

    const ret = await (this as any).serverSockPath({});
    this.#serverSockPath = ret.path;
  }

  getServerSockPath() {
    return this.#serverSockPath;
  }
}
