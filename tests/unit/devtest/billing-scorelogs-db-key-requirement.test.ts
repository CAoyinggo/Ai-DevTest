import { describe, it, expect, vi, afterEach } from 'vitest';
import { verify } from '../../../src/devtest/core-kernel.js';
import * as mediaFlow from '../../../src/devtest/media-flow.js';
import { createSyntheticValidMp4 } from '../../../src/devtest/media-inspector.js';
import type { DatabaseRawCollection } from '../../../src/devtest/database-evidence-producer.js';

/**
 * 计费 DB-key 必需性 fail-closed 锁 (billing-scorelogs-db-key-requirement)
 * ------------------------------------------------------------------------------------
 * 背景 (LATENT/纵深防御, 可达 MCP 缝, 非现行漏洞):
 *   mcp-service.ts:809 已把 operator 入参 `score_logs` 透传为 options.scoreLogs;计费对账据其算出
 *   `BILLING_LEDGER:TASK_RECORDS`, 且该信封 sourceType 恒 'BILLING_LEDGER'(非 FIXTURE/USER_ASSERTION),
 *   故 canonical-protocol.ts:711-725 的 REAL 来源隔离(按 sourceType 判)对它**形同虚设** —— operator 的
 *   scoreLogs 能让 BILLING_LEDGER:TASK_RECORDS 在 REAL 下 PASS。若计费的 REAL 兜底只系于"来源隔离",
 *   operator 即可凭空把 REAL 计费洗成真绿。
 *
 *   真正的 fail-closed 兜底不在来源隔离, 而在 verdict-projection.ts:1165-1168 的**结构性不变量**:
 *   REAL 生产(`!process.env.VITEST` 恒真, 或 dbCollection 存在, 或 dbVerify=true)时, **另外无条件**要求
 *   `SERVER_API:DB_TASK_RECORD` + `BILLING_LEDGER:DB_SCORE_LOGS` —— 二者只能由 DatabaseEvidenceProducer
 *   从真实物理落库(taskResult.dbEvidence / 可信 dbRawCollection)产出, operator 无从伪造(dbVerify/dbRawCollection
 *   均非 MCP 透传字段)。一旦有人 refactor 把这两条 push 挪到 operator 可控开关、或直接删掉, REAL 计费的
 *   最后一道结构闸就被静默拆除, operator scoreLogs 将独立满足 REAL 计费 → 假 PASS。
 *
 * 本锁钉死该结构不变量(与 canonical-protocol 来源隔离互补, 见 [[mcp-forwarded-untrusted-fields]]):
 *   REAL + operator scoreLogs 冒充计费 + DB 零物理佐证 → 必需 DB-key 双缺失, 整体裁决 fail-closed, 绝不 PASS。
 *   精度: 完整真实 DB 取证如实满足二键(不误伤真绿); 且二键各自独立强制(任务记录顶不上积分流水)。
 *
 * teeth(RED-on-weakening): 删掉 verdict-projection.ts:1166/1168 的两条 reqEvidence.push
 *   (`SERVER_API:DB_TASK_RECORD` / `BILLING_LEDGER:DB_SCORE_LOGS`), 用例①④必 RED; ③(真绿)恒 GREEN。
 */

const BASE_URL = 'https://test-main.example.com';
const validMp4 = createSyntheticValidMp4({ width: 1280, height: 720, durationSeconds: 4 });

const DB_TASK_KEY = 'SERVER_API:DB_TASK_RECORD';
const DB_SCORE_KEY = 'BILLING_LEDGER:DB_SCORE_LOGS';

function mockPollSuccess(taskId: number) {
  return vi.spyOn(mediaFlow, 'pollTaskStatus').mockResolvedValueOnce({
    finalSnapshot: {
      taskId,
      taskStatus: 2,
      statusLabel: '成功',
      videoUrl: `${BASE_URL}/o.mp4`,
      progress: 100,
      pollCount: 1,
      durationMs: 10,
    },
    totalPolls: 1,
    timeline: [],
  });
}

// 空 DB 取证: 真实只读取证跑了但零物理落库记录佐证(operator 的 scoreLogs 无库侧对应)。
function emptyDb(taskId: number): DatabaseRawCollection {
  return {
    status: 'UNVERIFIED',
    taskId,
    reason: 'NO_PHYSICAL_TASK_FOUND',
    recordsFound: {},
  } as unknown as DatabaseRawCollection;
}

// 完整 VERIFIED DB 取证(任务记录+积分流水), 用于精度/不误伤真绿; withScoreLogs=false 时抽掉积分流水。
function fullDb(taskId: number, opts?: { withScoreLogs?: boolean }): DatabaseRawCollection {
  const withScoreLogs = opts?.withScoreLogs !== false;
  return {
    status: 'VERIFIED',
    taskId: String(taskId),
    recordsFound: {
      pq_aivideo_new: {
        id: taskId,
        task_status: 2,
        status: 1,
        video_url: `${BASE_URL}/o.mp4`,
        extra: JSON.stringify({
          diversion: 10,
          points: 120,
          deduct_points: 120,
          selmodelsName: 'seedance-2.0',
          video_duration: '4',
          video_resolution: '720p',
        }),
      },
      pq_volcengine_ai_task: {
        id: 18316,
        source_id: taskId,
        line: 10,
        status: 3,
        extra: JSON.stringify({ newapi_log_id: 895 }),
      },
      pq_newapi_task_log: {
        id: 895,
        channel_id: 4,
        provider_code: 'databao',
        upstream_model_name: 'doubao-seedance-2.0',
        status: 'SUCCESS',
        newapi_group: 'default',
      },
      ...(withScoreLogs
        ? {
            pq_score_log: [
              {
                id: 20310,
                userid: 345,
                task_id: 18316,
                source_id: taskId,
                score: 120,
                type: 2,
                remark: '',
                createtime: '2026-09-24 15:39:11',
              },
            ],
          }
        : {}),
    },
  } as unknown as DatabaseRawCollection;
}

