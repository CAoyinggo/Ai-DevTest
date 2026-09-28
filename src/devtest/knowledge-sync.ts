/**
 * Panqu AI DevTest 知识候选记录 / 晋升 / 远端同步 (Knowledge Sync & Promotion)
 *
 * 由 domain-knowledge.ts 物理拆分而来（纯结构分解，零逻辑改动）。
 * 承载：Memory Candidate 结构化、shared-memory 缓冲池记录、最小晋升机制与远端 JSON 合并。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  type MemoryCandidatePayload,
  DEFAULT_GITHUB_KNOWLEDGE_CONFIG,
  type KnowledgeSyncPayload,
  type BuildSyncPayloadOptions,
  type BuildSyncPayloadResult,
  type MergeKnowledgeResult,
} from './types.js';
import { type Experience, PANQU_FAILURE_PATTERNS, resolveDefaultPlanCheck } from './domain-experience.js';

/**
 * 结构化格式化 Memory Candidate 提案 (Record 阶段)
 * 仅用于产生数据结构，保持 verify 只读无任何写磁盘副作用
 */
export function formatMemoryCandidate(input: {
  taskId: number;
  modelId: number;
  mediaType: 'video' | 'image';
  matchedFailurePatterns: string[];
  reasons: string[];
  terminalStatus?: string;
}): MemoryCandidatePayload | undefined {
  if (input.matchedFailurePatterns.length === 0 && input.reasons.length === 0) {
    return undefined;
  }
  // 严重级优先级排序：资损 (FP-004, FP-005) > 产物损坏 (FP-002) > 关系违背 (FP-003) > 状态不一致 (FP-001)
  const priorityOrder = ['FP-004', 'FP-005', 'FP-002', 'FP-003', 'FP-001'];
  const patternId =
    priorityOrder.find((p) => input.matchedFailurePatterns.includes(p)) ||
    input.matchedFailurePatterns[0] ||
    'FP-UNKNOWN';
  const patternObj = Object.values(PANQU_FAILURE_PATTERNS).find((p) => p.id === patternId);
  const patternName = patternObj ? patternObj.name : patternId;

  return {
    agent: 'trae',
    topic: `[${patternId}] 业务风险模式: ${patternName} (模型 #${input.modelId})`,
    content: `Task #${input.taskId} 终态 ${input.terminalStatus || 'FAILED'}: ${input.reasons.join('; ')}`,
    dest: 'L2-state/active-projects.md',
    patternId,
    modelId: input.modelId,
    taskId: input.taskId,
    confidence: 'CONFIRMED',
    reasons: input.reasons,
  };
}

/**
 * 外层记录 Candidate 到 shared-memory 缓冲池 (含严格内容去重防污染)
 * 仅由外层 MCP/CLI 在 verify 之后按需调用，verify 内核保持 100% 只读。
 */
export function recordCandidateToSharedMemory(
  candidate: MemoryCandidatePayload,
  sharedMemoryDir: string = '/Users/mac/agents/shared-memory',
): { recorded: boolean; reason: string; candidateId?: string } {
  try {
    const inboxPath = path.resolve(sharedMemoryDir, 'candidates', 'inbox.md');
    if (!fs.existsSync(inboxPath)) {
      return { recorded: false, reason: 'SHARED_MEMORY_INBOX_NOT_FOUND' };
    }

    const currentContent = fs.readFileSync(inboxPath, 'utf8');

    // 内容去重 (Deduplication): 检查是否已包含相同模式与模型
    if (
      currentContent.includes(candidate.topic) ||
      (candidate.patternId &&
        candidate.modelId &&
        currentContent.includes(`[${candidate.patternId}]`) &&
        currentContent.includes(`模型 #${candidate.modelId}`))
    ) {
      return { recorded: false, reason: 'DUPLICATE_CANDIDATE_SKIPPED' };
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 5).replace(/:/g, '');
    const candId = `CAND-${dateStr}-${timeStr}`;
    const formattedDate = now.toISOString().slice(0, 10);

    const sourceSuffix = candidate.repository ? ` (repo: ${candidate.repository})` : '';
    const entry = `
- [ ] **[${candId}]** 来源: \`${candidate.agent}\`${sourceSuffix} | 提交日期: ${formattedDate}
  - **主题**: ${candidate.topic}
  - **提议内容**: ${candidate.content}
  - **建议归宿**: ${candidate.dest || 'L2-state/active-projects.md'}
`;

    fs.appendFileSync(inboxPath, entry, 'utf8');
    return { recorded: true, reason: 'CANDIDATE_RECORDED', candidateId: candId };
  } catch (err) {
    return { recorded: false, reason: `WRITE_ERROR: ${(err as Error).message}` };
  }
}

