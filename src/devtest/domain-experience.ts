/**
 * Panqu AI DevTest 领域经验 / 失败模式 / 上下文解析 / 执行计划构建
 *
 * 由 domain-knowledge.ts 物理拆分而来（纯结构分解，零逻辑改动）。
 * 承载：Experience / FailurePattern 定义与匹配、领域上下文解析、领域执行计划生成。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  type KnowledgeCredibility,
  type BusinessEntity,
  type ApiKnowledge,
  type OracleKnowledge,
  type TaskKnowledge,
  PANQU_BUSINESS_ENTITIES,
  PANQU_API_KNOWLEDGE,
  PANQU_ORACLE_KNOWLEDGE,
  PANQU_TASK_KNOWLEDGE,
} from './domain-knowledge-base.js';

// ============================================================================
// 6. 已确认测试经验与失败模式 (Experience & Failure Pattern)
// ============================================================================

export interface Experience {
  id: string;
  title: string;
  context: string;
  symptom: string;
  root_cause: string;
  verification: string;
  related_api?: string;
  related_task?: string;
  related_oracle?: string;
  related_model_id?: number;
  related_resolution?: string;
  related_pattern_id?: string;
  confidence: KnowledgeCredibility;
  status?: 'CONFIRMED' | 'PENDING' | 'REJECTED' | 'STALE' | 'ACCEPTED';
  sourceCandidateId?: string;
  promotedAt?: string;
  requiredPlanCheck?: {
    stage: 'PRECONDITION' | 'OPERATION' | 'API_VERIFY' | 'TASK_VERIFY' | 'ORACLE_VERIFY' | 'BUSINESS_RESULT';
    description: string;
    targetObject: string;
    expectedOutcome: string;
    verificationMethod: string;
  };
}

export interface FailurePattern {
  id: string;
  name: string;
  trigger: string;
  symptom: string;
  verification: string;
  related_domain: string[];
  confidence: KnowledgeCredibility;
}

export const PANQU_FAILURE_PATTERNS: Record<string, FailurePattern> = {
  PATTERN_API_SUCCESS_TASK_FAILED: {
    id: 'FP-001',
    name: 'API返回成功但Task实际失败',
    trigger: '异步 Worker 处理超时、上游模型鉴权失效或提示词被敏感词拦截',
    symptom: 'HTTP POST 提交返回 { code: 1, msg: "提交成功" }，但轮询 task_status 最终为 3 (Failed) 或 4 (Error)',
    verification: '绝不能仅凭 API response code=1 就下达 PASS 判定，必须持续轮询到终态，并断言 terminalStatus === 2',
    related_domain: ['Task', 'API_VIDEO_SUBMIT', 'AI_TASKS'],
    confidence: 'CONFIRMED',
  },
  PATTERN_TASK_SUCCESS_NO_ASSET: {
    id: 'FP-002',
    name: 'Task成功但最终业务产物不存在或不可用',
    trigger: '转码上传 OSS 失败、CDN 链接损坏、或回写数据库产物字段丢失',
    symptom: 'Task 状态为 2 (SUCCESS)，但 video_url / pic_url 为空、返回 404 或内容为 0 字节损坏文件',
    verification:
      '必须物理拉取媒体产物前 64KB，执行 MP4 Box (ftyp/moov/mdat) 或 PNG IHDR 完整性验真，缺失产物标记 FAIL/UNVERIFIED',
    related_domain: ['Task', 'MediaAsset', 'MEDIA_INSPECTOR'],
    confidence: 'CONFIRMED',
  },
  PATTERN_PROJECT_OWNERSHIP_MISMATCH: {
    id: 'FP-003',
    name: '参数隐式所有权关系违背',
    trigger: '提交任务时携带跨项目 project_id 与 folder_id，或操作非本人拥有的项目',
    symptom: '接口可能返回成功但在生成媒体入库时被孤立，或者由于外键权限拦截抛出静默错误',
    verification: '检查 project_id 与 folder_id 的级联归属一致性，测试计划中需覆盖非法 project_id 边界防线',
    related_domain: ['Project', 'Folder', 'Task'],
    confidence: 'CONFIRMED',
  },
  PATTERN_DOUBLE_BILLING: {
    id: 'FP-004',
    name: '任务重复扣费资损缺陷',
    trigger: '前端重试或后端网络超时重试缺乏幂等控制',
    symptom: '同一 task_id 在 pq_score_log 中产生 2 笔或以上 type=2 的扣费记录',
    verification: '严格执行 BillingOracle.antiDoubleBilling 不变量校验，preDeductCount > 1 立即裁决 FAIL',
    related_domain: ['BillingLedger', 'PQ_SCORE_LOG'],
    confidence: 'CONFIRMED',
  },
  PATTERN_FAILED_NO_REFUND: {
    id: 'FP-005',
    name: '失败任务未触发退款资损缺陷',
    trigger: '异步 Worker 在处理异常退出时未捕获异常抛给退款补偿逻辑',
    symptom: 'Task 终态为 3 (Failed)，但 pq_score_log 中无 type=1 退款流水，导致 netDeductedPoints > 0',
    verification: '严格执行 BillingOracle.netChargeZero 不变量校验，失败任务净扣不为 0 立即裁决 FAIL',
    related_domain: ['BillingLedger', 'Task', 'PQ_SCORE_LOG'],
    confidence: 'CONFIRMED',
  },
  PATTERN_GATEWAY_CHANNEL_MISMATCH: {
    id: 'FP-006',
    name: '指定目标渠道未履约或发生渠道漂移',
    trigger: '网关路由组配置变动、渠道权重调度漂移或下游上游通道故障切换',
    symptom: '测试期望验证指定渠道 (如 RH-国际 #2)，但服务端实际路由至其他渠道 (如 TD_国际 #54)',
    verification: '比对目标渠道与 retrylog/exceptionaltask 实际渠道，渠道不符判定验收失败',
    related_domain: ['Channel', 'Routing', 'Task'],
    confidence: 'CONFIRMED',
  },
  PATTERN_FALLBACK_ARTIFACT_NOT_ACCEPTED: {
    id: 'FP-007',
    name: '兜底成片冒充目标渠道合格',
    trigger: '目标渠道生成失败后触发后端重试/兜底补偿链路 (如 volc_new)',
    symptom: '前端任务最终状态为成功，产物有效，但实际是由兜底供应商生成，目标渠道本身失败',
    verification:
      '检查 retrylog.fallback_channel 及 exceptionaltask.extra.retry_provider，兜底生成的产物不得计入目标渠道合格',
    related_domain: ['Channel', 'Fallback', 'Artifact'],
    confidence: 'CONFIRMED',
  },
  PATTERN_EVIDENCE_CONFLICT: {
    id: 'FP-008',
    name: '调用者入参与服务端只读事实冲突',
    trigger: '外部命令行或测试入参试图手工指定与服务端实际只读事实相反的渠道或兜底参数',
    symptom: '服务端事实为实际渠道 54、发生 volc_new 兜底，但调用者输入断言为渠道 2、无兜底',
    verification: '服务端只读事实强制优先，检测到调用者与服务端事实冲突立即判定 EVIDENCE_CONFLICT 并拒收',
    related_domain: ['Channel', 'Evidence', 'Audit'],
    confidence: 'CONFIRMED',
  },
};

/**
 * 针对历史已确认缺陷模式提供默认标准核验策略后备 (Fallback Helper)
 * 仅用于确保存量/未显式声明 requiredPlanCheck 的条目具备标准核验动作，
 * 核心规划器 core-kernel.ts 统一由 exp.requiredPlanCheck 驱动，不再硬编码特判。
 */
