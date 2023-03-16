export interface ReadonlyNode<T> {
  readonly prev: ReadonlyNode<T> | undefined;
  readonly next: ReadonlyNode<T> | undefined;
  readonly value: T;
}

class Node<T> implements ReadonlyNode<T> {
  constructor(
    public value: T,
    public prev: Node<T> | undefined,
    public next: Node<T> | undefined,
    public _list: List<T>
  ) {}
}

export class List<T> {
  private _head: Node<T> | undefined;
  private _tail: Node<T> | undefined;

  #length = 0;
  get length() {
    return this.#length;
  }

  toString(): string {
    return Array.from(this.values()).toString();
  }

  toJSON() {
    return Array.from(this.values());
  }

  /**
   * node at a certain position
   * @param pos
   */
  nodeAt(pos: number): ReadonlyNode<T> | undefined {
    // out of range
    if (pos >= this.#length) {
      return undefined;
    }

    // from start to end...
    if (pos >= 0) {
      let i = 0;

      for (let node = this._head; node != null; node = node?.next) {
        if (i++ === pos) {
          return node;
        }
      }
    }

    // from end to start...
    let i = -1;
    for (let node = this._tail; node != null; node = node?.prev) {
      if (i-- === pos) {
        return node;
      }
    }

    return undefined;
  }

  /**
   * value at a certain position
   * @param pos
   */
  at(pos: number): T | undefined {
    const node = this.nodeAt(pos);

    if (node == null) {
      return undefined;
    }

    return node.value;
  }

  /**
   * pop the back element.
   */
  pop(): T | undefined {
    if (!this.#length) {
      return undefined;
    }

    const tail = this._tail;
    if (tail == null) {
      return undefined;
    }
    const prev = tail.prev;
    if (prev) {
      prev.next = undefined;
    }
    this._tail = prev;
    this.#length--;

    return tail.value;
  }

  /**
   * Return the front element and remove it.
   */
  shift(): T | undefined {
    if (this.#length === 0) {
      return undefined;
    }

    const head = this._head;
    if (head == null) {
      return undefined;
    }

    const next = head.next;
    if (next) {
      if (next.next == null) {
        this._tail = undefined;
      }
      next.prev = undefined;
    }
    this._head = next;
    this.#length--;

    return head.value;
  }

  /**
   * Push an element to the end of the linklist.
   * @param value
   */
  push(value: T): ReadonlyNode<T> {
    const prev = this._tail ?? this._head;
    const node = new Node(value, prev, undefined, this);

    if (prev) {
      prev.next = node;
      this._tail = node;
    } else {
      this._head = node;
    }
    this.#length++;
    return node;
  }

  /**
   * Unshift an element to the front of the list.
   * @param value
   */
  unshift(value: T): ReadonlyNode<T> {
    const next = this._head;
    const node = new Node(value, undefined, next, this);

    if (next) {
      next.prev = node;
    }
    this._head = node;
    this.#length++;
    return node;
  }

  remove(node: ReadonlyNode<T>) {
    const myNode = node as Node<T>;
    if (myNode._list !== this) {
      return;
    }
    const prev = myNode.prev;
    const next = myNode.next;
    if (next) {
      next.prev = prev;
    } else {
      this._tail = prev;
    }
    if (prev) {
      prev.next = next;
    } else {
      this._head = next;
    }
    this.#length--;
  }

  *values() {
    let node = this._head;
    while (node != null) {
      yield node.value;
      node = node.next;
    }
  }
}
