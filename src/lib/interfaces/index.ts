import { ServiceType } from '#self/data_panel/service_selector';
import * as root from '#self/proto/root';

export type NotNullableInterface<T> = {
  [P in keyof T]-?: NonNullable<T[P]>;
};

export interface IFunctionServiceSelectorMap extends Omit<root.alice.data.IFunctionService, 'selectors' | 'selector'> {
  name: string;
  type: ServiceType;
  selectors?: { [key: string]: string; }[];
  selector?: { [key: string]: string; };
}