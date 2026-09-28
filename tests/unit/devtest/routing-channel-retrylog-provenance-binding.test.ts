import { describe, it, expect } from 'vitest';
import {
  buildCanonicalEvidenceFromVerifyFacts,
  type CanonicalVerifyFacts,
} from '../../../src/devtest/legacy-protocol-mappers.js';
import { evaluateRequiredEvidence, type CanonicalTestSpec } from '../../../src/devtest/canonical-protocol.js';

/**
 * 路由渠道 retry_log 归属绑定 fail-closed 锁 (routing-channel-retrylog-provenance-binding)
 * ------------------------------------------------------------------------------------
 * 背景 (LATENT/纵深防御, 可达 MCP 缝):
 *   mcp-service.ts:865 已把 operator 入参 `retry_log` 透传为 options.retryLog。
 *   evidence-collectors.ts:714-715: 无 runtimeDetails 实测、仅 options.retryLog.newapi_channel_id 存在时,
 *   channelProvenance 落 'SERVER_RETRYLOG_FIXTURE'(含子串 'FIXTURE'); 同一 retryLog 又喂入 serverActualChannelId,
 *   故 channelMatched 可为 true(actualChannelId===targetChannelId)。
 *   legacy-protocol-mappers.ts:1432 渠道信封分支因 provenance 含 'retrylog' 被进入, observationStatus 可判 PASS;
 *   而 :1455 `isRealChannel = executionMode==='real' && !channelProv.includes('FIXTURE')` 是**唯一**把它钉成
 *   FIXTURE(而非 SERVER_API)的闸 —— 安全性完全系于 'SERVER_RETRYLOG_FIXTURE' 恰好含 'FIXTURE' 这一字符串巧合。
 *   一旦有人"清理"常量名(如改成 'SERVER_RETRYLOG')或改写该行, REAL 模式下 operator 的 retry_log
 *   就会被冒充成 SERVER_API:ROUTING_CHANNEL 真绿 → 假 PASS。
 *
 * 本锁钉死生产者侧不变量(与 canonical-protocol 信封防伪校验互补, 见 canonical-protocol.test.ts 17):
 *   REAL + operator retry_log 形态的渠道来源, 即便 channelMatched=true/observationStatus=PASS,
 *   也只能产 FIXTURE:ROUTING_CHANNEL(sourceType='FIXTURE'), 绝不生成 SERVER_API:ROUTING_CHANNEL,
 *   因而无法满足 REAL 规范必需的 SERVER_API:ROUTING_CHANNEL(fail-closed → missing)。
 *   反向精度: 真实实测来源 'HTTP_API:retrylog' 仍如实产 SERVER_API:ROUTING_CHANNEL PASS 并满足必需证据(不误伤真绿)。
 *
 * teeth(RED-on-weakening): 把 legacy-protocol-mappers.ts:1455 的 `!channelProv.includes('FIXTURE')`
 *   改成 `true`(模拟常量改名/去 FIXTURE 化), 用例①②③必 RED; 用例④(真绿)恒 GREEN。
 */

const FIXED_TIME = '2026-09-21T10:00:00.000Z';

const REAL_SPEC_CHANNEL = {
  testId: 'v-channel-provenance',
  executionMode: 'REAL',
  requiredEvidence: ['SERVER_API:ROUTING_CHANNEL'],
} as unknown as CanonicalTestSpec;

// REAL 事实底座: 渠道确实匹配(channelMatched=true, actual===target===2), 仅 provenance 来源不同。
function realChannelFacts(taskId: number, channelProvenance: string): CanonicalVerifyFacts {
  return {
    testId: 'v-channel-provenance',
    capturedAt: FIXED_TIME,
    executionMode: 'real',
    taskId,
    channelDetail: {
      status: 'PASS',
      channelMatched: true,
      fallbackAvoided: true,
      targetChannelId: 2,
      actualChannelId: 2,
    },
    provenance: { actualChannelId: channelProvenance },
    isActualChannelAssertedOnly: false,
  };
}
describe('路由渠道 retry_log 归属绑定 (fail-closed 锁)', () => {
  it('① LATENT 锁: REAL + operator retry_log 形态来源(SERVER_RETRYLOG_FIXTURE) + channelMatched=true → 只产 FIXTURE:ROUTING_CHANNEL, 绝不生成 SERVER_API:ROUTING_CHANNEL (改闸即 RED)', () => {
    const res = buildCanonicalEvidenceFromVerifyFacts(realChannelFacts(810001, 'SERVER_RETRYLOG_FIXTURE'));
    expect(res.success).toBe(true);
    // 绝不生成服务端渠道信封 —— operator retry_log 不可洗成 SERVER_API 真绿。
    expect(res.value!.some((e) => e.evidenceKey === 'SERVER_API:ROUTING_CHANNEL')).toBe(false);
    // 只应产出 FIXTURE:ROUTING_CHANNEL, sourceType 钉死 FIXTURE。
    const ch = res.value!.find((e) => e.evidenceKey === 'FIXTURE:ROUTING_CHANNEL');
    expect(ch).toBeDefined();
    expect(ch?.sourceType).toBe('FIXTURE');
  });

  it('② 第二道独立防线: operator retry_log 产出的 FIXTURE:ROUTING_CHANNEL 无法满足 REAL 规范要求的 SERVER_API:ROUTING_CHANNEL (fail-closed → missing)', () => {
    const res = buildCanonicalEvidenceFromVerifyFacts(realChannelFacts(810002, 'SERVER_RETRYLOG_FIXTURE'));
    const evalRes = evaluateRequiredEvidence(REAL_SPEC_CHANNEL, res.value!);
    expect(evalRes.missingEvidenceKeys).toContain('SERVER_API:ROUTING_CHANNEL');
    expect(evalRes.matchedEnvelopes['SERVER_API:ROUTING_CHANNEL']).toBeUndefined();
    expect(evalRes.satisfied).toBe(false);
  });

  it('③ 边界精度: FIXTURE 信封即便 observationStatus=PASS(渠道确匹配) 也因来源隔离无法满足 REAL 必需证据 —— 保护来自"来源隔离"而非"状态降级"', () => {
    const res = buildCanonicalEvidenceFromVerifyFacts(realChannelFacts(810003, 'SERVER_RETRYLOG_FIXTURE'));
    const ch = res.value!.find((e) => e.evidenceKey === 'FIXTURE:ROUTING_CHANNEL');
    // 关键: PASS 与 FIXTURE 共存 —— 状态是真 PASS, 但来源被钉成 FIXTURE, 故顶不进 SERVER_API 必需槽。
    expect(ch?.observationStatus).toBe('PASS');
    expect(ch?.sourceType).toBe('FIXTURE');
  });

  it('④ 反向精度不误伤真绿: REAL + 真实实测来源(HTTP_API:retrylog) + channelMatched=true → 如实产 SERVER_API:ROUTING_CHANNEL PASS 并满足必需证据', () => {
    const res = buildCanonicalEvidenceFromVerifyFacts(realChannelFacts(810004, 'HTTP_API:retrylog'));
    const ch = res.value!.find((e) => e.evidenceKey === 'SERVER_API:ROUTING_CHANNEL');
    expect(ch).toBeDefined();
    expect(ch?.sourceType).toBe('SERVER_API');
    expect(ch?.observationStatus).toBe('PASS');
    const evalRes = evaluateRequiredEvidence(REAL_SPEC_CHANNEL, res.value!);
    expect(evalRes.missingEvidenceKeys).not.toContain('SERVER_API:ROUTING_CHANNEL');
    expect(evalRes.satisfied).toBe(true);
  });
});
