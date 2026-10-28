/**
 * Unit tests for readNewFileLines and completeLinesSize.
 *
 * The critical invariant: a line the writer has only partly flushed is never
 * lost. readNewFileLines stops at the last newline, so the unfinished line is
 * read again — whole — on a later call.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readNewFileLines, completeLinesSize } from '../src/core/fs-utils'

describe('readNewFileLines', () => {
  let dir: string
  let file: string

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-fs-utils-'))
    file = path.join(dir, 'sample.jsonl')
  })

  after(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns null when file has not grown', () => {
    fs.writeFileSync(file, 'line1\n')
    const size = fs.statSync(file).size
    assert.equal(readNewFileLines(file, size), null)
  })

  it('splits complete lines and advances to the end', () => {
    fs.writeFileSync(file, 'a\nb\nc\n')
    const r = readNewFileLines(file, 0)
    assert.ok(r)
    assert.deepEqual(r!.lines, ['a', 'b', 'c'])
    assert.equal(r!.newSize, fs.statSync(file).size)
  })

  it('stops before a trailing partial line', () => {
    fs.writeFileSync(file, 'first\nsecond-incompl')
    const r = readNewFileLines(file, 0)
    assert.ok(r)
    assert.deepEqual(r!.lines, ['first'])
    assert.equal(r!.newSize, Buffer.byteLength('first\n'))
  })

  it('returns a line split across two writes once it is complete', () => {
    // Simulate a JSONL writer that flushes mid-line.
    fs.writeFileSync(file, '{"type":"session_meta","pay')
    assert.equal(readNewFileLines(file, 0), null)

    // Writer appends the rest of the line plus a new one.
    fs.appendFileSync(file, 'load":{}}\n{"type":"other"}\n')
    const r = readNewFileLines(file, 0)
    assert.ok(r)
    assert.deepEqual(r!.lines, [
      '{"type":"session_meta","payload":{}}',
      '{"type":"other"}',
    ])
  })

  it('never splits a multi-byte UTF-8 character', () => {
    const line = '{"text":"xin chào — 日本"}'
    const bytes = Buffer.from(line + '\n')
    // Cut inside the last multi-byte character
    fs.writeFileSync(file, bytes.subarray(0, bytes.length - 4))
    assert.equal(readNewFileLines(file, 0), null)
    fs.appendFileSync(file, bytes.subarray(bytes.length - 4))
    assert.deepEqual(readNewFileLines(file, 0)!.lines, [line])
  })

  it('resets to 0 when the file is truncated', () => {
    fs.writeFileSync(file, 'only\n')
    const r = readNewFileLines(file, 9999)
    assert.ok(r)
    assert.deepEqual(r!.lines, [])
    assert.equal(r!.newSize, 0)
  })

  it('tolerates CRLF line endings', () => {
    fs.writeFileSync(file, 'x\r\ny\r\n')
    const r = readNewFileLines(file, 0)
    assert.ok(r)
    assert.deepEqual(r!.lines, ['x', 'y'])
  })

  it('returns null when the file does not exist', () => {
    assert.equal(readNewFileLines(path.join(dir, 'missing.jsonl'), 0), null)
  })
})

describe('completeLinesSize', () => {
  it('counts bytes through the last newline only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-fs-utils-'))
    const file = path.join(dir, 'f.jsonl')
    fs.writeFileSync(file, 'one\ntwo\nthr')
    assert.equal(completeLinesSize(file, fs.statSync(file).size), Buffer.byteLength('one\ntwo\n'))
    assert.equal(completeLinesSize(file, 2), 0)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
