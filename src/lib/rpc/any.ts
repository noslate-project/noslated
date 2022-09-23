import type { Type as ProtobufType, Message } from 'protobufjs';
import { root } from './util';

const empty = Buffer.from('');

interface UnpackOptions {
  typeUrl: string;
  data: Uint8Array;
}

export class Any<T = unknown> {
  #typeUrl: string;
  #data: Uint8Array;
  #object: T;
  #Type: ProtobufType;

  constructor(typeUrl: string, data: Uint8Array, object: T, Type: ProtobufType) {
    this.#typeUrl = typeUrl;
    this.#data = data;
    this.#object = object;
    this.#Type = Type;
  }

  static pack<T>(typeUrl: string, msg: T) {
    const Type = root.lookupType(typeUrl);
    const data = Type.encode(msg).finish();
    return new Any<T>(typeUrl, data, msg, Type);
  }

  static unpack({ typeUrl, data }: UnpackOptions) {
    const Type = root.lookupType(typeUrl);
    const msg = Type.decode(data ?? empty);
    return new Any(typeUrl, data, msg, Type);
  }

  get object() {
    return this.#object;
  }

  get typeUrl() {
    return this.#typeUrl;
  }

  get data() {
    return this.#data;
  }

  toObject() {
    return this.#Type.toObject(this.object as unknown as Message<{}>);
  }

  toJSON() {
    return this.#Type.toJSON(this.object);
  }
}