export function resolveDefaultPlanCheck(
  patternId?: string,
  topic?: string,
): Experience['requiredPlanCheck'] | undefined {
  if (patternId === 'FP-004') {
    return {
      stage: 'ORACLE_VERIFY',
      description: `针对 ${topic || 'Wan3.0 双重扣费高发隐患'} 重点防范重试与并发重复扣款 (FP-004)`,
      targetObject: 'BillingLedger',
      expectedOutcome: 'preDeductCount 严格 === 1',
      verificationMethod: 'BillingOracle.reconcileTaskLedger antiDoubleBilling 校验',
    };
  }
  if (patternId === 'FP-005') {
    return {
      stage: 'ORACLE_VERIFY',
      description: `针对 ${topic || '任务失败未退款隐患'} 重点核查异常终态下的退款核销流水与净扣归零 (FP-005)`,
      targetObject: 'BillingLedger',
      expectedOutcome: '若任务非成功终态，必须存在对应退款流水且 netDeducted === 0',
      verificationMethod: 'BillingOracle.reconcileTaskLedger netChargeZero 校验',
    };
  }
  return undefined;
}

/**
 * 动态加载已确认历史经验 (Ingest 阶段)
 * 仅从项目唯一长期知识主源 references/knowledge_candidates.json 读取 ACCEPTED/CONFIRMED 事实，
 * 绝不在运行时直接读取 shared-memory/candidates/inbox.md，避免未审核或未经晋升的候选污染运行时。
 */
