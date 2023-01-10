/**
 * Fork from https://github.com/XadillaX/algorithmjs/blob/master/lib/data-structure/linklist/index.js
 */

export class LinklistNode<T> {
  prev: LinklistNode<T> | undefined;
  next: LinklistNode<T> | undefined;

  constructor(public value: T | undefined) {}
}

export class LinkList<T> {
  private _head: LinklistNode<T>;
  private _tail: LinklistNode<T>;

  length = 0;

  constructor() {
    this._head = new LinklistNode<T>(undefined);
    this._tail = new LinklistNode<T>(undefined);

    this._head.next = this._tail;
    this._tail.prev = this._head;
  }

  /**
   * to string.
   */
  toString(): string {
    let str = '[';
    let first = true;

    for (let node = this._head.next; node !== this._tail; node = node?.next) {
      if (!first) {
        str += ' -> \n  ';
      } else {
        str += ' ';
        first = false;
      }

      if (typeof node?.value === 'string') {
        str += '"' + node.value + '"';
      } else if (typeof node?.value === 'object') {
        if (node.value === null) {
          str += 'null';
        } else {
          str += `${node.value}`;
        }
      } else {
        str += node?.value;
      }
    }

    str += ' ]';

    return str;
  }

  /**
   * console.log()...
   */
  inspect(): string {
    return this.toString();
  }

  /**
   * node at a certain position
   * @param pos
   */
  nodeAt(pos: number): LinklistNode<T> | undefined {
    // out of range
    if (pos < 0 || pos >= this.length) {
      return undefined;
    }

    // from start to end...
    if (this.length << 1 > pos) {
      let i = 0;

      for (let node = this._head.next; node !== this._tail; node = node?.next) {
        if (i++ === pos) {
          return node;
        }
      }
    }

    // from end to start...
    let i = this.length - 1;
    for (let node = this._tail.prev; node !== this._head; node = node?.prev) {
      if (i-- === pos) {
        return node;
      }
    }
  }

  /**
   * value at a certain position
   * @param pos
   */
  valueAt(pos: number): T | undefined {
    const node = this.nodeAt(pos);

    if (null === node) {
      return undefined;
    }

    return node?.value;
  }

  /**
   * remove a certain position element.
   * @param pos
   * @returns {*}
   */
  removeAt(pos: number): T | undefined {
    let node = this.nodeAt(pos);

    if (null === node) {
      return undefined;
    }

    node!.prev!.next = node?.next;
    node!.next!.prev = node?.prev;
    const value = node?.value;
    node = undefined;

    this.length--;
    return value;
  }

  /**
   * insert an element at the position of `pos`.
   * @param pos
   * @param value
   */
  insert(pos: number, value: T | LinklistNode<T>) {
    let node = this.nodeAt(pos);

    // two special position.
    if (pos < 0) {
      node = this._head;
    } else if (node === null) {
      node = this._tail;
    }

    if (!(value instanceof LinklistNode)) {
      value = new LinklistNode(value);
    }

    value.prev = node?.prev;
    value.next = node;
    node!.prev!.next = value;
    node!.prev = value;

    this.length++;
  }

  /**
   * pop the back element.
   */
  popBack(): T | undefined {
    if (!this.length) {
      return undefined;
    }

    let back = this._tail.prev;
    if (back === this._head) return undefined;

    this._tail.prev = back?.prev;
    this._tail.prev!.next = this._tail;

    const value = back?.value;
    back = undefined;

    this.length--;

    return value;
  }

  /**
   * pop the front element.
   */
  popFront(): T | undefined {
    if (!this.length) {
      return undefined;
    }

    let front = this._head.next;
    if (front === this._tail) return undefined;

    this._head.next = front?.next;
    this._head.next!.prev = this._head;

    const value = front?.value;
    front = undefined;

    this.length--;

    return value;
  }

  /**
   * Push an element to the end of the linklist.
   * @param value
   */
  pushBack(value: T | LinklistNode<T>) {
    if (!(value instanceof LinklistNode)) {
      value = new LinklistNode(value);
    }

    value.next = this._tail;
    value.prev = this._tail.prev;
    this._tail.prev!.next = value;
    this._tail.prev = value;

    this.length++;
  }

  /**
   * Push an element to the front of the linklist.
   * @param value
   */
  pushFront(value: T | LinklistNode<T>) {
    if (!(value instanceof LinklistNode)) {
      value = new LinklistNode(value);
    }

    value.next = this._head.next;
    value.prev = this._head;
    this._head.next!.prev = value;
    this._head.next = value;

    this.length++;
  }
}
