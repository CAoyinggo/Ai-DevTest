import { describe, expect, it } from 'vitest';
import {
  createSyntheticValidMp4,
  inspectBufferMedia,
  inspectImageBuffer,
  inspectMp4Buffer,
} from '../../../src/devtest/media-inspector.js';

describe('MediaInspector - 真实媒体物理校验器', () => {
  it('合法的完整 MP4 容器：成功解析 ftyp, moov, mvhd 时长与 tkhd 分辨率，校验通过', () => {
    const validMp4 = createSyntheticValidMp4({
      width: 1920,
      height: 1080,
      durationSeconds: 5,
      brand: 'mp42',
    });

    const result = inspectMp4Buffer(validMp4);

    expect(result.decodable).toBe(true);
    expect(result.qualityClassification).toBe('TASK_SUCCESS_AND_VALID');
    expect(result.format).toBe('mp4 (mp42)');
    expect(result.dimensions).toEqual({ width: 1920, height: 1080 });
    expect(result.durationSeconds).toBe(5);
    expect(result.hasVideoTrack).toBe(true);
    expect(result.hasMdat).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('截断的 MP4（仅 12 字节 ftyp 魔数头，缺失 moov 与 mdat）：精确识别为 FILE_INVALID', () => {
    const truncatedMp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');

    const result = inspectMp4Buffer(truncatedMp4);

    expect(result.decodable).toBe(false);
    expect(result.qualityClassification).toBe('FILE_INVALID');
    expect(result.reasons.some((r) => r.includes('缺少 moov 元数据块'))).toBe(true);
  });

  it('缺失 mdat 实体数据块的 MP4：标记未检测到媒体实体数据并判 FAIL', () => {
    // 构造有 ftyp + moov 但无 mdat
    const full = createSyntheticValidMp4({ width: 640, height: 360, durationSeconds: 3 });
    // 查找 mdat 位置截断
    const mdatIndex = full.indexOf(Buffer.from('mdat', 'ascii')) - 4;
    const noMdat = full.slice(0, mdatIndex);

    const result = inspectMp4Buffer(noMdat);

    expect(result.decodable).toBe(false);
    expect(result.hasMdat).toBe(false);
    expect(result.reasons.some((r) => r.includes('mdat'))).toBe(true);
  });

  it('合法的标准 PNG 图像：从 IHDR 块正确提取 1024x1024 尺寸，校验通过', () => {
    const pngBuffer = Buffer.concat([
      Buffer.from('89504e470d0a1a0a0000000d4948445200000400000004000806000000', 'hex'),
      Buffer.alloc(32),
    ]);

    const result = inspectImageBuffer(pngBuffer);

    expect(result.decodable).toBe(true);
    expect(result.format).toBe('png');
    expect(result.dimensions).toEqual({ width: 1024, height: 1024 });
    expect(result.qualityClassification).toBe('TASK_SUCCESS_AND_VALID');
  });

  it('完全无法识别或损坏的非多媒体 Buffer：安全返回 FILE_INVALID，不抛未捕获异常', () => {
    const badBuffer = Buffer.from('hello_this_is_plain_text_not_media');

    const videoResult = inspectBufferMedia(badBuffer, 'video');
    expect(videoResult.decodable).toBe(false);
    expect(videoResult.qualityClassification).toBe('FILE_INVALID');

    const imageResult = inspectBufferMedia(badBuffer, 'image');
    expect(imageResult.decodable).toBe(false);
    expect(imageResult.qualityClassification).toBe('FILE_INVALID');
  });

  describe('MP4 moov 范围覆盖与防假 PASS 回归验证 (Cases A-E)', () => {
    it('Case A: 已有 faststart / moov 在头部 (<64KB) -> PASS', () => {
      const faststartMp4 = createSyntheticValidMp4({ width: 1280, height: 720, durationSeconds: 4 });
      const result = inspectMp4Buffer(faststartMp4);

      expect(result.decodable).toBe(true);
      expect(result.qualityClassification).toBe('TASK_SUCCESS_AND_VALID');
      expect(result.dimensions).toEqual({ width: 1280, height: 720 });
      expect(result.durationSeconds).toBe(4);
    });

    it('Case B: 合法 MP4：moov > 64KB -> PASS', () => {
      // 构造 ftyp + 70KB 填充 mdat + 尾部 moov
      const base = createSyntheticValidMp4({ width: 1920, height: 1080, durationSeconds: 5 });
      const ftypBox = base.subarray(0, 24);
      const moovLen = base.readUInt32BE(24);
      const moovBox = base.subarray(24, 24 + moovLen);
      // 构造 70KB 的 mdat
      const paddingSize = 70000;
      const mdatHeader = Buffer.alloc(8);
      mdatHeader.writeUInt32BE(8 + paddingSize, 0);
      mdatHeader.write('mdat', 4, 'ascii');
      const mdatPadding = Buffer.alloc(paddingSize, 0xbb);

      // 文件结构: ftyp (24) + mdat (8 + 70000) + moov, moov 位于 offset 70032 (> 64KB)
      const headChunk = Buffer.concat([ftypBox, mdatHeader, mdatPadding.subarray(0, 65536 - 32)]);
      const tailChunk = Buffer.concat([mdatPadding.subarray(mdatPadding.length - 1000), moovBox]);

      const result = inspectMp4Buffer(headChunk, tailChunk);
      expect(result.decodable).toBe(true);
      expect(result.qualityClassification).toBe('TASK_SUCCESS_AND_VALID');
      expect(result.dimensions).toEqual({ width: 1920, height: 1080 });
      expect(result.durationSeconds).toBe(5);
    });

    it('Case C: 合法 MP4：moov 位于文件尾部 (真实盘古 Wan3.0 视频结构) -> PASS', () => {
      const base = createSyntheticValidMp4({ width: 1280, height: 720, durationSeconds: 4 });
      const ftyp = base.subarray(0, 24);
      const moovLen = base.readUInt32BE(24);
      const moov = base.subarray(24, 24 + moovLen);
      const mdat = base.subarray(24 + moovLen);

      // 模拟真实文件：ftyp + mdat + 尾部 moov
      const head = Buffer.concat([ftyp, mdat]);
      const tail = moov;

      const result = inspectMp4Buffer(head, tail);
      expect(result.decodable).toBe(true);
      expect(result.qualityClassification).toBe('TASK_SUCCESS_AND_VALID');
      expect(result.dimensions).toEqual({ width: 1280, height: 720 });
    });

    it('Case D: 真正缺失 moov -> 维持 FILE_INVALID', () => {
      const base = createSyntheticValidMp4({ width: 1280, height: 720 });
      const ftyp = base.subarray(0, 24);
      const moovLen = base.readUInt32BE(24);
      const mdat = base.subarray(24 + moovLen);
      const noMoovHead = Buffer.concat([ftyp, mdat]);
      const noMoovTail = Buffer.alloc(1024, 0xcc);

      const result = inspectMp4Buffer(noMoovHead, noMoovTail);
      expect(result.decodable).toBe(false);
      expect(result.qualityClassification).toBe('FILE_INVALID');
      expect(result.reasons.some((r) => r.includes('缺少 moov 元数据块'))).toBe(true);
    });

    it('Case E: 伪造 payload 中包含 "moov" 但不是合法 Box -> 绝不误 PASS', () => {
      const base = createSyntheticValidMp4({ width: 1280, height: 720 });
      const ftyp = base.subarray(0, 24);
      const moovLen = base.readUInt32BE(24);
      const mdat = base.subarray(24 + moovLen);
      const fakeTail = Buffer.alloc(1024);
      // 写入假 moov 字符串，但缺少合法 mvhd 与 trak 子 Box
      fakeTail.write('moov', 100, 'ascii');
      fakeTail.writeUInt32BE(120, 96); // 假 box 长度 120

      const result = inspectMp4Buffer(Buffer.concat([ftyp, mdat]), fakeTail);
      expect(result.decodable).toBe(false);
      expect(result.qualityClassification).toBe('FILE_INVALID');
      expect(result.reasons.some((r) => r.includes('缺少 moov 元数据块'))).toBe(true);
    });
  });

  describe('WebP 深度解析与防假 PASS 回归 (RIFF/WEBP 容器)', () => {
    const makeWebpHeader = (chunk: string, size = 30): Buffer => {
      const b = Buffer.alloc(size);
      b.write('RIFF', 0, 'ascii');
      b.writeUInt32LE(size - 8, 4);
      b.write('WEBP', 8, 'ascii');
      b.write(chunk, 12, 'ascii');
      return b;
    };
    const makeVP8X = (w: number, h: number): Buffer => {
      const b = makeWebpHeader('VP8X');
      b.writeUInt32LE(10, 16);
      b.writeUInt16LE((w - 1) & 0xffff, 24);
      b.writeUInt8(((w - 1) >> 16) & 0xff, 26);
      b.writeUInt16LE((h - 1) & 0xffff, 27);
      b.writeUInt8(((h - 1) >> 16) & 0xff, 29);
      return b;
    };
    const makeVP8Lossy = (w: number, h: number, withStartCode = true): Buffer => {
      const b = makeWebpHeader('VP8 ');
      b.writeUInt32LE(10, 16);
      if (withStartCode) {
        b.writeUInt8(0x9d, 23);
        b.writeUInt8(0x01, 24);
        b.writeUInt8(0x2a, 25);
      }
      b.writeUInt16LE(w & 0x3fff, 26);
      b.writeUInt16LE(h & 0x3fff, 28);
      return b;
    };

    it('W-A: 合法 VP8X 扩展帧 → 解析真实尺寸且 decodable', () => {
      const result = inspectImageBuffer(makeVP8X(1280, 720));
      expect(result.decodable).toBe(true);
      expect(result.format).toBe('webp');
      expect(result.dimensions).toEqual({ width: 1280, height: 720 });
      expect(result.qualityClassification).toBe('TASK_SUCCESS_AND_VALID');
    });
    it('W-B: 合法 VP8 简单有损（含关键帧 start code）→ 解析真实尺寸且 decodable', () => {
      const result = inspectImageBuffer(makeVP8Lossy(1024, 1024));
      expect(result.decodable).toBe(true);
      expect(result.dimensions).toEqual({ width: 1024, height: 1024 });
    });

    it('W-C: RIFF/WEBP 容器头 + 未知 chunk（旧实现臆造 1024×1024 假 PASS）→ 必须 FILE_INVALID', () => {
      const result = inspectImageBuffer(makeWebpHeader('XXXX'));
      expect(result.decodable).toBe(false);
      expect(result.qualityClassification).toBe('FILE_INVALID');
      expect(result.dimensions).toBeUndefined();
    });

    it('W-D: VP8 简单有损但缺失关键帧 start code（截断/损坏）→ 必须 FILE_INVALID，绝不假 PASS', () => {
      const result = inspectImageBuffer(makeVP8Lossy(800, 600, false));
      expect(result.decodable).toBe(false);
      expect(result.qualityClassification).toBe('FILE_INVALID');
    });

    it('W-E: 仅 16 字节 RIFF/WEBP 头、无 chunk payload → 必须 FILE_INVALID', () => {
      const result = inspectImageBuffer(makeWebpHeader('VP8X', 16));
      expect(result.decodable).toBe(false);
      expect(result.qualityClassification).toBe('FILE_INVALID');
    });
  });
});
