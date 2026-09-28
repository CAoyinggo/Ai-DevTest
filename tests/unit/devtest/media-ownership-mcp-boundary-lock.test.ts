import { describe, it, expect, vi, afterEach } from 'vitest';
import { DevTestMcpService } from '../../../src/devtest/mcp-service.js';
import * as mediaFlow from '../../../src/devtest/media-flow.js';
import { createSyntheticValidMp4 } from '../../../src/devtest/media-inspector.js';

/**
 * 媒体归属 MCP 边界 fail-closed 锁 (media-ownership-mcp-boundary)
 * ------------------------------------------------------------------------------------
 * 背景 (LATENT/纵深防御, 未接线的 landmine — 非现行漏洞):
 *   媒体 MEDIA_BINARY:CONTAINER_CHECK 判 PASS 需 `decodable === true` 且 `ownership === 'VERIFIED'`
 *   (legacy-protocol-mappers:1249)。REAL 成功下 ownership='VERIFIED' 只有两条来路:
 *     (a) 工具亲自从任务**自有快照** finalSnapshot.videoUrl 下载字节 (evidence-collectors:205-208, operator 无从影响);
 *     (b) 调用方显式 `options.artifactOwnership === 'VERIFIED'` 断言 (:161/:221/:236/:291/:306-308 的逃生舱)。
 *   operator 若能同时注入「任意可解码字节 artifact_buffer」+「artifact_ownership:'VERIFIED'」, 即可让外部字节
 *   冒充该任务真实产物、骗取媒体 PASS。**唯一**挡住这条路的, 是 mcp-service.ts:795-916 的 verify 转发白名单
 *   **不含** artifactOwnership —— 即 operator (不可信 MCP 面) 造得出 artifact_buffer(:893 已转发), 却设不了归属开关。
 *
 *   这与 retry_log / billing scoreLogs 同属「operator 面可达、逃生开关未接线」的 landmine: 一旦有人给
 *   mcp-service verify 转发块补上一行 `artifactOwnership: args.artifact_ownership ...`(与其它 snake_case 字段对称,
 *   极易被"顺手补全"), 逃生舱即对 operator 敞开 → REAL 下注入字节洗出媒体假 PASS。
 *
 * 本锁在**真实不可信边界** (DevTestMcpService.call, 而非受信的 verify() 直调) 端到端钉死:
 *   REAL 成功 + operator 注入 artifact_buffer + operator 谎报 artifact_ownership:'VERIFIED' →
 *   归属断言**不得生效** (ownership 仍 UNVERIFIED、媒体不 PASS、来源 EXTERNAL_BUFFER)。
 *   精度: 无 buffer 时工具从任务自有快照挣得的 VERIFIED 经同一 MCP 边界仍如实成立 (不误伤真绿、锁非空转)。
 *
 * teeth(RED-on-weakening): 给 mcp-service.ts:893 前后的 verify 转发块补
 *   `artifactOwnership: (args.artifact_ownership === 'VERIFIED' ? 'VERIFIED' : undefined),`
 *   → 用例①② RED (operator 谎报生效、ownership 翻 VERIFIED、媒体 PASS); ③(真绿) 恒 GREEN。
 */

const BASE_URL = 'https://test-main.example.com';
const validMp4 = createSyntheticValidMp4({ width: 1280, height: 720, durationSeconds: 4 });

// 经 session_file 走 resolveVerifyContext 的 loadPanquSession 分支 → session 存在 & 非 auto →
// executionMode 落 'real'(verify-pipeline:567)。base_url 含 example.com → 跳过 runtime 只读查询。
function mockSession() {
  return vi.spyOn(mediaFlow, 'loadPanquSession').mockResolvedValue({
    env: 'test',
    base_url: BASE_URL,
    cookie_string: 'PHPSESSID=mock_media_owner_lock',
  });
}

function mockPollSuccess(taskId: number) {
  return vi.spyOn(mediaFlow, 'pollTaskStatus').mockResolvedValue({
    finalSnapshot: {
      taskId,
      taskStatus: 2,
      statusLabel: '成功',
      videoUrl: `https://cdn.example.com/earned_${taskId}.mp4`,
      progress: 100,
      pollCount: 1,
      durationMs: 10,
    },
    totalPolls: 1,
    timeline: [],
  });
}