export function loadConfirmedExperiences(
  options: {
    projectRoot?: string;
    sharedMemoryDir?: string;
    extraExperiences?: Experience[];
  } = {},
): Experience[] {
  const experiences: Experience[] = [];
  const seenIds = new Set<string>();

  // 1. 读取本地技能库的唯一长期知识主源 (仅取 ACCEPTED/CONFIRMED，跳过 PENDING)
  const root = options.projectRoot || process.cwd();
  const candidatesJsonPath = path.resolve(
    root,
    '.agents/skills/self-evolving-tester/references/knowledge_candidates.json',
  );
  if (fs.existsSync(candidatesJsonPath)) {
    try {
      const raw = fs.readFileSync(candidatesJsonPath, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if ((item.status === 'ACCEPTED' || item.status === 'CONFIRMED') && item.confidence === 'CONFIRMED') {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              if (item.sourceCandidateId) {
                seenIds.add(item.sourceCandidateId);
              }
              const patternMatch = (item.claim || '').match(/\[(FP-\d{3})\]/);
              const modelMatch = (item.claim || '').match(/模型\s*#(\d+)/);
              const patternId =
                item.related_pattern_id ||
                item.relatedPatternId ||
                (patternMatch ? patternMatch[1] : item.id.startsWith('KC-') ? undefined : item.id);
              const title = item.title || item.claim || item.id;

              experiences.push({
                id: item.id,
                title,
                context: item.context || item.notes || item.claim || '',
                symptom: item.symptom || item.claim || '',
                root_cause: item.root_cause || (item.evidence && item.evidence[0]?.reason) || '已确认经验证据',
                verification: item.verification || (item.evidence && item.evidence[0]?.location) || '验证规则',
                related_api: item.related_api || item.relatedApi,
                related_task: item.related_task || item.relatedTask,
                related_oracle: item.related_oracle || item.relatedOracle,
                related_resolution: item.related_resolution || item.relatedResolution,
                related_pattern_id: patternId,
                related_model_id:
                  item.related_model_id !== undefined
                    ? Number(item.related_model_id)
                    : item.relatedModelId !== undefined
                      ? Number(item.relatedModelId)
                      : modelMatch
                        ? Number(modelMatch[1])
                        : undefined,
                confidence: 'CONFIRMED',
                status: 'ACCEPTED',
                sourceCandidateId: item.sourceCandidateId,
                promotedAt: item.promotedAt,
                requiredPlanCheck: item.requiredPlanCheck,
              });
            }
          }
        }
      }
    } catch {
      // 容错忽略格式错误
    }
  }

  // 2. 合并外部显式传入的动态经验集合 (供测试或上层显式入参)
  if (options.extraExperiences && Array.isArray(options.extraExperiences)) {
    for (const exp of options.extraExperiences) {
      if (!seenIds.has(exp.id)) {
        seenIds.add(exp.id);
        experiences.push(exp);
      }
    }
  }

  return experiences;
}

/**
 * 确定性历史经验上下文匹配器 (Experience Matching)
 * 严格利用当前真实测试上下文维度，无关经验坚决不污染当前 plan。
 */
