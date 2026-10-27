import jpeg from "jpeg-js";

/** Tiny image files for tests: just enough header for a size probe, or a real decodable JPEG. */

export function pngHeader(width: number, height: number, colorType = 6, extraChunk?: string): Buffer {
  const b = Buffer.alloc(33 + (extraChunk ? 12 : 0) + 12);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = colorType;
  let i = 33;
  if (extraChunk) {
    b.writeUInt32BE(0, i);
    b.write(extraChunk, i + 4, "ascii");
    i += 12;
  }
  b.writeUInt32BE(0, i);
  b.write("IDAT", i + 4, "ascii");
  return b;
}

export function jpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(16)]);
}

export function webpHeader(kind: "VP8X" | "VP8L" | "VP8 ", width: number, height: number, alpha = false): Buffer {
  const b = Buffer.alloc(40);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(32, 4);
  b.write("WEBP", 8, "ascii");
  b.write(kind, 12, "ascii");
  b.writeUInt32LE(10, 16);
  if (kind === "VP8X") {
    b[20] = alpha ? 0x10 : 0;
    b.writeUIntLE(width - 1, 24, 3);
    b.writeUIntLE(height - 1, 27, 3);
  } else if (kind === "VP8L") {
    b[20] = 0x2f;
    b.writeUInt32LE(((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0, 21);
  } else {
    b[23] = 0x9d;
    b[24] = 0x01;
    b[25] = 0x2a;
    b.writeUInt16LE(width, 26);
    b.writeUInt16LE(height, 28);
  }
  return b;
}

/** A real JPEG: a white backdrop with a dark rectangle where the "product" sits. */
export function productJpeg(width: number, height: number, box: { left: number; top: number; right: number; bottom: number }): Buffer {
  const data = Buffer.alloc(width * height * 4, 0xff);
  for (let y = box.top; y < box.bottom; y++) {
    for (let x = box.left; x < box.right; x++) {
      const i = (y * width + x) * 4;
      data[i] = 30;
      data[i + 1] = 30;
      data[i + 2] = 35;
    }
  }
  return jpeg.encode({ width, height, data }, 60).data;
}

export const imageResponse = (bytes: Buffer, type: string) => new Response(bytes, { status: 200, headers: { "content-type": type } });
