import { describe, expect, it } from 'vitest';
import {
  applyDbAuthoritativeExpectedReprice,
  type VerifyContext,
  type VerifyKernelOptions,
  type TaskEvidenceResult,
} from '../../../src/devtest/verify-pipeline.js';
import { discoverModelContract } from '../../../src/devtest/env-probe.js';

/**
 * R8 fail-closed 重定价回归：operator 未声明 --model 时，图片模型被默认猜成 201，
 * 据此推导应扣积分 → 对真实非默认模型产生「假超扣/假少扣 (假 FP-005)」。
 * 本函数在 DB 物理取证后用真实落库模型回算刊例期望或 fail-closed，杜绝该假红。
 */
describe('applyDbAuthoritativeExpectedReprice - DB 权威重定价 (假 FP-005 修复)', () => {
  // 默认猜测态：operator 未给 --model → 图片默认落 201（刊例 1K=5），据此推导 expected=5
  function makeCtx(overrides: Partial<VerifyContext> = {}): VerifyContext {
    return {
      taskId: 4519,
      mediaType: 'image',
      modelId: 201,
      contract: discoverModelContract(201, 'image'),
      resolution: '1K',
      expectedPoints: 5,
      expectedChargeSource: 'DEVTEST_EXPECTATION',
      expectedPointsSource: 'DEVTEST_CALCULATED',
      systemCalculatedExpectedPoints: 5,
      session: null,
      executionMode: 'real',
      ...overrides,
    };
  }

  function makeTaskResult(
    extra: Record<string, unknown>,
    terminalStatus: TaskEvidenceResult['terminalStatus'] = 'SUCCESS',
    table = 'pq_aivideo_goods',
  ): TaskEvidenceResult {
    return {
      terminalStatus,
      routingFacts: { extraObj: extra },
      dbEvidence: {
        status: 'VERIFIED',
        recordsFound: { [table]: { id: 4519, extra: JSON.stringify(extra), selmodelsId: extra.selmodelsId } },
      },
    } as unknown as TaskEvidenceResult;
  }

  function makeOptions(overrides: Partial<VerifyKernelOptions> = {}): VerifyKernelOptions {
    return { taskId: 4519, mediaType: 'image', ...overrides };
  }

  it('(a) 真实模型命中目录: 4519 真实模型 57(1K=7) 覆盖默认猜测 201=5，消除假超扣', () => {
    const ctx = makeCtx();
    applyDbAuthoritativeExpectedReprice(ctx, makeOptions(), makeTaskResult({ selmodelsId: '57', resolution: '1K' }));
    expect(ctx.expectedPoints).toBe(7);
    expect(ctx.systemCalculatedExpectedPoints).toBe(7);
    expect(ctx.contract.pricing.allowPass).toBe(true); // 有刊例，不降级
    expect(ctx.expectedRepriceNote).toContain('DB_AUTHORITATIVE_REPRICE');
    expect(ctx.expectedRepriceNote).toContain('真实模型 57');
  });

  it('(a) selmodels 形如 "57-earth" 亦能取前导整数回算', () => {
    const ctx = makeCtx();
    applyDbAuthoritativeExpectedReprice(
      ctx,
      makeOptions(),
      // extraObj 无 selmodelsId，仅 selmodels='57-earth'
      makeTaskResult({ selmodels: '57-earth', resolution: '2K' }),
    );
    expect(ctx.expectedPoints).toBe(12); // 模型57 2K=12
  });

  it('(b) 真实模型未登记目录 + SUCCESS: fail-closed 置刊例未确定，不据猜测价喷超扣', () => {
    const ctx = makeCtx();
    applyDbAuthoritativeExpectedReprice(
      ctx,
      makeOptions(),
      makeTaskResult({ selmodelsId: '99999', resolution: '1K' }, 'SUCCESS'),
    );
    expect(ctx.contract.pricing.allowPass).toBe(false);
    expect(ctx.contract.pricing.isPricingDetermined).toBe(false);
    expect(ctx.contract.pricing.source).toBe('MANUAL_REQUIRED');
    expect(ctx.expectedRepriceNote).toContain('MODEL_PRICE_UNKNOWN');
  });

  it('(b-guard) 真实模型未登记目录 + FAILED: 不降级 (失败退款 net=0 核验与期望幅度无关)', () => {
    const ctx = makeCtx();
    const before = ctx.contract.pricing.allowPass;
    applyDbAuthoritativeExpectedReprice(
      ctx,
      makeOptions(),
      makeTaskResult({ selmodelsId: '99999', resolution: '1K' }, 'FAILED'),
    );
    expect(ctx.contract.pricing.allowPass).toBe(before); // 未动
    expect(ctx.expectedRepriceNote).toBeUndefined();
  });

  it('门禁: operator 显式 --model 时零改变 (显式路径字节级不变)', () => {
    const ctx = makeCtx();
    applyDbAuthoritativeExpectedReprice(
      ctx,
      makeOptions({ modelId: 201 }),
      makeTaskResult({ selmodelsId: '57', resolution: '1K' }),
    );
    expect(ctx.expectedPoints).toBe(5); // 未重定价
    expect(ctx.expectedRepriceNote).toBeUndefined();
  });

  it('门禁: operator 显式 --expected-points 时零改变', () => {
    const ctx = makeCtx();
    applyDbAuthoritativeExpectedReprice(
      ctx,
      makeOptions({ expectedPoints: 5 }),
      makeTaskResult({ selmodelsId: '57', resolution: '1K' }),
    );
    expect(ctx.expectedPoints).toBe(5);
    expect(ctx.expectedRepriceNote).toBeUndefined();
  });

  it('门禁: 真实模型恰等于默认猜测值(201) 时零改变', () => {
    const ctx = makeCtx();
    applyDbAuthoritativeExpectedReprice(ctx, makeOptions(), makeTaskResult({ selmodelsId: '201', resolution: '1K' }));
    expect(ctx.expectedRepriceNote).toBeUndefined();
  });

  it('门禁: 视频任务不参与图片重定价', () => {
    const ctx = makeCtx({ mediaType: 'video', modelId: 84, expectedPoints: 28 });
    applyDbAuthoritativeExpectedReprice(
      ctx,
      makeOptions({ mediaType: 'video' }),
      makeTaskResult({ selmodelsId: '57', resolution: '1K' }),
    );
    expect(ctx.expectedPoints).toBe(28);
    expect(ctx.expectedRepriceNote).toBeUndefined();
  });

  it('门禁: 无 DB 记录时零改变 (不臆测)', () => {
    const ctx = makeCtx();
    applyDbAuthoritativeExpectedReprice(ctx, makeOptions(), {
      terminalStatus: 'SUCCESS',
      routingFacts: {},
      dbEvidence: { status: 'UNVERIFIED', recordsFound: {} },
    } as unknown as TaskEvidenceResult);
    expect(ctx.expectedPoints).toBe(5);
    expect(ctx.expectedRepriceNote).toBeUndefined();
  });
});