export function matchRelevantExperiences(
  experiences: Experience[],
  context: {
    modelId?: number;
    mediaType?: 'video' | 'image';
    resolution?: string;
    flowType?: string;
    requirement?: string;
    apiEndpoint?: string;
    patternId?: string;
  },
): Experience[] {
  return experiences.filter((exp) => {
    // 状态安全阀：未确认的 candidate 绝不能匹配
    if (exp.status === 'PENDING' || exp.status === 'REJECTED' || exp.status === 'STALE') {
      return false;
    }

    // 1. 模型 ID 强隔离检查
    if (exp.related_model_id !== undefined && context.modelId !== undefined) {
      if (exp.related_model_id !== context.modelId) {
        return false;
      }
    } else if (context.modelId !== undefined) {
      // 仅在未显式指定 related_model_id 时从标题与上下文推导特定模型限定
      const text = `${exp.title} ${exp.context}`;
      const modelRegex = /模型\s*(?:ID\s*)?#?(\d+)(?![pkK])|(?:Wan3\.0.*\((\d+)\))|(?:Seedance.*\((\d+)\))/i;
      const m = text.match(modelRegex);
      if (m) {
        const boundModel = Number(m[1] || m[2] || m[3]);
        if (boundModel && boundModel !== context.modelId) {
          return false; // 明确绑定了其他模型，禁止匹配
        }
      }
    }

    // 2. 分辨率规格匹配检查
    if (exp.related_resolution && context.resolution) {
      if (exp.related_resolution.toLowerCase() !== context.resolution.toLowerCase()) {
        return false;
      }
    }

    // 3. API 接口匹配检查
    if (exp.related_api && context.apiEndpoint) {
      if (exp.related_api !== context.apiEndpoint) {
        return false;
      }
    }

    // 4. 任务模态匹配检查
    if (exp.related_task && context.mediaType) {
      if (context.mediaType === 'video' && exp.related_task.includes('IMAGE')) return false;
      if (context.mediaType === 'image' && exp.related_task.includes('VIDEO')) return false;
    }

    // 5. 失败模式指纹匹配检查
    if (context.patternId && exp.related_pattern_id) {
      if (context.patternId !== exp.related_pattern_id) {
        return false;
      }
    }

    return true;
  });
}

// ============================================================================
// 7. 领域上下文解析引擎 (Domain Context Resolver)
// ============================================================================

export interface DomainProbeAnalysis {
  targetDomain: string;
  identifiedObjects: BusinessEntity[];
  applicableApis: ApiKnowledge[];
  applicableOracles: OracleKnowledge[];
  applicableTasks: TaskKnowledge[];
  matchedFailurePatterns: FailurePattern[];
  relevantExperiences: Experience[];
  unknowns: Array<{ area: string; item: string; reason: string }>;
  riskWarnings: string[];
}

