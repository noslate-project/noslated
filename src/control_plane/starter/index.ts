import { AworkerStarter } from './aworker';
import { NodejsStarter } from './nodejs';
import { BaseStarter } from './base';

export { NodejsStarter as Nodejs, AworkerStarter as Aworker };
export const logPath = BaseStarter.logPath;
