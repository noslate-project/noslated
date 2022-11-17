import net from 'net';
import { TextEncoder } from 'util';
import { createDeferred, Deferred } from '../util';

const textEncoder = new TextEncoder();

function defineMagic(a: string, b: string, c: string, d: number) {
  return (d & 0xFF) << 24 | c.charCodeAt(0) << 16 | b.charCodeAt(0) << 8 | a.charCodeAt(0);
}

/**
 * inner msg
 * #define TFD_MSG_VER 0x01
 * #define MSG_HDR_MAGIC DEF_MAGIC('T', 'F', 'D', TFD_MSG_VER)
 * #define T_MSG_CLI_REQ 1
 * #define T_MSG_CLI_RSP 2
 *
 * struct msg_hdr {
 *   uint32_t hdr_magic;  // MSG_HDR_MAGIC with intf version.
 *   uint8_t msg_type;    // message type
 *   int8_t msg_code;     // message code
 *   uint16_t msg_size;   // without header
 * };
 *
 */
enum MessageType {
  T_MSG_CLI_REQ = 1,
  T_MSG_CLI_RSP = 2,
}

class MsgHdr {
  public static byteLength = 8;
  private static magic = defineMagic('T', 'F', 'D', 0x01);

  static encode(messageType: MessageType, code: number, byteLength: number): Uint8Array {
    const u8 = Buffer.alloc(this.byteLength);
    u8.writeUint32LE(this.magic, 0);
    u8.writeUint8(messageType, 4);
    u8.writeInt8(code, 5);
    u8.writeUint16LE(byteLength, 6);

    return u8;
  }

  static decode(buffer: Buffer): MsgHdr {
    const magic = buffer.readUint32LE(0);
    const messageType = buffer.readUint8(4);
    const code = buffer.readInt8(5);
    const byteLength = buffer.readInt8(6);

    if (magic !== this.magic) {
      throw new Error('parse failed');
    }
    return new MsgHdr(messageType, code, byteLength);
  }

  private constructor(public messageType: MessageType, public code: number, public byteLength: number) {}
}

interface Message {
  header: MsgHdr;
  body: Uint8Array;
}

export class MessageParser {
  private _bufs: Buffer[] = [];
  private _byteLength = 0;
  private _header: MsgHdr | null = null;

  push(buf: Buffer) {
    this._bufs.push(buf);
    this._byteLength += buf.byteLength;
  }

  next(): Message | undefined {
    let buf;
    if (this._header == null && this._byteLength >= MsgHdr.byteLength) {
      buf = this._read(MsgHdr.byteLength);
      const header = MsgHdr.decode(buf);
      this._header = header;
    }
    if (this._header && this._byteLength >= this._header.byteLength) {
      const header = this._header;
      buf = this._read(header.byteLength);
      this._header = null;
      return {
        header,
        body: buf,
      };
    }
  }

  private _read(byteLength: number): Buffer {
    if (byteLength === 0) {
      return Buffer.alloc(0);
    }
    let res = this._bufs.shift()!;
    if (res.byteLength < byteLength) {
      const pendingBufs = [res];
      let totalByteLength = res.byteLength
      for (; totalByteLength < byteLength;) {
        const next = this._bufs.shift()!;
        pendingBufs.push(next);
        totalByteLength += next.byteLength;
      }
      res = Buffer.concat(pendingBufs, totalByteLength);
    }
    if (res.byteLength > byteLength) {
      const view = Buffer.from(res.buffer, res.byteOffset, byteLength);
      const unconsumed = Buffer.from(res.buffer, res.byteOffset + byteLength, res.byteLength - byteLength);
      this._bufs.unshift(unconsumed);
      res = view;
    }

    this._byteLength -= res.byteLength;
    return res;
  }
}

interface RequestItem {
  data: Uint8Array;
  deferred: Deferred<Message>;
}

export class TurfSession {
  #socket!: net.Socket;
  #parser = new MessageParser();
  #connectionDeferred = createDeferred<void>();
  #closeDeferred = createDeferred<void>();
  #queue: RequestItem[] = [];

  #pending = false;

  #onConnect = () => {
    this.#drainQueue();
    this.#connectionDeferred.resolve();
  }

  #onData = (buffer: Buffer) => {
    this.#parser.push(buffer);

    const nextItem = this.#queue[0];
    if (nextItem == null) {
      return;
    }

    let msg;
    try {
      msg = this.#parser.next();
    } catch (e) {
      this.#onError(e);
      return;
    }
    if (msg == null) {
      return;
    }

    this.#queue.shift();
    nextItem.deferred.resolve(msg);

    this.#pending = false;
    this.#drainQueue();
  }

  #onClose = () => {
    const e = new Error('Aborted');
    for (const item of this.#queue) {
      item.deferred.reject(e);
    }
    this.#queue = [];

    this.#closeDeferred.resolve();
  }

  #onError = (e: unknown) => {
    this.#connectionDeferred.reject(e);
    for (const item of this.#queue) {
      item.deferred.reject(e);
    }
    this.#queue = [];
    this.#socket.destroy();

    // TODO: emit error;
  }

  constructor(private sockPath: string) {}

  connect(): Promise<void> {
    this.#socket = net.connect({ path: this.sockPath }, this.#onConnect);
    this.#socket.on('data', this.#onData);
    this.#socket.on('close', this.#onClose);
    this.#socket.on('error', this.#onError);
    return this.#connectionDeferred.promise;
  }

  close(): Promise<void> {
    this.#socket.destroy();
    return this.#closeDeferred.promise;
  }

  send(argv: string[]): Promise<Message> {
    const data = textEncoder.encode(argv.join('\0'));
    const hdr = MsgHdr.encode(MessageType.T_MSG_CLI_REQ, 0, data.byteLength);
    const buf = Buffer.concat([hdr, data], hdr.byteLength + data.byteLength);
    const deferred = createDeferred<Message>();
    this.#queue.push({ data: buf, deferred });
    this.#drainQueue();

    return deferred.promise;
  }

  #drainQueue() {
    if (this.#pending) {
      return;
    }
    if (this.#queue.length === 0) {
      return;
    }
    this.#pending = true;
    const item = this.#queue[0];
    this.#socket.write(item.data);
  }
}