export interface PromoteOptions {
  projectRoot?: string;
  sharedMemoryDir?: string;
  inboxPath?: string;
  candidatesJsonPath?: string;
  dryRun?: boolean;
}

export interface PromotionReportItem {
  candidateId: string;
  status: 'PROMOTED' | 'ALREADY_PROMOTED' | 'DUPLICATE_CONTENT_SKIPPED' | 'INVALID_CANDIDATE_SKIPPED';
  knowledgeId?: string;
  knowledge?: Experience;
  reason: string;
}

export interface PromotionReport {
  totalScanned: number;
  confirmedCount: number;
  promotedCount: number;
  alreadyPromotedCount: number;
  skippedCount: number;
  items: PromotionReportItem[];
  syncRequired?: boolean;
  syncPayload?: KnowledgeSyncPayload;
}

/**
 * 构造确定性 Knowledge Sync Payload (仅接受已通过 Promotion 的合法知识)
 * 纯函数，不进行任何网络请求，不修改 GitHub，不直接调用 GitHub API。
 */
export function buildKnowledgeSyncPayload(options: BuildSyncPayloadOptions): BuildSyncPayloadResult {
  const repository = options.repository || DEFAULT_GITHUB_KNOWLEDGE_CONFIG.repository;
  const path = options.path || DEFAULT_GITHUB_KNOWLEDGE_CONFIG.path;
  const knowledgeList = Array.isArray(options.knowledge) ? options.knowledge : [];

  const validKnowledge: Experience[] = [];
  const rejectedItems: Array<{ id: string; reason: string }> = [];

  for (const item of knowledgeList) {
    if (!item || typeof item !== 'object') {
      rejectedItems.push({ id: 'UNKNOWN', reason: 'ITEM_NOT_AN_OBJECT' });
      continue;
    }

    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) {
      rejectedItems.push({ id: 'EMPTY_ID', reason: 'KNOWLEDGE_ID_MISSING' });
      continue;
    }

    // 门禁 1: 必须为已晋升或已确认状态 (ACCEPTED 或 CONFIRMED)
    if (item.status !== 'ACCEPTED' && item.status !== 'CONFIRMED') {
      rejectedItems.push({ id, reason: `INVALID_STATUS_${item.status || 'UNSPECIFIED'}` });
      continue;
    }

    // 门禁 2: 可信度必须为 CONFIRMED
    if (item.confidence !== 'CONFIRMED') {
      rejectedItems.push({ id, reason: `CONFIDENCE_NOT_CONFIRMED_${item.confidence || 'UNSPECIFIED'}` });
      continue;
    }

    // 门禁 3: 必须包含溯源 sourceCandidateId (证明经过了 Candidate 缓冲池审批)
    if (!item.sourceCandidateId || typeof item.sourceCandidateId !== 'string') {
      rejectedItems.push({ id, reason: 'MISSING_SOURCE_CANDIDATE_ID' });
      continue;
    }

    // 门禁 4: 必须包含 promotedAt 晋升时间戳
    if (!item.promotedAt || typeof item.promotedAt !== 'string') {
      rejectedItems.push({ id, reason: 'MISSING_PROMOTED_AT_TIMESTAMP' });
      continue;
    }

    // 门禁 5: 必须具有有效的 title 或 symptom
    if (!item.title && !item.symptom) {
      rejectedItems.push({ id, reason: 'MISSING_TITLE_OR_CLAIM' });
      continue;
    }

    // 注意：不要求 requiredPlanCheck 必须存在 (架构、API、Oracle 等事实皆为有效知识)
    validKnowledge.push(item);
  }

  if (validKnowledge.length === 0) {
    return {
      ok: true,
      syncRequired: false,
      rejectedItems: rejectedItems.length > 0 ? rejectedItems : undefined,
    };
  }

  return {
    ok: true,
    syncRequired: true,
    payload: {
      repository,
      path,
      knowledge: validKnowledge,
    },
    rejectedItems: rejectedItems.length > 0 ? rejectedItems : undefined,
  };
}

