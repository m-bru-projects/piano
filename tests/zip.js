import { crc32, deflateRawSync } from 'node:zlib';

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach(file => {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.data ?? '');
    const method = file.method ?? 0;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const checksum = crc32(raw) >>> 0;
    const compressedSize = file.compressedSize ?? stored.length;
    const uncompressedSize = file.uncompressedSize ?? raw.length;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(checksum),
      u32(stored.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      stored
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(checksum),
      u32(compressedSize),
      u32(uncompressedSize),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  });

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0)
  ]);
  const archive = Buffer.concat([...locals, centralDir, eocd]);
  return archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength);
}
