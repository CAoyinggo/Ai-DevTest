/**
 * Bring-Your-Own-Runtime 采集器接缝 fail-closed 纪律测试
 *
 * 锁定 Browser Option A 的核心诚实约束：
 * 1. 本包不内置浏览器/视觉运行时；Null* 缺省采集器返回空原始事实。
 * 2. 空原始事实喂入 Producer 后【绝不产 PASS】，严格走 COLLECTION_FAILED / UNVERIFIED。
 * 3. 仅当【外部注入】的采集器回传真实事实时，Producer 才据实产出 PASS —— 证明接缝确实可用，
 *    且 PASS 完全由真实事实驱动，而非接缝本身臆造。
 * 4. 视觉采集器回传的推断只驱动 AI_OBSERVATION，恒不具备单独 PASS 裁决权。
 */
import { describe, expect, it } from 'vitest';
import {
  UIBrowserEvidenceProducer,
  UIVisualAiEvidenceProducer,
  NullBrowserFactCollector,
  NullVisualAiFactCollector,
  type BrowserFactCollector,
  type VisualAiFactCollector,
  type DeterministicProducerContext,
} from '../../../src/devtest/ui-adapters.js';

const DETERMINISTIC_CAPTURED_AT = '2026-09-21T10:00:00.000Z';
const DETERMINISTIC_EVIDENCE_IDS = {
  'BROWSER:TASK_STATUS_DOM': 'ev-dom-001',
  'BROWSER:NETWORK_RESPONSE': 'ev-net-001',
  'BROWSER:SCREENSHOT_REF': 'ev-screen-001',
  'AI_OBSERVATION:TASK_STATUS_VISUAL': 'ev-ai-001',
} as const;

function ctx(overrides?: Partial<DeterministicProducerContext>): DeterministicProducerContext {
  return {
    testId: 'test-seam-001',
    environment: 'offline',
    subjectType: 'task',
    subjectId: 100,
    capturedAt: DETERMINISTIC_CAPTURED_AT,
    evidenceIds: DETERMINISTIC_EVIDENCE_IDS,
    ...overrides,
  };
}

describe('BYO-Runtime 采集器接缝 · fail-closed 纪律', () => {
  it('1. Null 采集器如实自述"无外部运行时"，且回传空原始事实', async () => {
    const b = new NullBrowserFactCollector();
    const v = new NullVisualAiFactCollector();
    expect(b.runtimeName).toContain('no external runtime');
    expect(v.runtimeName).toContain('no external runtime');
    expect(await b.collect()).toEqual({});
    expect(await v.collect()).toEqual({});
  });

  it('2. 空浏览器事实喂入 Producer：全部 COLLECTION_FAILED，绝无一条 PASS', async () => {
    const raw = await new NullBrowserFactCollector().collect();
    const envelopes = await new UIBrowserEvidenceProducer().produce(raw, ctx());

    expect(envelopes.length).toBeGreaterThan(0);
    for (const env of envelopes) {
      expect(env.observationStatus).not.toBe('PASS');
      expect(env.collectionStatus).toBe('COLLECTION_FAILED');
    }
    // 缺失事实必须体现为明确的 *_FACT_MISSING / *_NOT_REQUESTED，而非静默成功
    const codes = envelopes.map((e) => e.error?.code);
    expect(codes).toContain('DOM_FACT_MISSING');
    expect(codes).toContain('NETWORK_FACT_MISSING');
  });

  it('3. 空视觉事实喂入 Producer：UNVERIFIED，绝不产 PASS', async () => {
    const raw = await new NullVisualAiFactCollector().collect();
    const envelopes = await new UIVisualAiEvidenceProducer().produce(raw, ctx());

    expect(envelopes.length).toBeGreaterThan(0);
    for (const env of envelopes) {
      expect(env.observationStatus).not.toBe('PASS');
    }
    const visual = envelopes.find((e) => e.evidenceKey === 'AI_OBSERVATION:TASK_STATUS_VISUAL');
    expect(visual?.collectionStatus).toBe('COLLECTION_FAILED');
    expect(visual?.error?.code).toBe('VISUAL_INFERENCE_MISSING');
  });

  it('4. 外部注入真实事实的采集器：Producer 据实产 PASS（证明接缝可用且 PASS 由真实事实驱动）', async () => {
    // 模拟"自有仓库封装的 Playwright 采集器"的最小实现——仅本测试作用域，绝非本包内置
    const externalCollector: BrowserFactCollector = {
      runtimeName: 'fake-playwright@test (external, test-only)',
      async collect() {
        return {
          domTaskStatus: 'SUCCESS',
          rowFound: true,
          networkTaskStatus: 'SUCCESS',
          networkHttpStatus: 200,
        };
      },
    };

    const raw = await externalCollector.collect({ pageUrl: 'https://example.test/history' });
    const envelopes = await new UIBrowserEvidenceProducer().produce(raw, ctx());

    const dom = envelopes.find((e) => e.evidenceKey === 'BROWSER:TASK_STATUS_DOM');
    const net = envelopes.find((e) => e.evidenceKey === 'BROWSER:NETWORK_RESPONSE');
    expect(dom?.observationStatus).toBe('PASS');
    expect(dom?.collectionStatus).toBe('SUCCESS');
    expect(net?.observationStatus).toBe('PASS');
    expect(net?.collectionStatus).toBe('SUCCESS');
  });

  it('5. 外部注入视觉采集器：CONFIRMED 也只落 AI_OBSERVATION 键，不越权到 BROWSER:* 裁决键', async () => {
    const externalVisual: VisualAiFactCollector = {
      runtimeName: 'fake-midscene@test (external, test-only)',
      async collect() {
        return { visualInference: 'CONFIRMED', instruction: '确认任务状态为成功' };
      },
    };

    const raw = await externalVisual.collect({ instruction: '确认任务状态为成功' });
    const envelopes = await new UIVisualAiEvidenceProducer().produce(raw, ctx());

    // 所有产出必须限定在 AI_OBSERVATION 命名空间，杜绝伪装成确定性浏览器裁决证据
    for (const env of envelopes) {
      expect(env.evidenceKey.startsWith('AI_OBSERVATION:')).toBe(true);
    }
  });
});