describe('计费 DB-key 必需性 (REAL 生产 fail-closed 锁)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('① LATENT 锁: REAL + operator scoreLogs 冒充计费 + DB 零佐证 → 必需 DB-key 双缺失, 绝不 PASS (删 :1166/:1168 即 RED)', async () => {
    const taskId = 820001;
    const pollSpy = mockPollSuccess(taskId);
    const res = await verify({
      taskId,
      modelId: 84,
      mediaType: 'video',
      baseUrl: BASE_URL,
      cookies: 'PHPSESSID=mock_billing_lock1',
      executionMode: 'real',
      expectedPoints: 70,
      scoreLogs: [{ task_id: taskId, type: 2, score: -70 }],
      terminalStatus: 'SUCCESS',
      artifactBuffer: validMp4,
      gatewayChannelConfirmed: true,
      dbExtraConfirmed: true,
      dbRawCollection: emptyDb(taskId),
    });
    pollSpy.mockRestore();
    const missing = res.canonicalVerdict!.requiredEvidenceEvaluation.missingEvidenceKeys;
    // operator scoreLogs 洗不出 DB-sourced 证据 —— 两条必需 DB-key 均缺失。
    expect(missing).toContain(DB_TASK_KEY);
    expect(missing).toContain(DB_SCORE_KEY);
    expect(res.canonicalVerdict!.verdict).not.toBe('PASS');
  });

  it('② 安全结局: operator 造不出 DB-sourced 证据 → 整体 BLOCKED/passed=false + DB_TASK_RECORD 缺失 blocker', async () => {
    const taskId = 820002;
    const pollSpy = mockPollSuccess(taskId);
    const res = await verify({
      taskId,
      modelId: 84,
      mediaType: 'video',
      baseUrl: BASE_URL,
      cookies: 'PHPSESSID=mock_billing_lock2',
      executionMode: 'real',
      expectedPoints: 70,
      scoreLogs: [{ task_id: taskId, type: 2, score: -70 }],
      terminalStatus: 'SUCCESS',
      artifactBuffer: validMp4,
      gatewayChannelConfirmed: true,
      dbExtraConfirmed: true,
      dbRawCollection: emptyDb(taskId),
    });
    pollSpy.mockRestore();
    expect(res.passed).toBe(false);
    expect(res.acceptance).toBe('BLOCKED');
    expect(res.canonicalVerdict!.requiredEvidenceEvaluation.matchedEnvelopes[DB_TASK_KEY]).toBeUndefined();
    expect(
      res.canonicalVerdict!.blockers.some((b) => b.code.includes('DB_TASK_RECORD') || b.evidenceKey === DB_TASK_KEY),
    ).toBe(true);
  });

  it('③ 精度不误伤真绿: REAL + 完整 VERIFIED DB(任务记录+积分流水) → 双 DB-key 均被满足(不进 missing)', async () => {
    const taskId = 820003;
    const pollSpy = mockPollSuccess(taskId);
    const res = await verify({
      taskId,
      modelId: 84,
      mediaType: 'video',
      baseUrl: BASE_URL,
      cookies: 'PHPSESSID=mock_billing_lock3',
      executionMode: 'real',
      duration: 4,
      resolution: '720p',
      terminalStatus: 'SUCCESS',
      artifactBuffer: validMp4,
      gatewayChannelConfirmed: true,
      dbExtraConfirmed: true,
      dbRawCollection: fullDb(taskId),
    });
    pollSpy.mockRestore();
    const missing = res.canonicalVerdict!.requiredEvidenceEvaluation.missingEvidenceKeys;
    // 真实物理落库如实产出 → 两条 DB-key 被满足, 不误伤真绿(不变量非空转)。
    expect(missing).not.toContain(DB_TASK_KEY);
    expect(missing).not.toContain(DB_SCORE_KEY);
  });

  it('④ 独立粒度: DB 有任务记录但无积分流水 → DB_TASK_RECORD 满足, DB_SCORE_LOGS 仍缺失(两键各自独立, operator scoreLogs 顶不上)', async () => {
    const taskId = 820004;
    const pollSpy = mockPollSuccess(taskId);
    const res = await verify({
      taskId,
      modelId: 84,
      mediaType: 'video',
      baseUrl: BASE_URL,
      cookies: 'PHPSESSID=mock_billing_lock4',
      executionMode: 'real',
      expectedPoints: 70,
      scoreLogs: [{ task_id: taskId, type: 2, score: -70 }], // operator 仍试图用自带流水冒充
      terminalStatus: 'SUCCESS',
      artifactBuffer: validMp4,
      gatewayChannelConfirmed: true,
      dbExtraConfirmed: true,
      dbRawCollection: fullDb(taskId, { withScoreLogs: false }),
    });
    pollSpy.mockRestore();
    const missing = res.canonicalVerdict!.requiredEvidenceEvaluation.missingEvidenceKeys;
    expect(missing).not.toContain(DB_TASK_KEY); // 任务记录真源存在 → 满足
    expect(missing).toContain(DB_SCORE_KEY); // 积分流水 DB 源缺失 → operator scoreLogs 顶不上 DB-ledger
  });
});
