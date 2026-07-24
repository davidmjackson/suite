// lib/rate-limit.js
export function createLimiter({ max, windowMs }) {
  const buckets = new Map();
  return {
    check(key) {
      const now = Date.now();
      let arr = buckets.get(key);
      if (!arr) {
        arr = [];
        buckets.set(key, arr);
      }
      while (arr.length && arr[0] < now - windowMs) arr.shift();
      if (arr.length >= max) return false;
      arr.push(now);
      return true;
    },
  };
}