export function resolveDomainContext(input: {
  requirement?: string;
  modelId?: number;
  mediaType?: 'video' | 'image';
  taskId?: number;
  flowType?: string;
  extraExperiences?: Experience[];
  projectRoot?: string;
}): DomainProbeAnalysis {
  const req = (input.requirement || '').toLowerCase();
  const mediaType = input.mediaType || (req.includes('图') || req.includes('image') ? 'image' : 'video');
  const targetDomain = mediaType === 'image' ? 'Panqu AI 生图业务域' : 'Panqu AI 视频创作业务域';

  // 1. 识别关联业务实体
  const identifiedObjects: BusinessEntity[] = [
    PANQU_BUSINESS_ENTITIES.Project,
    PANQU_BUSINESS_ENTITIES.Task,
    PANQU_BUSINESS_ENTITIES.MediaAsset,
    PANQU_BUSINESS_ENTITIES.BillingLedger,
  ];
  if (req.includes('文件夹') || req.includes('目录') || req.includes('folder')) {
    identifiedObjects.push(PANQU_BUSINESS_ENTITIES.Folder);
  }

  // 2. 匹配可用 API 契约
  const applicableApis: ApiKnowledge[] = [];
  if (mediaType === 'video') {
    applicableApis.push(PANQU_API_KNOWLEDGE.VIDEO_SUBMIT);
  } else {
    applicableApis.push(PANQU_API_KNOWLEDGE.IMAGE_SUBMIT);
  }
  applicableApis.push(PANQU_API_KNOWLEDGE.TASK_STATUS_POLL);
  applicableApis.push(PANQU_API_KNOWLEDGE.ADMIN_SCORE_QUERY);
  applicableApis.push(PANQU_API_KNOWLEDGE.PERSONAL_BILLING_QUERY);

  // 3. 关联 Oracle 知识
  const applicableOracles: OracleKnowledge[] = [
    PANQU_ORACLE_KNOWLEDGE.AI_TASKS,
    PANQU_ORACLE_KNOWLEDGE.PQ_SCORE_LOG,
    PANQU_ORACLE_KNOWLEDGE.PQ_MEDIA_ASSET,
  ];

  // 4. 关联 Task 知识
  const applicableTasks: TaskKnowledge[] = [
    mediaType === 'video' ? PANQU_TASK_KNOWLEDGE.VIDEO_TASK : PANQU_TASK_KNOWLEDGE.IMAGE_TASK,
  ];

  // 5. 动态加载经验并按真实上下文过滤匹配
  const allExperiences = loadConfirmedExperiences({
    projectRoot: input.projectRoot,
    extraExperiences: input.extraExperiences,
  });
  const relevantExperiences = matchRelevantExperiences(allExperiences, {
    modelId: input.modelId,
    mediaType,
    flowType: input.flowType,
    requirement: input.requirement,
  });

  const matchedFailurePatterns: FailurePattern[] = Object.values(PANQU_FAILURE_PATTERNS);

  // 6. 提取与声明明确的 UNKNOWN 风险项
  const unknowns: Array<{ area: string; item: string; reason: string }> = [
    {
      area: 'Oracle - ai_tasks',
      item: 'extra 字段在 HTTP API 的可见性',
      reason:
        'HTTP API 不返回 extra 内部字段，属于已知可见性缺口，必须由只读 DB 验真或标记 MANUAL_DB_EVIDENCE_REQUIRED',
    },
    {
      area: 'Infrastructure',
      item: '底层 Go Consumer 队列重试最大次数与分流消费延迟',
      reason: '未开放只读探针或配置字典，不可假设固定延时',
    },
  ];

  const riskWarnings: string[] = [
    '【高风险排查】：谨防 API 返回成功 (code=1) 但 Task 实际在异步阶段失败 (FP-001)',
    '【产物完整性】：Task 成功必须进一步校验物理媒体文件容器结构，防止空文件假成功 (FP-002)',
    '【账务审计】：必须执行三大计费不变量对账，严禁仅看扣除数字而忽略退款流水 (FP-004 / FP-005)',
  ];

  for (const exp of relevantExperiences) {
    if (!riskWarnings.some((w) => w.includes(exp.title))) {
      riskWarnings.push(`【历史经验告警】针对模型 #${input.modelId ?? '通用'}: ${exp.title} (${exp.symptom})`);
    }
  }

  return {
    targetDomain,
    identifiedObjects,
    applicableApis,
    applicableOracles,
    applicableTasks,
    matchedFailurePatterns,
    relevantExperiences,
    unknowns,
    riskWarnings,
  };
}

// ============================================================================
// 8. 领域驱动测试计划构建器 (Domain Test Plan Builder)
// ============================================================================

export interface DomainExecutionStep {
  stage: 'PRECONDITION' | 'OPERATION' | 'API_VERIFY' | 'TASK_VERIFY' | 'ORACLE_VERIFY' | 'BUSINESS_RESULT';
  description: string;
  targetObject: string;
  expectedOutcome: string;
  credibility: KnowledgeCredibility;
  verificationMethod: string;
}

export interface DomainExecutionPlan {
  summary: string;
  businessGoal: string;
  steps: DomainExecutionStep[];
  confidenceLevel: KnowledgeCredibility;
  caveats: string[];
  relevantExperiences?: Experience[];
}

