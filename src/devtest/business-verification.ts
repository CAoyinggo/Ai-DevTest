/**
 * Panqu AI DevTest 业务级验真评估器 (Business-level Verification Evaluator)
 *
 * 由 domain-knowledge.ts 物理拆分而来（纯结构分解，零逻辑改动）。
 * evaluateBusinessVerification 为 verify 活体裁决链关键函数（core-kernel → buildDiffItems），
 * 其 Technical Success ≠ Business Success 判定语义严格保持不变。
 */

import { type KnowledgeCredibility } from './domain-knowledge-base.js';
import { PANQU_FAILURE_PATTERNS } from './domain-experience.js';

// ============================================================================
// 9. 业务级验真评估器 (Business-level Verification Evaluator)
// ============================================================================

export interface BusinessVerificationInput {
  taskId: number;
  modelId: number;
  mediaType: 'video' | 'image';
  apiResult?: { ok: boolean; code?: number; message?: string };
  taskTerminalStatus: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'UNKNOWN';
  mediaEvidence: {
    status: 'PASS' | 'FAIL' | 'UNVERIFIED';
    format?: string;
    decodable?: boolean;
    ownership: 'VERIFIED' | 'UNVERIFIED';
    reason?: string;
  };
  billingEvidence: {
    status: 'PASS' | 'FAIL' | 'UNVERIFIED';
    netDeductedPoints?: number;
    expectedPoints?: number;
    reason?: string;
  };
  invariantsEvidence: {
    status: 'PASS' | 'FAIL' | 'UNVERIFIED';
    antiDoubleBilling?: boolean;
    netChargeZero?: boolean;
    refundIdempotency?: boolean;
    reason?: string;
  };
  paramRelations?: {
    projectId?: number;
    folderId?: number;
    isFolderInProject?: boolean;
  };
  channelAssertion?: {
    targetChannelId?: number;
    targetChannelName?: string;
    actualChannelId?: number;
    actualChannelName?: string;
    fallbackChannel?: string;
    retryProvider?: string;
    hasEvidenceConflict?: boolean;
    conflictReasons?: string[];
    isActualChannelAssertedOnly?: boolean;
  };
}

export interface BusinessVerificationResult {
  status: 'PASS' | 'FAIL' | 'UNVERIFIED';
  technicalSuccess: boolean;
  businessSuccess: boolean;
  verdictDetail: {
    apiVerified: boolean;
    taskStateVerified: boolean;
    artifactBound: boolean;
    oracleConsistent: boolean;
    relationsValid: boolean;
    relationsProven?: boolean;
    channelMatched?: boolean;
    fallbackAvoided?: boolean;
  };
  channelDetail?: {
    channelMatched?: boolean;
    fallbackAvoided?: boolean;
    targetChannelId?: number;
    targetChannelName?: string;
    actualChannelId?: number;
    actualChannelName?: string;
    fallbackChannel?: string;
    retryProvider?: string;
    status: 'PASS' | 'FAIL' | 'UNVERIFIED';
    reason?: string;
  };
  matchedFailurePatterns: string[];
  reasons: string[];
  credibility: KnowledgeCredibility;
}

/**
 * 业务级验真核心函数：
 * 明确区分 Technical Success (API 200/入队/容器合法) 与 Business Success (真正业务成功/渠道履约)
 */
