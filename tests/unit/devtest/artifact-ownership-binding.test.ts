import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectTaskEvidence } from '../../../src/devtest/evidence-collectors.js';
import { discoverModelContract } from '../../../src/devtest/env-probe.js';
import type { VerifyContext } from '../../../src/devtest/verify-pipeline.js';

/**
 * 归属绑定 fail-closed 锁 (artifact-ownership binding lock)
 * ------------------------------------------------------------------
 * 背景 (LIVE 假绿): 真实成功任务 (task_status=2) 下, 若 operator 经 MCP 预置
 * asset_buffer/artifact_buffer, 旧实现无条件把 mediaArtifactSource 标为 'TASK_SNAPSHOT'、
 * artifactOwnership 标为 'VERIFIED' —— 任意可解码字节即可冒充该任务的真实产物, 骗取
 * legacy-protocol-mappers 的 MEDIA_BINARY:CONTAINER_CHECK observationStatus='PASS'
 * (该键是所有媒体任务的 REQUIRED evidence), 从而顶到整体 PASS。
 *
 * 修复 (fail-closed): VERIFIED 必须"挣得"——仅当工具亲自从任务自有快照 URL 下载字节,
 * 或 operator 显式 artifactOwnership==='VERIFIED' 断言时才判 VERIFIED; 预置的裸 buffer
 * 归 'EXTERNAL_BUFFER' + 'UNVERIFIED', 迫使 CONTAINER_CHECK → UNVERIFIED (required 键
 * 不满足 → 整体 UNVERIFIED)。
 *
 * 本锁在旧实现上必须 RED (旧实现产出 VERIFIED/TASK_SNAPSHOT)。
 * VITEST 环境下 shouldQueryDb=false, 不触真实 DB; 全链路由 mock 的 global.fetch 驱动, 完全 hermetic。
 */

// 轮询响应: pollTaskStatus 只读 res.ok / res.json(); data[].id 命中 taskId、task_status=2 即判成功
const REAL_POLL_SUCCESS = (taskId: number, videoUrl: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: [{ id: taskId, task_status: 2, video_url: videoUrl }] }),
});

function buildRealCtx(taskId: number): VerifyContext {
  return {
    taskId,
    mediaType: 'video',
    modelId: 84,
    contract: discoverModelContract(84, 'video'),
    expectedPoints: 100,
    expectedChargeSource: 'DEVTEST_EXPECTATION',
    expectedPointsSource: 'DEVTEST_CALCULATED',
    systemCalculatedExpectedPoints: 100,
    // base_url 含 example.com → 跳过 runtimeDetails 查询; mock 的 fetch 令轮询立即返回 task_status=2
    session: { env: 'test', base_url: 'https://test.example.com', cookie_string: 'PHPSESSID=lock-test' },
    executionMode: 'real',
  } as VerifyContext;
}

describe('artifact-ownership binding (fail-closed 锁)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('LIVE 锁: 真实成功任务 + operator 注入 artifactBuffer → 归属 UNVERIFIED / 来源 EXTERNAL_BUFFER (不得冒充 TASK_SNAPSHOT)', async () => {
    global.fetch = vi.fn(async () =>
      REAL_POLL_SUCCESS(90001, 'https://cdn.panqu.com/v_90001.mp4'),
    ) as unknown as typeof fetch;
    const injected = Buffer.from('any-bytes-operator-could-supply');
    const res = await collectTaskEvidence(buildRealCtx(90001), { taskId: 90001, artifactBuffer: injected });

    expect(res.terminalStatus).toBe('SUCCESS'); // 任务确实成功
    // 关键断言: 注入字节未经工具下载, 归属不可判 → fail-closed (旧实现在此产出 VERIFIED → RED)
    expect(res.artifactOwnership).toBe('UNVERIFIED');
    expect(res.mediaArtifactSource).toBe('EXTERNAL_BUFFER');
  });

  it('回归护栏: 真实成功任务 + 无 operator buffer → 工具亲自下载, 归属 VERIFIED / 来源 TASK_SNAPSHOT (合法 happy path 不误伤)', async () => {
    // 轮询返回 task_status=2; 媒体下载 (fetchFirst64K) 走同一 mock 返回非 2xx → 探测置空, 但不影响归属判定
    global.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('cdn.panqu.com')) return { ok: false, status: 403 } as unknown as Response;
      return REAL_POLL_SUCCESS(90002, 'https://cdn.panqu.com/v_90002.mp4') as unknown as Response;
    }) as unknown as typeof fetch;
    const res = await collectTaskEvidence(buildRealCtx(90002), { taskId: 90002 });

    expect(res.terminalStatus).toBe('SUCCESS');
    expect(res.artifactOwnership).toBe('VERIFIED');
    expect(res.mediaArtifactSource).toBe('TASK_SNAPSHOT');
  });

  it('显式断言逃生门: operator 注入 buffer 且显式 artifactOwnership=VERIFIED → 尊重断言 (VERIFIED)', async () => {
    global.fetch = vi.fn(async () =>
      REAL_POLL_SUCCESS(90003, 'https://cdn.panqu.com/v_90003.mp4'),
    ) as unknown as typeof fetch;
    const res = await collectTaskEvidence(buildRealCtx(90003), {
      taskId: 90003,
      artifactBuffer: Buffer.from('x'),
      artifactOwnership: 'VERIFIED',
    });

    expect(res.terminalStatus).toBe('SUCCESS');
    expect(res.artifactOwnership).toBe('VERIFIED');
    // 显式断言下来源仍标 EXTERNAL_BUFFER (未下载), 但归属尊重 operator 断言
    expect(res.mediaArtifactSource).toBe('EXTERNAL_BUFFER');
  });
});