// 经 MCP 不可信边界发起 verify;operator 注入 artifact_buffer + 谎报 artifact_ownership='VERIFIED'
// (snake_case 与 camelCase 双拼, 覆盖任何一种"顺手补全"式转发)。
async function callVerifyViaMcp(taskId: number, args: Record<string, unknown>) {
  const service = new DevTestMcpService();
  return service.call({
    action: 'verify',
    task_id: taskId,
    model_id: 84,
    media_type: 'video',
    session_file: '/dummy/session.json',
    gateway_channel_confirmed: true,
    db_extra_confirmed: true,
    ...args,
  });
}

type MediaEv = { status: string; source: string; ownership: string; decodable?: boolean };
function mediaOf(result: unknown): MediaEv {
  const data = (result as { data?: { evidence?: { media?: MediaEv } } }).data;
  return data!.evidence!.media!;
}

describe('媒体归属 MCP 边界 (operator 谎报 artifact_ownership 不得生效, REAL fail-closed 锁)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('① LANDMINE 锁: REAL 成功 + operator 注入 artifact_buffer + 谎报 artifact_ownership=VERIFIED → 归属断言不生效, 归属仍 UNVERIFIED、媒体不 PASS (补转发即 RED)', async () => {
    const taskId = 910001;
    const sessionSpy = mockSession();
    const pollSpy = mockPollSuccess(taskId);
    const result = await callVerifyViaMcp(taskId, {
      artifact_buffer: validMp4, // operator 自带的任意可解码字节
      artifact_ownership: 'VERIFIED', // operator 谎报"已验真绑定"(snake_case)
      assetOwnership: 'VERIFIED', // 再试 camelCase, 双保险
      asset_ownership: 'VERIFIED',
    });
    pollSpy.mockRestore();
    sessionSpy.mockRestore();
    const media = mediaOf(result);
    // operator 的归属断言经 MCP 面**未被转发** → 逃生舱够不着 → 归属保持 fail-closed。
    expect(media.ownership).toBe('UNVERIFIED');
    expect(media.source).toBe('EXTERNAL_BUFFER'); // 外部字节, 非工具从任务快照挣得
    expect(media.status).not.toBe('PASS'); // 归属未验真 → 媒体绝不 PASS
  });

  it('② decodable 但归属未验真: 注入的字节结构完全合法(decodable=true), 唯一卡点是归属来路 → 坐实闸在归属而非解码', async () => {
    const taskId = 910002;
    const sessionSpy = mockSession();
    const pollSpy = mockPollSuccess(taskId);
    const result = await callVerifyViaMcp(taskId, {
      artifact_buffer: validMp4,
      artifact_ownership: 'VERIFIED',
    });
    pollSpy.mockRestore();
    sessionSpy.mockRestore();
    const media = mediaOf(result);
    // 字节本身可解码(否则攻击不"像样") —— 证明拦截点确是归属 provenance, 而非碰巧解码失败。
    expect(media.decodable).toBe(true);
    expect(media.ownership).not.toBe('VERIFIED');
    expect((result as { passed?: boolean }).passed).not.toBe(true);
  });

  it('③ 精度不误伤真绿: REAL 成功 + 无 buffer → 工具亲自从任务自有快照下载字节, 归属 VERIFIED 经同一 MCP 边界仍如实成立 (补转发后恒 GREEN)', async () => {
    const taskId = 910003;
    const sessionSpy = mockSession();
    const pollSpy = mockPollSuccess(taskId);
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('cdn.example.com')) {
        return {
          ok: true,
          status: 206,
          statusText: 'Partial Content',
          arrayBuffer: async () =>
            validMp4.buffer.slice(validMp4.byteOffset, validMp4.byteOffset + validMp4.byteLength),
        } as unknown as Response;
      }
      return originalFetch(url as unknown as string, init);
    }) as unknown as typeof fetch;

    const result = await callVerifyViaMcp(taskId, {}); // 不给 buffer、不给 ownership: 让工具自挣归属
    global.fetch = originalFetch;
    pollSpy.mockRestore();
    sessionSpy.mockRestore();
    const media = mediaOf(result);
    // 工具从任务**自有**快照 URL 下载 → 与该任务物理绑定, 归属如实 VERIFIED(operator 无从参与也无需参与)。
    expect(media.ownership).toBe('VERIFIED');
    expect(media.source).toBe('TASK_SNAPSHOT');
    expect(media.decodable).toBe(true);
  });
});