export function generateDomainExecutionPlan(input: {
  modelId: number;
  mediaType: 'video' | 'image';
  resolution?: string;
  duration?: number;
  flowType?: string;
  requirement?: string;
  expectedPoints: number;
  extraExperiences?: Experience[];
  projectRoot?: string;
}): DomainExecutionPlan {
  const { modelId, mediaType, expectedPoints } = input;
  const isVideo = mediaType === 'video';

  const steps: DomainExecutionStep[] = [
    {
      stage: 'PRECONDITION',
      description: '核验测试环境会话凭据、可用积分余额与归属 project_id 有效性',
      targetObject: 'Project',
      expectedOutcome: `具备有效 Cookie/CSRF，且账户积分 >= ${expectedPoints} pt`,
      credibility: 'CONFIRMED',
      verificationMethod: 'probe() 环境连通性与凭据探测',
    },
    {
      stage: 'OPERATION',
      description: `调用 ${isVideo ? '视频' : '生图'} 提交接口，传入合法模型规格与业务项目参数`,
      targetObject: 'Task',
      expectedOutcome: '向主站发起 HTTP POST，携带 project_id 与 prompt',
      credibility: 'CONFIRMED',
      verificationMethod: 'execute() 任务提交',
    },
    {
      stage: 'API_VERIFY',
      description: '校验任务提交 API 响应结果',
      targetObject: 'API',
      expectedOutcome: 'HTTP 200，code === 1，成功获得非空业务 taskId',
      credibility: 'CONFIRMED',
      verificationMethod: '断言 res.ok === true && res.taskId > 0',
    },
    {
      stage: 'TASK_VERIFY',
      description: '轮询 /aivideo/v2/task_status/apiGetStatus 跟踪异步任务生命周期',
      targetObject: 'Task',
      expectedOutcome: 'Task 状态由 1 (排队/处理中) 演进并最终确认为 2 (SUCCESS)，progress === 100',
      credibility: 'CONFIRMED',
      verificationMethod: 'pollTaskStatus() 跟踪，断言 terminalStatus === "SUCCESS"',
    },
    {
      stage: 'ORACLE_VERIFY',
      description: '审计积分流水账本，核验防重复扣款、退款幂等及扣费数额',
      targetObject: 'BillingLedger',
      expectedOutcome: `产生且仅产生 1 笔预扣流水，预扣积分与刊例相符 (${expectedPoints} pt)`,
      credibility: 'CONFIRMED',
      verificationMethod: 'BillingOracle.reconcileTaskLedger() 三大不变量断言',
    },
    {
      stage: 'BUSINESS_RESULT',
      description: `物理拉取媒体产物直链，核验二进制文件容器完整性及与 Task 的真实归属`,
      targetObject: 'MediaAsset',
      expectedOutcome: `${isVideo ? 'MP4 容器结构解析通过 (ftyp/moov/mdat)' : '图片容器结构解析通过 (IHDR)'}，ownership === VERIFIED`,
      credibility: 'CONFIRMED',
      verificationMethod: 'media-inspector 二进制深度检测与 TaskSnapshot 绑定核验',
    },
  ];

  const caveats: string[] = [
    '严禁以 API code=1 直接判定整个测试 PASS',
    'Task 失败时必须触发失败退款验证（净扣必须归零）',
  ];

  // 动态加载并匹配相关经验，真正改变 plan 计划步骤
  const allExperiences = loadConfirmedExperiences({
    projectRoot: input.projectRoot,
    extraExperiences: input.extraExperiences,
  });
  const relevant = matchRelevantExperiences(allExperiences, {
    modelId,
    mediaType,
    resolution: input.resolution,
    flowType: input.flowType,
    requirement: input.requirement,
  });

  for (const exp of relevant) {
    if (exp.requiredPlanCheck) {
      steps.push({
        stage: exp.requiredPlanCheck.stage,
        description: `[历史经验核验] ${exp.requiredPlanCheck.description}`,
        targetObject: exp.requiredPlanCheck.targetObject,
        expectedOutcome: exp.requiredPlanCheck.expectedOutcome,
        credibility: 'CONFIRMED',
        verificationMethod: exp.requiredPlanCheck.verificationMethod,
      });
    }

    caveats.push(`[历史经验告警]: ${exp.title} - ${exp.symptom}`);
  }

  return {
    summary: `Panqu 业务全链路测试方案: 模型 #${modelId} (${mediaType})`,
    businessGoal: `验证模型 #${modelId} 在 Panqu 真实业务场景下的从前置准备、接口提交、异步消费到产物入库与计费对账闭环`,
    steps,
    confidenceLevel: 'CONFIRMED',
    caveats,
    relevantExperiences: relevant,
  };
}
