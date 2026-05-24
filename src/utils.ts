export function lineCol(source: string, byteOffset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < byteOffset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export function snippetAround(source: string, offset: number, halfWidth = 20): string {
  const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lineEndRaw = source.indexOf('\n', offset);
  const lineEnd = lineEndRaw === -1 ? source.length : lineEndRaw;
  const offsetInLine = offset - lineStart;
  const start = Math.max(0, offsetInLine - halfWidth);
  const end = Math.min(lineEnd - lineStart, offsetInLine + halfWidth);
  let snip = source.slice(lineStart + start, lineStart + end);
  if (start > 0) snip = '...' + snip;
  if (end < lineEnd - lineStart) snip = snip + '...';
  return snip;
}

export function nowIso(): string {
  return new Date().toISOString();
}