/**
 * 将经过校验的 Knowledge 合并至远端 JSON 数组 (含严格以 knowledge.id 为主键的幂等与冲突检测)
 * 纯函数，杜绝让 Trae / LLM 自由编辑 JSON 文本造成语法损坏。
 */
export function mergeKnowledgeIntoRemoteJson(
  remoteJsonContent: string,
  incomingKnowledge: Experience[],
): MergeKnowledgeResult {
  if (!incomingKnowledge || incomingKnowledge.length === 0) {
    return {
      ok: true,
      mergedContent: remoteJsonContent,
      mergedCount: 0,
      skippedCount: 0,
    };
  }

  let remoteArray: Array<Record<string, unknown>> = [];
  try {
    const trimmed = remoteJsonContent ? remoteJsonContent.trim() : '';
    if (!trimmed) {
      remoteArray = [];
    } else {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          error: 'REMOTE_CONTENT_NOT_JSON_ARRAY',
          mergedCount: 0,
          skippedCount: 0,
        };
      }
      remoteArray = parsed;
    }
  } catch (err) {
    return {
      ok: false,
      error: `REMOTE_JSON_PARSE_ERROR: ${(err as Error).message}`,
      mergedCount: 0,
      skippedCount: 0,
    };
  }

  let mergedCount = 0;
  let skippedCount = 0;
  const conflictItems: Array<{ id: string; reason: string; existingClaim?: string; incomingClaim?: string }> = [];

  for (const inc of incomingKnowledge) {
    const existingIndex = remoteArray.findIndex((item) => item && item.id === inc.id);

    if (existingIndex >= 0) {
      const existing = remoteArray[existingIndex] as {
        claim?: string;
        title?: string;
        sourceCandidateId?: string;
      };
      // 检查内容是否一致 (比对 claim / title 与 sourceCandidateId)
      const existingClaim = (existing.claim || existing.title || '').trim();
      const incomingClaim = (inc.title || inc.symptom || '').trim();
      const existingSource = existing.sourceCandidateId;
      const incomingSource = inc.sourceCandidateId;

      const isSameContent =
        existingClaim === incomingClaim && (!existingSource || !incomingSource || existingSource === incomingSource);

      if (isSameContent) {
        // 幂等：内容一致，安全跳过重复追加
        skippedCount++;
        continue;
      } else {
        // 冲突：相同 ID 但内容不一致，绝不静默覆盖
        conflictItems.push({
          id: inc.id,
          reason: 'ID_EXISTS_WITH_DIFFERENT_CONTENT',
          existingClaim,
          incomingClaim,
        });
        continue;
      }
    }

    // 远端不存在相同 ID，格式化为符合 references/knowledge_candidates.json 的标准条目并追加
    let domain: 'Task' | 'Billing' | 'Media' | 'Routing' = 'Task';
    const patternId = inc.related_pattern_id;
    if (patternId === 'FP-004' || patternId === 'FP-005') domain = 'Billing';
    else if (patternId === 'FP-002') domain = 'Media';
    else if (patternId === 'FP-001' || patternId === 'FP-003') domain = 'Task';

    const newRemoteEntry: Record<string, unknown> = {
      id: inc.id,
      claim: inc.title || inc.symptom,
      evidence: [
        {
          source: 'shared-memory/candidates/inbox.md',
          location: inc.sourceCandidateId,
          reason: inc.root_cause || inc.context,
        },
      ],
      confidence: inc.confidence,
      domain,
      status: inc.status || 'ACCEPTED',
      derived_from: [`shared-memory/candidates/inbox.md: ${inc.sourceCandidateId}`, `agent: trae`],
      notes: inc.context,
      sourceCandidateId: inc.sourceCandidateId,
      promotedAt: inc.promotedAt,
      related_pattern_id: inc.related_pattern_id,
      related_model_id: inc.related_model_id,
    };

    if (inc.requiredPlanCheck) {
      newRemoteEntry.requiredPlanCheck = inc.requiredPlanCheck;
    }

    remoteArray.push(newRemoteEntry);
    mergedCount++;
  }

  if (conflictItems.length > 0) {
    return {
      ok: false,
      error: 'SYNC_CONFLICT',
      conflictItems,
      mergedCount,
      skippedCount,
    };
  }

  return {
    ok: true,
    mergedContent: JSON.stringify(remoteArray, null, 2) + '\n',
    mergedCount,
    skippedCount,
  };
}