export function evaluateBusinessVerification(input: BusinessVerificationInput): BusinessVerificationResult {
  const reasons: string[] = [];
  const matchedPatterns: string[] = [];

  const apiOk = input.apiResult
    ? input.apiResult.ok && (input.apiResult.code === 1 || input.apiResult.code === 200)
    : true;
  const taskSuccess = input.taskTerminalStatus === 'SUCCESS';
  const taskFailed = input.taskTerminalStatus === 'FAILED';
  const _taskUnknown = input.taskTerminalStatus === 'UNKNOWN' || input.taskTerminalStatus === 'TIMEOUT';

  // 1. 问题 1 识别：API 返回成功，但 Task 实际失败 (Technical Success ≠ Business Success)
  if (apiOk && taskFailed) {
    matchedPatterns.push(PANQU_FAILURE_PATTERNS.PATTERN_API_SUCCESS_TASK_FAILED.id);
    reasons.push(
      `[业务失败 FP-001] API 提交返回成功，但异步 Task #${input.taskId} 终态为 FAILED (Technical Success ≠ Business Success)`,
    );
  }

  // 2. 问题 2 识别：Task 标记成功，但业务产物不存在或损坏
  if (taskSuccess) {
    if (input.mediaEvidence.status === 'FAIL') {
      matchedPatterns.push(PANQU_FAILURE_PATTERNS.PATTERN_TASK_SUCCESS_NO_ASSET.id);
      reasons.push(
        `[业务失败 FP-002] Task #${input.taskId} 状态标记为成功，但业务媒体产物损坏无法解码: ${input.mediaEvidence.reason || '文件损坏'}`,
      );
    } else if (input.mediaEvidence.status === 'UNVERIFIED') {
      reasons.push(`[产物未验真] Task #${input.taskId} 产物缺少有效物理证据或未证明归属绑定 [UNVERIFIED]`);
    }
  }

  // 3. 问题 3 识别：参数隐式业务关系违背 (跨项目/文件夹)
  //    三态 fail-closed：显式 isFolderInProject===false → 硬失败(FP-003 跨项目越权)；
  //    ===true → 归属已证；===undefined/null（指定了 folderId 却无归属证据）→ 未证明(relationsProven=false)，
  //    绝不静默判 PASS（缺失归属确认等同"无法证明未越权"→ UNVERIFIED），但也不冒充硬失败。
  let relationsValid = true;
  let relationsProven = true;
  if (input.paramRelations) {
    if (input.paramRelations.folderId !== undefined) {
      if (input.paramRelations.isFolderInProject === false) {
        relationsValid = false;
        matchedPatterns.push(PANQU_FAILURE_PATTERNS.PATTERN_PROJECT_OWNERSHIP_MISMATCH.id);
        reasons.push(
          `[业务关系违背 FP-003] folderId (${input.paramRelations.folderId}) 不属于当前 projectId (${input.paramRelations.projectId})`,
        );
      } else if (input.paramRelations.isFolderInProject !== true) {
        relationsProven = false;
        reasons.push(
          `[业务关系未验真] 指定了 folderId (${input.paramRelations.folderId}) 但缺少其归属 projectId (${input.paramRelations.projectId ?? '未提供'}) 的确认证据，无法证明未发生跨项目越权 [UNVERIFIED]`,
        );
      }
    }
  }

  // 4. 账务资损核验
  if (input.billingEvidence.status === 'FAIL') {
    reasons.push(`[账务对账失败] ${input.billingEvidence.reason || '计费扣除与刊例不符'}`);
  }
  if (input.invariantsEvidence.antiDoubleBilling === false) {
    matchedPatterns.push(PANQU_FAILURE_PATTERNS.PATTERN_DOUBLE_BILLING.id);
    reasons.push('[资损告警 FP-004] 存在重复预扣流水，违背防重复扣费不变量');
  }
  if (input.invariantsEvidence.netChargeZero === false) {
    matchedPatterns.push(PANQU_FAILURE_PATTERNS.PATTERN_FAILED_NO_REFUND.id);
    reasons.push('[资损告警 FP-005] 失败任务净扣不为 0 或少/超额退款，违背失败净扣归零不变量');
  }

  // 5. 渠道履约与兜底冒充核验 (目标渠道约束)
  let channelMatched: boolean | undefined;
  let fallbackAvoided: boolean | undefined;
  let channelDetail: BusinessVerificationResult['channelDetail'];

  if (input.channelAssertion?.targetChannelId !== undefined) {
    const targetId = input.channelAssertion.targetChannelId;
    const targetName = input.channelAssertion.targetChannelName || `channel-${targetId}`;
    const actualId = input.channelAssertion.actualChannelId;
    const actualName = input.channelAssertion.actualChannelName || (actualId ? `channel-${actualId}` : 'unknown');
    const fallback = input.channelAssertion.fallbackChannel || input.channelAssertion.retryProvider;
    const isFallback = Boolean(fallback && fallback !== 'none');

    if (input.channelAssertion.hasEvidenceConflict) {
      matchedPatterns.push(PANQU_FAILURE_PATTERNS.PATTERN_EVIDENCE_CONFLICT.id);
      reasons.push(
        `[证据冲突 FP-008] 调用者入参与服务端只读事实存在严重冲突: ${(input.channelAssertion.conflictReasons || []).join('; ')}`,
      );
    }

    if (input.channelAssertion.isActualChannelAssertedOnly) {
      reasons.push(
        `[渠道证据存疑] 实际执行渠道 #${actualId} 仅来自调用者入参断言，无服务端运行时只读证据证实 [PROVISIONAL_EVIDENCE]`,
      );
    }

    if (input.channelAssertion.hasEvidenceConflict) {
      channelMatched = false;
      fallbackAvoided = false;
    } else if (input.channelAssertion.isActualChannelAssertedOnly) {
      // 仅来自调用者入参断言，不可判定为确认匹配
      channelMatched = undefined;
      fallbackAvoided = isFallback ? false : undefined;
    } else if (actualId !== undefined) {
      if (actualId === targetId) {
        channelMatched = true;
      } else {
        channelMatched = false;
        matchedPatterns.push(PANQU_FAILURE_PATTERNS.PATTERN_GATEWAY_CHANNEL_MISMATCH.id);
        reasons.push(
          `[渠道履约失败 FP-006] 目标渠道 #${targetId} ('${targetName}') 与服务端实际路由渠道 #${actualId} ('${actualName}') 不匹配 [CHANNEL_MISMATCH]`,
        );
      }
    } else {
      reasons.push(
        `[渠道未验真] 缺少服务端实际执行渠道证据，无法证明任务由目标渠道 #${targetId} ('${targetName}') 履约 [UNVERIFIED]`,
      );
    }

    if (!input.channelAssertion.hasEvidenceConflict) {
      if (isFallback) {
        fallbackAvoided = false;
        matchedPatterns.push(PANQU_FAILURE_PATTERNS.PATTERN_FALLBACK_ARTIFACT_NOT_ACCEPTED.id);
        reasons.push(
          `[渠道履约失败 FP-007] 目标渠道未产出成片，成片由兜底通道 (${fallback}) 生成，不得误判为目标渠道合格 [FALLBACK_ARTIFACT_NOT_ACCEPTED]`,
        );
      } else if (!input.channelAssertion.isActualChannelAssertedOnly) {
        fallbackAvoided = true;
      }
    }

    const channelStatus: 'PASS' | 'FAIL' | 'UNVERIFIED' =
      input.channelAssertion.hasEvidenceConflict || channelMatched === false || fallbackAvoided === false
        ? 'FAIL'
        : channelMatched === true && fallbackAvoided === true
          ? 'PASS'
          : 'UNVERIFIED';

    channelDetail = {
      channelMatched,
      fallbackAvoided,
      targetChannelId: targetId,
      targetChannelName: targetName,
      actualChannelId: actualId,
      actualChannelName: actualName,
      fallbackChannel: input.channelAssertion.fallbackChannel,
      retryProvider: input.channelAssertion.retryProvider,
      status: channelStatus,
      reason:
        channelStatus === 'FAIL'
          ? input.channelAssertion.hasEvidenceConflict
            ? '证据冲突 (EVIDENCE_CONFLICT)'
            : channelMatched === false
              ? `渠道不匹配 (#${targetId} vs #${actualId})`
              : `兜底产物 (${fallback})`
          : channelStatus === 'UNVERIFIED'
            ? input.channelAssertion.isActualChannelAssertedOnly
              ? '渠道仅来自人工断言'
              : '缺少执行渠道数据'
            : '渠道一致且无兜底',
    };
  }

  // 综合评定
  const technicalSuccess = apiOk && (taskSuccess || taskFailed);
  const artifactBound = input.mediaEvidence.status === 'PASS' && input.mediaEvidence.ownership === 'VERIFIED';
  const oracleConsistent = input.billingEvidence.status === 'PASS' && input.invariantsEvidence.status === 'PASS';
  const taskStateVerified = taskSuccess;

  const hasAnyFail =
    !apiOk ||
    taskFailed ||
    input.mediaEvidence.status === 'FAIL' ||
    input.billingEvidence.status === 'FAIL' ||
    input.invariantsEvidence.status === 'FAIL' ||
    !relationsValid ||
    channelMatched === false ||
    fallbackAvoided === false ||
    matchedPatterns.length > 0;

  const allBusinessPassed =
    apiOk &&
    taskSuccess &&
    artifactBound &&
    oracleConsistent &&
    relationsValid &&
    relationsProven &&
    (channelMatched === undefined || channelMatched === true) &&
    (fallbackAvoided === undefined || fallbackAvoided === true) &&
    matchedPatterns.length === 0;

  let status: 'PASS' | 'FAIL' | 'UNVERIFIED';
  let businessSuccess = false;

  if (hasAnyFail) {
    status = 'FAIL';
    businessSuccess = false;
  } else if (allBusinessPassed) {
    status = 'PASS';
    businessSuccess = true;
  } else {
    status = 'UNVERIFIED';
    businessSuccess = false;
  }

  return {
    status,
    technicalSuccess,
    businessSuccess,
    verdictDetail: {
      apiVerified: apiOk,
      taskStateVerified,
      artifactBound,
      oracleConsistent,
      relationsValid,
      ...(relationsProven === false ? { relationsProven } : {}),
      ...(channelMatched !== undefined ? { channelMatched } : {}),
      ...(fallbackAvoided !== undefined ? { fallbackAvoided } : {}),
    },
    channelDetail,
    matchedFailurePatterns: matchedPatterns,
    reasons,
    credibility: input.channelAssertion?.hasEvidenceConflict
      ? 'SUSPICIOUS'
      : input.channelAssertion?.isActualChannelAssertedOnly
        ? 'PROVISIONAL'
        : status === 'PASS' || status === 'FAIL'
          ? 'CONFIRMED'
          : 'UNKNOWN',
  };
}
