// Crockford base32: no I, L, O, U — avoids ambiguous characters.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function generateId(length = 6): string {
  let id = '';
  for (let i = 0; i < length; i++) {
    id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return id;
}

/**
 * Per RFC-0002 §3: retry up to 20 times before erroring loudly.
 * With ~1B IDs per file, 20 consecutive collisions implies a corrupt RNG
 * or pathological annotation density — both worth surfacing.
 */
export function generateUniqueId(existing: Set<string>, length = 6): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = generateId(length);
    if (!existing.has(id)) return id;
  }
  throw new Error(
    `could not generate unique ${length}-char ID after 20 attempts; existing set has ${existing.size} ids`,
  );
}
