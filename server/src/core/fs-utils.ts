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

/** Chunk size for scanning large transcripts. Session files can grow past
 *  700 MB — far beyond what fits in one JS string (~512 MB) — so they are
 *  never read whole. */
const SCAN_CHUNK_BYTES = 4 * 1024 * 1024

/**
 * Size of the file's first `size` bytes up to and including the last newline —
 * i.e. how much of it is complete lines. A JSONL writer may be mid-line, and
 * anything after the last newline must be read again once it is finished.
 * Searches backwards from `size`, so only the tail of the file is read.
 */
export function completeLinesSize(filePath: string, size: number): number {
  if (size <= 0) return 0
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(SCAN_CHUNK_BYTES, size))
      let end = size
      while (end > 0) {
        const start = Math.max(0, end - buffer.length)
        const read = fs.readSync(fd, buffer, 0, end - start, start)
        const idx = buffer.subarray(0, read).lastIndexOf(0x0a)
        if (idx !== -1) return start + idx + 1
        end = start
      }
      return 0
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return 0
  }
}

/**
 * Call `onLine` for every complete line in the file's first `size` bytes,
 * reading in fixed-size chunks so files of any size can be scanned.
 * Lines are split on raw bytes, so a UTF-8 character is never cut in half.
 */
export function forEachLine(filePath: string, size: number, onLine: (line: string) => void): void {
  const fd = fs.openSync(filePath, 'r')
  try {
    const chunk = Buffer.alloc(Math.min(SCAN_CHUNK_BYTES, Math.max(size, 1)))
    let carry: Buffer = Buffer.alloc(0)
    let offset = 0
    while (offset < size) {
      const read = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), offset)
      if (read <= 0) break
      offset += read
      const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, read)]) : chunk.subarray(0, read)
      let start = 0
      let nl = data.indexOf(0x0a, start)
      while (nl !== -1) {
        const line = data.toString('utf-8', start, nl > start && data[nl - 1] === 0x0d ? nl - 1 : nl)
        if (line) onLine(line)
        start = nl + 1
        nl = data.indexOf(0x0a, start)
      }
      // Copy: `data` may alias `chunk`, which the next read overwrites
      carry = Buffer.from(data.subarray(start))
    }
    if (carry.length) {
      const line = carry.toString('utf-8')
      if (line) onLine(line)
    }
  } finally {
    fs.closeSync(fd)
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
