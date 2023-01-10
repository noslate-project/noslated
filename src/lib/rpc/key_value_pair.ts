export function tuplesToPairs<T>(tuples: KVTuples<T>): KVPairs<T> {
  return tuples.map(it => {
    return {
      key: it[0],
      value: it[1],
    };
  });
}

export function pairsToTuples(pairs: KVPairs): KVTuples {
  return pairs.map(it => {
    return [it.key, it.value];
  });
}

export function pairsToMap<T>(pairs: KVPairs<T>): Record<string, T> {
  return pairs.reduce((ans, kv) => {
    ans[kv.key] = kv.value;
    return ans;
  }, {});
}

export function mapToPairs<T>(obj: Record<string, T>): KVPairs<T> {
  return tuplesToPairs(Object.entries<T>(obj));
}

export type KVTuples<T = string> = [string, T][];
export type KVPairs<T = string> = { key: string; value: T }[];
