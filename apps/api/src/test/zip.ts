import { crc32, inflateRawSync } from 'node:zlib'
import { expect } from 'vitest'

/** Reads a ZIP back through its central directory, checking every checksum. */
export function readZip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const total = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, string>()
  for (let index = 0; index < total; index += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    expect(zip.readUInt16LE(at + 8) & 0x0800).toBe(0x0800)
    const checksum = zip.readUInt32LE(at + 16)
    const compressedSize = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const offset = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const dataStart = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28)
    const content = inflateRawSync(zip.subarray(dataStart, dataStart + compressedSize))
    expect(crc32(content)).toBe(checksum)
    files.set(name, content.toString('utf8'))
    at += 46 + nameLength
  }
  return files
}
