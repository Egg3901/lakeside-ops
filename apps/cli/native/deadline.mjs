// @ts-check
/** @template T @param {Promise<T>} pending @param {number} milliseconds @param {() => void} expire @returns {Promise<T>} */
export async function deadline(pending, milliseconds, expire) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    /** @type {Promise<never>} */
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => { expire(); reject(new Error("Native protocol request timed out; no automatic retry")); }, milliseconds);
    });
    return await Promise.race([pending, expired]);
  } finally { clearTimeout(timer); }
}
