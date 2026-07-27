const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Generate a valid PNG buffer of size x size with an accent color (#6366F1)
function createPngBuffer(size, r = 99, g = 102, b = 241) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8);      // bit depth
  ihdr.writeUInt8(6, 9);      // color type (RGBA)
  ihdr.writeUInt8(0, 10);     // compression
  ihdr.writeUInt8(0, 11);     // filter
  ihdr.writeUInt8(0, 12);     // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw image data: size lines, each starting with filter byte 0, then size * 4 RGBA bytes
  const lineLength = 1 + size * 4;
  const rawData = Buffer.alloc(size * lineLength);

  for (let y = 0; y < size; y++) {
    const offset = y * lineLength;
    rawData[offset] = 0; // Filter type None
    for (let x = 0; x < size; x++) {
      const pxOffset = offset + 1 + x * 4;
      // Draw rounded rectangle effect or solid gradient background
      const border = Math.floor(size * 0.1);
      const isInner = x >= border && x < size - border && y >= border && y < size - border;
      
      if (isInner) {
        rawData[pxOffset] = r;     // R
        rawData[pxOffset + 1] = g; // G
        rawData[pxOffset + 2] = b; // B
        rawData[pxOffset + 3] = 255; // Alpha
      } else {
        rawData[pxOffset] = Math.max(0, r - 30);
        rawData[pxOffset + 1] = Math.max(0, g - 30);
        rawData[pxOffset + 2] = Math.max(0, b - 30);
        rawData[pxOffset + 3] = 255;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(12 + len);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);

  const crc = crc32(buf.slice(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const iconsDir = path.join(__dirname, '..', 'extension', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, createPngBuffer(size));
  console.log(`Generated ${filePath} (${size}x${size}px)`);
});