/**
 * 最小候选晋升机制 (Promotion Pipeline: Confirmed Experience -> Persistent Knowledge)
 * 仅由离线流程、CLI 或 MCP 显式调用。严格只读 inbox.md，仅对经人工审核 (- [x]) 的条目
 * 执行幂等校验与去重后写入 knowledge_candidates.json。
 */
export function promoteConfirmedExperiences(options: PromoteOptions = {}): PromotionReport {
  const root = options.projectRoot || process.cwd();
  const smDir = options.sharedMemoryDir || '/Users/mac/agents/shared-memory';
  const inboxPath = options.inboxPath || path.resolve(smDir, 'candidates', 'inbox.md');
  const candidatesJsonPath =
    options.candidatesJsonPath ||
    path.resolve(root, '.agents/skills/self-evolving-tester/references/knowledge_candidates.json');

  const report: PromotionReport = {
    totalScanned: 0,
    confirmedCount: 0,
    promotedCount: 0,
    alreadyPromotedCount: 0,
    skippedCount: 0,
    items: [],
  };

  if (!fs.existsSync(inboxPath)) {
    return report;
  }

  // 1. 读取并解析 inbox.md
  const inboxContent = fs.readFileSync(inboxPath, 'utf8');
  const candBlockRegex =
    /-\s*\[([ xX])\]\s*\*\*\[(CAND-[^\]]+)\]\*\*\s*来源:\s*`?([^`\n]+)`?[^\n]*\n([\s\S]*?)(?=(?:-\s*\[[ xX]\]|$))/g;

  // 2. 读取现有 knowledge_candidates.json
  let knowledgeList: Array<Record<string, unknown>> = [];
  if (fs.existsSync(candidatesJsonPath)) {
    try {
      const raw = fs.readFileSync(candidatesJsonPath, 'utf8');
      knowledgeList = JSON.parse(raw);
      if (!Array.isArray(knowledgeList)) {
        knowledgeList = [];
      }
    } catch {
      knowledgeList = [];
    }
  }

  let match;
  let hasNewPromotion = false;
  const promotedExperiencesList: Experience[] = [];

  while ((match = candBlockRegex.exec(inboxContent)) !== null) {
    report.totalScanned++;
    const isChecked = match[1].toLowerCase() === 'x';
    const candId = match[2].trim();
    const agent = match[3].trim();
    const body = match[4].trim();

    // 规则 1: 仅 - [x] 允许进入 promotion，- [ ] 严格拒绝
    if (!isChecked) {
      report.skippedCount++;
      report.items.push({
        candidateId: candId,
        status: 'INVALID_CANDIDATE_SKIPPED',
        reason: 'CANDIDATE_NOT_CONFIRMED (未勾选 - [x])',
      });
      continue;
    }

    report.confirmedCount++;

    // 规则 2: 解析主题、内容、目标归宿
    const topicMatch = body.match(/-\s*\*\*主题\*\*:\s*([^\n]+)/);
    const contentMatch = body.match(/-\s*\*\*提议内容\*\*:\s*([^\n]+)/);

    const topic = topicMatch ? topicMatch[1].trim() : `Candidate ${candId}`;
    const content = contentMatch ? contentMatch[1].trim() : body;

    const patternMatch = topic.match(/\[(FP-\d{3})\]/) || content.match(/\[(FP-\d{3})\]/);
    const modelMatch = topic.match(/模型\s*#(\d+)/) || content.match(/模型\s*#(\d+)/);
    const patternId = patternMatch ? patternMatch[1] : undefined;
    const modelId = modelMatch ? Number(modelMatch[1]) : undefined;

    // 规则 3: 幂等性检查 (同一 Candidate 不得重复晋升)
    const alreadyPromoted = knowledgeList.some((k) => k.sourceCandidateId === candId);
    if (alreadyPromoted) {
      report.alreadyPromotedCount++;
      report.items.push({
        candidateId: candId,
        status: 'ALREADY_PROMOTED',
        reason: 'CANDIDATE_ALREADY_PROMOTED (sourceCandidateId 已存在)',
      });
      continue;
    }

    // 规则 4: 内容去重 (相同 patternId + modelId 或完全相同的 claim 拒绝重复插入)
    const isDuplicateContent = knowledgeList.some((k) => {
      if (k.claim === topic) return true;
      if (
        patternId &&
        modelId !== undefined &&
        (k.related_pattern_id === patternId || k.relatedPatternId === patternId) &&
        (k.related_model_id === modelId || k.relatedModelId === modelId)
      ) {
        return true;
      }
      return false;
    });

    if (isDuplicateContent) {
      report.skippedCount++;
      report.items.push({
        candidateId: candId,
        status: 'DUPLICATE_CONTENT_SKIPPED',
        reason: 'DUPLICATE_PATTERN_AND_MODEL_EXIST (已存在相同模式与模型的知识)',
      });
      continue;
    }

    // 规则 5: 构建符合 schema 的结构化条目
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const nextSeq = String(knowledgeList.length + 1).padStart(2, '0');
    const newId = `KC-${todayStr}-${nextSeq}`;

    let domain: 'Task' | 'Billing' | 'Media' | 'Routing' = 'Task';
    if (patternId === 'FP-004' || patternId === 'FP-005') domain = 'Billing';
    else if (patternId === 'FP-002') domain = 'Media';
    else if (patternId === 'FP-001' || patternId === 'FP-003') domain = 'Task';

    const newKnowledgeEntry: Record<string, unknown> = {
      id: newId,
      claim: topic,
      evidence: [
        {
          source: 'shared-memory/candidates/inbox.md',
          location: candId,
          reason: content,
        },
      ],
      confidence: 'CONFIRMED',
      domain,
      status: 'ACCEPTED',
      derived_from: [`shared-memory/candidates/inbox.md: ${candId}`, `agent: ${agent}`],
      notes: content,
      sourceCandidateId: candId,
      promotedAt: now.toISOString(),
      related_pattern_id: patternId,
      related_model_id: modelId,
    };

    const defaultCheck = resolveDefaultPlanCheck(patternId, topic);
    if (defaultCheck) {
      newKnowledgeEntry.requiredPlanCheck = defaultCheck;
    }

    knowledgeList.push(newKnowledgeEntry);
    hasNewPromotion = true;
    report.promotedCount++;

    const promotedExp: Experience = {
      id: newId,
      title: topic,
      context: content,
      symptom: topic,
      root_cause: content,
      verification: defaultCheck?.verificationMethod || '已确认业务规则',
      related_pattern_id: patternId,
      related_model_id: modelId,
      confidence: 'CONFIRMED',
      status: 'ACCEPTED',
      sourceCandidateId: candId,
      promotedAt: now.toISOString(),
      requiredPlanCheck: defaultCheck,
    };
    promotedExperiencesList.push(promotedExp);

    report.items.push({
      candidateId: candId,
      status: 'PROMOTED',
      knowledgeId: newId,
      knowledge: promotedExp,
      reason: 'CANDIDATE_SUCCESSFULLY_PROMOTED',
    });
  }

  // 3. 写入知识库 (如非 dryRun 且有新增)
  if (hasNewPromotion && !options.dryRun) {
    const parentDir = path.dirname(candidatesJsonPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(candidatesJsonPath, JSON.stringify(knowledgeList, null, 2) + '\n', 'utf8');
  }

  // 4. 若有新晋升，构造确定性 Sync Payload 挂载在 report 上
  if (promotedExperiencesList.length > 0) {
    const syncRes = buildKnowledgeSyncPayload({
      knowledge: promotedExperiencesList,
      repository: DEFAULT_GITHUB_KNOWLEDGE_CONFIG.repository,
      path: DEFAULT_GITHUB_KNOWLEDGE_CONFIG.path,
    });
    report.syncRequired = syncRes.syncRequired;
    report.syncPayload = syncRes.payload;
  } else {
    report.syncRequired = false;
  }

  return report;
}
