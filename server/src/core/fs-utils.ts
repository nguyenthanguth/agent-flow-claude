import * as fs from 'fs'

/** Read `length` bytes of a file starting at `offset`. Always closes the descriptor. */
function readBytes(filePath: string, offset: number, length: number): Buffer {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const read = fs.readSync(fd, buffer, 0, length, offset)
    return read < length ? buffer.subarray(0, read) : buffer
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Read a chunk of bytes from a file at a given offset, decoded as UTF-8.
 * Uses try/finally to guarantee the file descriptor is always closed.
 */
export function readFileChunk(filePath: string, offset: number, length: number): string {
  return readBytes(filePath, offset, length).toString('utf-8')
}

/**
 * Size of the file's first `size` bytes up to and including the last newline —
 * i.e. how much of it is complete lines. A JSONL writer may be mid-line, and
 * anything after the last newline must be read again once it is finished.
 */
export function completeLinesSize(filePath: string, size: number): number {
  if (size <= 0) return 0
  try {
    return readBytes(filePath, 0, size).lastIndexOf(0x0a) + 1
  } catch {
    return 0
  }
}

/**
 * Read complete lines appended to a file since `lastSize` bytes.
 *
 * `newSize` only advances past the last newline: a line the writer hasn't
 * finished yet is left in the file and returned on a later call, once its
 * newline lands. Working in bytes also keeps a multi-byte UTF-8 character
 * from being split across reads. Returns null when there is nothing new.
 * Handles truncation (file shrunk) by resetting to 0.
 */
export function readNewFileLines(
  filePath: string,
  lastSize: number,
): { lines: string[]; newSize: number } | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch { return null /* expected if file was removed */ }

  if (stat.size < lastSize) {
    // File was truncated — start over
    return { lines: [], newSize: 0 }
  }
  if (stat.size === lastSize) return null

  const bytes = readBytes(filePath, lastSize, stat.size - lastSize)
  const end = bytes.lastIndexOf(0x0a) + 1
  if (end === 0) return null // only a partial line so far

  const lines = bytes.subarray(0, end).toString('utf-8').split(/\r?\n/).filter(Boolean)
  return { lines, newSize: lastSize + end }
}

/** Case-fold a path string for comparison on Windows, where the filesystem is
 *  case-insensitive and tools disagree on drive-letter case (VS Code reports
 *  `c:\...`, Claude Code and most shells report `C:\...`). Identity elsewhere. */
export function foldPathCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}
