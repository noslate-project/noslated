import path from 'path';
import { descriptor } from '#self/lib/rpc/util';
import { DataPlaneSubscription as Subscription } from './subscription';
import { BasePlaneClient } from '#self/lib/base_plane_client';
import { DataPlaneClientManager } from './manager';
import { Config } from '#self/config';

export class DataPlaneClient extends BasePlaneClient {
  #serverSockPath: string;
  subscription: Subscription | null;

  constructor(
    private manager: DataPlaneClientManager,
    planeId: number,
    config: Config
  ) {
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
    this.subscription = new Subscription(this.manager, this);
    this.subscription.subscribe();

    const ret = await (this as any).serverSockPath({});
    this.#serverSockPath = ret.path;
  }

  getServerSockPath() {
    return this.#serverSockPath;
  }
}
