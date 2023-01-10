/**
 *
 * @param iterator -
 */
export function first<T, TReturn = any, TNext = undefined>(
  iterator: Iterator<T, TReturn, TNext>
): T | undefined {
  const next = iterator.next();
  if (next.done) {
    return;
  }
  return next.value;
}

export default {
  first,
};
