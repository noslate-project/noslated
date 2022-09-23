import path from 'path';
import { descriptor } from '#self/lib/rpc/util';
import { DataPanelSubscription as Subscription } from './subscription';
import { BasePanelClient } from '#self/lib/base_panel_client';
import { DataPanelClientManager } from './manager';
import { Config } from '#self/config';

export class DataPanelClient extends BasePanelClient {
  #serverSockPath: string;
  subscription: Subscription | null;

  constructor(private manager: DataPanelClientManager, panelId: number, config: Config) {
    const dataPanelSockPath = path.join(config.dirs.aliceSock, `dp-${panelId}.sock`);
    super('data panel guest', dataPanelSockPath, panelId, config);
    this.#serverSockPath = '';
    this.subscription = null;
  }

  async _init() {
    // descriptor 未生成符合 ServiceClientConstructor 的定义
    // import { ProtoGrpcType } from 'src/proto/data-panel'
    this.addService((descriptor as any).alice.data.DataPanel);
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
