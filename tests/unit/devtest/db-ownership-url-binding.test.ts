import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectTaskEvidence } from '../../../src/devtest/evidence-collectors.js';
import { discoverModelContract } from '../../../src/devtest/env-probe.js';
import type { VerifyContext } from '../../../src/devtest/verify-pipeline.js';
import type { DatabaseRawCollection } from '../../../src/devtest/database-evidence-producer.js';

/**
 * DB 物理落库归属 URL 绑定 fail-closed 锁 (db-ownership-url-binding)
 * ------------------------------------------------------------------
 * 背景 (LATENT/纵深防御假绿): evidence-collectors.ts DB 物理落库分支在
 * `!artifactBuffer && dbMediaUrl` 时无条件盖 mediaArtifactSource='DATABASE_PHYSICAL_RECORD'
 * + artifactOwnership='VERIFIED'。旧实现 dbMediaUrl 取
 *   `taskEvidence.videoUrl || resolveDbMediaUrl()`
 * —— 而离线分支 (:288) 会把 operator 传入的 options.videoUrl 写进 taskEvidence.videoUrl。
 * 于是"DB 有该任务记录(但记录自身无产物 URL) + operator 塞任意 videoUrl + 首个探测失败(无 buffer)"
 * 时, operator 的任意 URL 被当作 DB 物理产物下载并盖 DATABASE_PHYSICAL_RECORD/VERIFIED ——
 * provenance 谎报 + 归属 VERIFIED 非"挣得", 与 artifact-ownership 同一失效开口。
 *
 * 修复 (fail-closed): dbMediaUrl 只取 resolveDbMediaUrl() (DB 记录自有 video_url/image_url),
 * 绝不回退 taskEvidence.videoUrl。DB 记录自身无产物 URL → 不盖 DATABASE_PHYSICAL_RECORD/VERIFIED,
 * 归属维持上游 fail-closed (EXTERNAL_URL/UNVERIFIED)。
 *
 * 可达性: 原始 DB 采集 (dbRawCollection) 非 MCP operator 可注入 (mcp-service 未透传),
 * 本锁经 options.dbRawCollection 内部注入缝复现内部契约 → 定性纵深防御/预加固,
 * 遵循"未接线 landmine 也值得预加固+锁"。VITEST 下 shouldQueryDb=false, 不触真实 DB;
 * global.fetch 全 mock 为非 2xx → 探测恒空, 迫使归属由 DB 分支唯一决定, 完全 hermetic。
 *
 * 旧实现下 attack 用例必 RED (盖 DATABASE_PHYSICAL_RECORD/VERIFIED); happy-path 恒 GREEN 证精度。
 */

const MODEL_VIDEO = 84;

function buildOfflineRealCtx(taskId: number): VerifyContext {
  return {
    taskId,
    mediaType: 'video',
    modelId: MODEL_VIDEO,
    contract: discoverModelContract(MODEL_VIDEO, 'video'),
    expectedPoints: 100,
    expectedChargeSource: 'DEVTEST_EXPECTATION',
    expectedPointsSource: 'DEVTEST_CALCULATED',
    systemCalculatedExpectedPoints: 100,
    // 关键: session=null 且不设 sessionLoadError → 走离线 else 分支 (:257),
    // operator videoUrl 经 :288 落入 taskEvidence.videoUrl (旧实现泄漏源)。
    session: null,
    executionMode: 'real',
  } as VerifyContext;
}

// DB 物理落库注入缝 (options.dbRawCollection): 视频消费 recordsFound.pq_aivideo_new。
function dbCollection(taskId: number, rec: Record<string, unknown>): DatabaseRawCollection {
  return {
    status: 'VERIFIED',
    taskId,
    recordsFound: { pq_aivideo_new: { id: taskId, ...rec } },
  } as DatabaseRawCollection;
}

describe('DB 物理落库归属 URL 绑定 (fail-closed 锁)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // 全链路探测 mock 为非 2xx → fetchFirst64K 恒返回 null, artifactBuffer 恒空,
  // 归属只能由 DB 分支 (:475-477) 决定, 排除"探测下载已置 buffer 从而跳过 DB 盖章"的干扰。
  const mockFetchAlways403 = () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response) as unknown as typeof fetch;
  };

  it('LATENT 锁: DB 有记录但记录自身无产物 URL + operator 注入 videoUrl → 不得盖 DATABASE_PHYSICAL_RECORD/VERIFIED (旧实现在此泄漏 → RED)', async () => {
    mockFetchAlways403();
    const ctx = buildOfflineRealCtx(700001);
    // task_status=1: 非终态, 不触发 :445/:455 重建 → taskEvidence.videoUrl 保留 operator URL 直到 :474。
    // 记录自身无 video_url → resolveDbMediaUrl() = undefined。
    const res = await collectTaskEvidence(ctx, {
      taskId: 700001,
      videoUrl: 'https://operator-injected.example.com/forged_700001.mp4',
      dbRawCollection: dbCollection(700001, { task_status: 1 }),
    });

    // 关键断言: operator URL 未经工具从任务自有落库 URL 取得, 归属不可"挣得"。
    expect(res.artifactOwnership).toBe('UNVERIFIED');
    expect(res.mediaArtifactSource).toBe('EXTERNAL_URL');
    expect(res.mediaArtifactSource).not.toContain('DATABASE_PHYSICAL_RECORD');
    // 非终态 DB 记录不得被 operator URL 顶成 SUCCESS。
    expect(res.terminalStatus).toBe('UNKNOWN');
  });

  it('回归护栏: DB 记录 task_status=2 且自带 video_url → 合法盖 DATABASE_PHYSICAL_RECORD/VERIFIED/SUCCESS (不误伤)', async () => {
    mockFetchAlways403();
    const ctx = buildOfflineRealCtx(700002);
    const res = await collectTaskEvidence(ctx, {
      taskId: 700002,
      dbRawCollection: dbCollection(700002, {
        task_status: 2,
        video_url: 'https://v.panqu.com.cn/real_db_700002.mp4',
      }),
    });

    expect(res.terminalStatus).toBe('SUCCESS');
    expect(res.artifactOwnership).toBe('VERIFIED');
    expect(res.mediaArtifactSource).toBe('DATABASE_PHYSICAL_RECORD:pq_aivideo_new');
  });

  it('边界精度: DB 记录 task_status=2 自带 video_url + operator 另塞 videoUrl → 绑定 DB 自有 URL, 归属 VERIFIED (operator URL 被 :453 覆盖, 不参与归属)', async () => {
    mockFetchAlways403();
    const ctx = buildOfflineRealCtx(700003);
    const res = await collectTaskEvidence(ctx, {
      taskId: 700003,
      videoUrl: 'https://operator-injected.example.com/forged_700003.mp4',
      dbRawCollection: dbCollection(700003, {
        task_status: 2,
        video_url: 'https://v.panqu.com.cn/real_db_700003.mp4',
      }),
    });

    // 真实成功 DB 记录: 其自有 URL 经 :453 覆盖 taskEvidence.videoUrl, operator URL 出局。
    // 新旧实现在此一致 (GREEN both) —— 泄漏仅发生在 task_status≠2 (记录未重建) 路径, 见首个用例。
    expect(res.terminalStatus).toBe('SUCCESS');
    expect(res.artifactOwnership).toBe('VERIFIED');
    expect(res.mediaArtifactSource).toBe('DATABASE_PHYSICAL_RECORD:pq_aivideo_new');
  });
});
