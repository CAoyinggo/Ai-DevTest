/**
 * Panqu AI DevTest 企业领域静态知识库 (Domain Knowledge Base)
 *
 * 由 domain-knowledge.ts 物理拆分而来（ARCHITECTURE_FREEZE 治理下的纯结构分解，零逻辑改动）。
 * 承载：知识可信度边界 + 业务实体 / API / Oracle / Task 四大静态知识表。
 * 对外公共导出面经由 domain-knowledge.ts barrel 保持字节级不变。
 */

// ============================================================================
// 1. 知识可信度边界定义 (Knowledge Credibility Boundary)
// ============================================================================

export type KnowledgeCredibility =
  | 'CONFIRMED' // 官方定义 / 线上已验证事实（直接信任并作为强断言基准）
  | 'OBSERVED' // 真实执行中观察到的现象（作为经验参考，不可作为排他硬断言）
  | 'INFERRED' // Agent 根据现有事实逻辑推断（必须注明不确定性与推断依据）
  | 'UNKNOWN' // 当前未知（严禁自行编造，必须明确缺口并要求人工/环境确认）
  | 'PROVISIONAL' // 仅来自调用者入参断言/临时假设（未获服务端只读背书）
  | 'SUSPICIOUS'; // 存在冲突或存疑（严禁作为确认事实）

export interface CredibleFact<T> {
  value: T;
  credibility: KnowledgeCredibility;
  source: string;
  rationale?: string;
  unknownReason?: string;
}

export function createConfirmedFact<T>(value: T, source = 'official_spec'): CredibleFact<T> {
  return { value, credibility: 'CONFIRMED', source };
}

export function createObservedFact<T>(value: T, source = 'runtime_observation'): CredibleFact<T> {
  return { value, credibility: 'OBSERVED', source };
}

export function createInferredFact<T>(value: T, rationale: string, source = 'agent_inference'): CredibleFact<T> {
  return { value, credibility: 'INFERRED', source, rationale };
}

export function createUnknownFact<T = unknown>(
  itemDescription: string,
  unknownReason: string,
): CredibleFact<T | undefined> {
  return {
    value: undefined,
    credibility: 'UNKNOWN',
    source: 'unknown_boundary',
    unknownReason: `[UNKNOWN] ${itemDescription}: ${unknownReason} (禁止模型自动补全)`,
  };
}

// ============================================================================
// 2. 业务实体对象模型 (Domain Business Objects)
// ============================================================================

export interface BusinessEntity {
  name: string;
  code: string;
  description: string;
  idField: string;
  parentEntity?: string;
  childEntities?: string[];
  credibility: KnowledgeCredibility;
  knownFields: string[];
  unknownFields?: string[];
  businessConstraints: string[];
}

export const PANQU_BUSINESS_ENTITIES: Record<string, BusinessEntity> = {
  Project: {
    name: '项目 (Project)',
    code: 'PROJECT',
    description: '媒体创作顶层业务容器，所有 Task、Folder 与 MediaAsset 的所有权归属主体。',
    idField: 'project_id',
    childEntities: ['Folder', 'Task', 'MediaAsset'],
    credibility: 'CONFIRMED',
    knownFields: ['id', 'name', 'user_id', 'createtime', 'updatetime'],
    unknownFields: ['pq_project 团队跨组织共享权限字段细节目前 UNKNOWN'],
    businessConstraints: [
      '所有生成的 Task 必须关联有效的 project_id，不可提交孤儿任务',
      '跨 project_id 访问或引用未公开素材将被服务端鉴权拦截',
    ],
  },
  Folder: {
    name: '素材文件夹 (Folder)',
    code: 'FOLDER',
    description: '项目内部的目录层级容器，用于组织归档产物和素材。',
    idField: 'folder_id',
    parentEntity: 'Project',
    childEntities: ['MediaAsset'],
    credibility: 'CONFIRMED',
    knownFields: ['id', 'project_id', 'name', 'parent_id'],
    unknownFields: ['文件夹最大嵌套深度限制目前 UNKNOWN'],
    businessConstraints: ['folder_id 必须归属于当前 task 相同的 project_id，严禁跨项目挂载'],
  },
  Task: {
    name: '异步生成任务 (Task)',
    code: 'TASK',
    description: 'AI 视频/生图/音频处理的异步作业单元，具备完整的状态机生命周期。',
    idField: 'task_id',
    parentEntity: 'Project',
    childEntities: ['MediaAsset', 'BillingLedger'],
    credibility: 'CONFIRMED',
    knownFields: ['id', 'project_id', 'type', 'task_status', 'progress', 'video_url', 'pic_url', 'extra', 'err'],
    unknownFields: ['底层 Go worker 队列分流与重试最大次数目前 UNKNOWN'],
    businessConstraints: [
      'API 成功返回并不代表 Task 成功，必须跟踪至终态 (task_status=2)',
      'Task 状态为 3/4 时，必须触发退款且净扣积分归零',
      'Task 成功终态必须产出有效业务产物并绑定到所属 Project',
    ],
  },
  MediaAsset: {
    name: '媒体资产 (MediaAsset)',
    code: 'MEDIA_ASSET',
    description: 'Task 执行成功后生成的物理文件或在用户媒体库中持久化的实体。',
    idField: 'asset_id',
    parentEntity: 'Project',
    credibility: 'CONFIRMED',
    knownFields: ['id', 'project_id', 'folder_id', 'task_id', 'url', 'format', 'size'],
    unknownFields: ['CDN 缓存刷新生命周期策略目前 UNKNOWN'],
    businessConstraints: [
      '媒体文件不仅需要 HTTP 200，还需要具备合法二进制容器结构 (MP4/PNG)',
      '产物 URL 必须与 Task 建立明确归属绑定证据 (Artifact Ownership)',
    ],
  },
  BillingLedger: {
    name: '账务流水 (BillingLedger)',
    code: 'BILLING_LEDGER',
    description: '用户积分账户变动明细，核验业务扣费真实性与合法性。',
    idField: 'log_id',
    parentEntity: 'Task',
    credibility: 'CONFIRMED',
    knownFields: ['id', 'task_id', 'type', 'score', 'memo', 'createtime'],
    unknownFields: ['月度归档分表归档触发时刻目前 UNKNOWN'],
    businessConstraints: [
      '每个任务最多仅允许 1 笔有效预扣 (antiDoubleBilling)',
      '失败任务必须净扣归零 (netChargeZero)',
      '退款动作必须严格幂等，成功任务严禁出现退款 (refundIdempotency)',
    ],
  },
};

// ============================================================================
// 3. API 领域知识 (API Knowledge)
// ============================================================================

export interface ApiParameterKnowledge {
  name: string;
  type: string;
  meaning: string;
  required: boolean;
  businessEntity?: string;
  constraints?: string;
  credibility: KnowledgeCredibility;
}

export interface ApiKnowledge {
  id: string;
  name: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  parameters: ApiParameterKnowledge[];
  preconditions: string[];
  returnStructure: {
    successCode: number | string;
    codeField: string;
    dataField: string;
    messageField: string;
    credibility: KnowledgeCredibility;
  };
  associatedObjects: string[];
  testCaveats: string[];
  credibility: KnowledgeCredibility;
}

export const PANQU_API_KNOWLEDGE: Record<string, ApiKnowledge> = {
  VIDEO_SUBMIT: {
    id: 'api_video_submit',
    name: '视频生成任务提交接口',
    endpoint: '/aivideo/v2/generate/video',
    method: 'POST',
    parameters: [
      { name: '__token__', type: 'string', meaning: 'CSRF 防护令牌', required: true, credibility: 'CONFIRMED' },
      {
        name: 'project_id',
        type: 'number',
        meaning: '关联的业务项目 ID',
        required: true,
        businessEntity: 'Project',
        credibility: 'CONFIRMED',
      },
      { name: 'row[name]', type: 'string', meaning: '任务业务名称', required: true, credibility: 'CONFIRMED' },
      {
        name: 'row[type]',
        type: 'number',
        meaning: '视频处理类型 (如 6=通用视频, 105=分流新版)',
        required: true,
        credibility: 'CONFIRMED',
      },
      {
        name: 'row[selmodelsId]',
        type: 'number',
        meaning: '主站模型配置 ID (如 84, 88, 15, 78)',
        required: true,
        credibility: 'CONFIRMED',
      },
      { name: 'row[extra][cueword]', type: 'string', meaning: '生成提示词', required: true, credibility: 'CONFIRMED' },
      {
        name: 'row[extra][duration]',
        type: 'number',
        meaning: '生成时长(秒)',
        required: true,
        constraints: '支持 3~5 秒枚举',
        credibility: 'CONFIRMED',
      },
      {
        name: 'row[extra][video_resolution]',
        type: 'string',
        meaning: '分辨率规格',
        required: true,
        constraints: '480p, 720p, 1080p',
        credibility: 'CONFIRMED',
      },
      {
        name: 'row[extra][video_aspect_ratio]',
        type: 'string',
        meaning: '画面比例',
        required: true,
        constraints: '16:9, 9:16, 1:1',
        credibility: 'CONFIRMED',
      },
    ],
    preconditions: [
      '必须具备有效的 Session Cookie 与 CSRF 令牌',
      '关联的 project_id 必须存在且用户具备写入权限',
      '用户账户可用积分必须 >= 预估扣除积分 (required_points)',
    ],
    returnStructure: {
      successCode: 1,
      codeField: 'code',
      dataField: 'data.id 或 data (number)',
      messageField: 'msg',
      credibility: 'CONFIRMED',
    },
    associatedObjects: ['Project', 'Task', 'BillingLedger'],
    testCaveats: [
      '接口返回 code=1 仅代表排队接收成功，绝不等于视频生成成功！',
      '此时仅产生了预扣冻结流水，必须进一步跟踪 Task 状态与产物',
      '若接口返回 code=0 或 402/10001，多为积分不足或鉴权失败',
    ],
    credibility: 'CONFIRMED',
  },
  IMAGE_SUBMIT: {
    id: 'api_image_submit',
    name: '生图任务提交接口',
    endpoint: '/aivideo/goods/add',
    method: 'POST',
    parameters: [
      { name: '__token__', type: 'string', meaning: 'CSRF 防护令牌', required: true, credibility: 'CONFIRMED' },
      {
        name: 'project_id',
        type: 'number',
        meaning: '关联的业务项目 ID',
        required: true,
        businessEntity: 'Project',
        credibility: 'CONFIRMED',
      },
      {
        name: 'row[selmodelsId]',
        type: 'number',
        meaning: '模型配置 ID (如 201, 205, 12)',
        required: true,
        credibility: 'CONFIRMED',
      },
      { name: 'row[extra][prompt]', type: 'string', meaning: '生图提示词', required: true, credibility: 'CONFIRMED' },
      {
        name: 'row[extra][resolution]',
        type: 'string',
        meaning: '生图分辨率规格 (如 1k, 2k, 4k)',
        required: true,
        credibility: 'CONFIRMED',
      },
      {
        name: 'row[extra][serviceline]',
        type: 'string',
        meaning: '业务线标识',
        required: false,
        credibility: 'CONFIRMED',
      },
    ],
    preconditions: ['有效登录 Session 与 CSRF', '账户积分余额充足'],
    returnStructure: {
      successCode: 1,
      codeField: 'code',
      dataField: 'data.id 或 data',
      messageField: 'msg',
      credibility: 'CONFIRMED',
    },
    associatedObjects: ['Project', 'Task', 'BillingLedger'],
    testCaveats: ['code=1 仅代表入队，必须轮询终态并校验 PNG/JPG 图像物理格式与尺寸'],
    credibility: 'CONFIRMED',
  },
  TASK_STATUS_POLL: {
    id: 'api_task_status_poll',
    name: '任务状态只读轮询接口',
    endpoint: '/aivideo/v2/task_status/apiGetStatus',
    method: 'POST',
    parameters: [
      { name: 'type', type: 'string', meaning: '媒体大类 (video 或 scene)', required: true, credibility: 'CONFIRMED' },
      {
        name: 'ids',
        type: 'string',
        meaning: '任务 ID (单值或逗号分隔)',
        required: true,
        businessEntity: 'Task',
        credibility: 'CONFIRMED',
      },
    ],
    preconditions: ['用户已登录，对目标 task 拥有只读查看权限'],
    returnStructure: {
      successCode: 1,
      codeField: 'code',
      dataField: 'data (数组或以 taskId 为键的对象)',
      messageField: 'msg',
      credibility: 'CONFIRMED',
    },
    associatedObjects: ['Task', 'MediaAsset'],
    testCaveats: [
      '此接口为纯只读操作，严禁在轮询中引入修改副作用',
      'task_status: 1=排队中, 2=成功, 3=失败, 4=异常',
      '只有状态到达 2/3/4 时才代表进入终态',
    ],
    credibility: 'CONFIRMED',
  },
  ADMIN_SCORE_QUERY: {
    id: 'api_admin_score_query',
    name: '积分流水审计接口 (AdminScore)',
    endpoint: '/auth/adminscore/index',
    method: 'GET',
    parameters: [
      {
        name: 'filter',
        type: 'string',
        meaning: 'JSON 过滤条件 {"task_id": ...}',
        required: true,
        credibility: 'CONFIRMED',
      },
      { name: 'op', type: 'string', meaning: 'JSON 操作符 {"task_id": "="}', required: true, credibility: 'CONFIRMED' },
    ],
    preconditions: ['管理员权限或拥有 FastAdmin score 查询凭据'],
    returnStructure: {
      successCode: 200,
      codeField: 'status/http',
      dataField: 'rows',
      messageField: 'msg',
      credibility: 'CONFIRMED',
    },
    associatedObjects: ['Task', 'BillingLedger'],
    testCaveats: [
      '必须区分 QUERY_SUCCESS (0条记录) 与 AUTH_FAILED / QUERY_TIMEOUT / PARSE_ERROR',
      '不得 catch 错误后伪造空数组当作无流水',
    ],
    credibility: 'CONFIRMED',
  },
  PERSONAL_BILLING_QUERY: {
    id: 'api_personal_billing_query',
    name: '个人积分流水接口 (apiPersonalRecords)',
    endpoint: '/aivideo/v2/billing/apiPersonalRecords',
    method: 'GET',
    parameters: [
      { name: 'page', type: 'number', meaning: '页码', required: false, credibility: 'CONFIRMED' },
      { name: 'limit', type: 'number', meaning: '分页限制', required: false, credibility: 'CONFIRMED' },
      {
        name: 'keyword',
        type: 'string',
        meaning: '搜索关键字 (通常为 taskId)',
        required: false,
        credibility: 'CONFIRMED',
      },
    ],
    preconditions: ['普通用户已登录 Session'],
    returnStructure: {
      successCode: 1,
      codeField: 'code',
      dataField: 'data.rows',
      messageField: 'msg',
      credibility: 'CONFIRMED',
    },
    associatedObjects: ['Task', 'BillingLedger'],
    testCaveats: ['个人端点仅在 task_id 明细或 memo/type_text 包含 taskId 时才建立关联'],
    credibility: 'CONFIRMED',
  },
};

// ============================================================================
// 4. Oracle 领域知识 (Oracle Knowledge)
// ============================================================================

export interface OracleFieldKnowledge {
  name: string;
  type: string;
  meaning: string;
  isStatusField?: boolean;
  credibility: KnowledgeCredibility;
  notes?: string;
}

export interface OracleKnowledge {
  businessObject: string;
  table: string;
  keyFields: string[];
  fields: Record<string, OracleFieldKnowledge>;
  statusField?: {
    name: string;
    meanings: Record<number | string, string>;
    credibility: KnowledgeCredibility;
  };
  apiToDbMapping: Record<string, string>; // apiParam/field -> dbColumn
  commonVerificationRules: string[];
  untrustedFields: Array<{ field: string; reason: string }>;
  credibility: KnowledgeCredibility;
  unknownDetails: string[];
}

export const PANQU_ORACLE_KNOWLEDGE: Record<string, OracleKnowledge> = {
  AI_TASKS: {
    businessObject: 'Task',
    table: 'ai_tasks',
    keyFields: ['id'],
    fields: {
      id: { name: 'id', type: 'int', meaning: '自增主键，对应业务 task_id', credibility: 'CONFIRMED' },
      project_id: { name: 'project_id', type: 'int', meaning: '归属项目 ID', credibility: 'CONFIRMED' },
      type: { name: 'type', type: 'int', meaning: '任务类型 (如 6=视频, 105=新视频模型)', credibility: 'CONFIRMED' },
      task_status: {
        name: 'task_status',
        type: 'tinyint',
        meaning: '任务生命周期状态',
        isStatusField: true,
        credibility: 'CONFIRMED',
      },
      progress: { name: 'progress', type: 'int', meaning: '执行百分比进度 (0~100)', credibility: 'CONFIRMED' },
      video_url: { name: 'video_url', type: 'varchar', meaning: '视频产物直链', credibility: 'CONFIRMED' },
      pic_url: { name: 'pic_url', type: 'varchar', meaning: '图片产物直链', credibility: 'CONFIRMED' },
      extra: {
        name: 'extra',
        type: 'text',
        meaning: '任务参数扩展 JSON，包含分流标记 diversion 等',
        credibility: 'OBSERVED',
      },
      err: { name: 'err', type: 'text', meaning: '失败错误描述', credibility: 'CONFIRMED' },
      createtime: { name: 'createtime', type: 'int', meaning: '创建时间戳', credibility: 'CONFIRMED' },
    },
    statusField: {
      name: 'task_status',
      meanings: {
        1: '排队/处理中 (Queued/Processing)',
        2: '成功完成 (Success)',
        3: '业务失败 (Failed)',
        4: '异常故障 (Error)',
      },
      credibility: 'CONFIRMED',
    },
    apiToDbMapping: {
      'row[name]': 'name',
      'row[selmodelsId]': 'selmodels_id',
      'row[type]': 'type',
      project_id: 'project_id',
      videoUrl: 'video_url',
      imageUrl: 'pic_url',
    },
    commonVerificationRules: [
      'task_status=2 时，video_url 或 pic_url 字段必须为非空有效链接',
      'task_status=3 或 4 时，err 字段必须有明确错误原因记录',
      '分流场景下 extra 字段中必须包含明确的 diversion 线路信息',
    ],
    untrustedFields: [
      {
        field: 'extra',
        reason:
          '主站 HTTP 查询 API 不直接暴露 extra 字段，若未获授权执行只读 DB 查询，必须标记为 MANUAL_DB_EVIDENCE_REQUIRED',
      },
    ],
    credibility: 'CONFIRMED',
    unknownDetails: ['ai_tasks 分库分表规则目前 UNKNOWN', '底层 Go Consumer 内部心跳更新字段目前 UNKNOWN'],
  },
  PQ_SCORE_LOG: {
    businessObject: 'BillingLedger',
    table: 'pq_score_log',
    keyFields: ['id'],
    fields: {
      id: { name: 'id', type: 'int', meaning: '流水记录唯一自增 ID', credibility: 'CONFIRMED' },
      user_id: { name: 'user_id', type: 'int', meaning: '发生扣费的用户 ID', credibility: 'CONFIRMED' },
      task_id: { name: 'task_id', type: 'int', meaning: '关联的任务 ID', credibility: 'CONFIRMED' },
      type: {
        name: 'type',
        type: 'tinyint',
        meaning: '变动类型: 2=扣费/预扣, 1=充值/退款',
        isStatusField: true,
        credibility: 'CONFIRMED',
      },
      score: { name: 'score', type: 'int', meaning: '积分变动量', credibility: 'CONFIRMED' },
      memo: { name: 'memo', type: 'varchar', meaning: '流水备注 (包含模型名、任务ID等)', credibility: 'CONFIRMED' },
      createtime: { name: 'createtime', type: 'int', meaning: '记录生成时间戳', credibility: 'CONFIRMED' },
    },
    statusField: {
      name: 'type',
      meanings: {
        1: '增加/退款/充值 (Refund / Credit)',
        2: '扣减/预扣 (Deduction / Debit)',
      },
      credibility: 'CONFIRMED',
    },
    apiToDbMapping: {
      taskId: 'task_id',
      points: 'score',
    },
    commonVerificationRules: [
      '同一 task_id 对应的 type=2 记录必须只有 1 笔 (防重复扣费)',
      '失败任务 (task_status=3) 必须且只能有 1 笔 type=1 的等额退款 (失败净扣归零)',
      '成功任务严禁出现退款流水 (退款幂等核销)',
    ],
    untrustedFields: [
      { field: 'memo', reason: 'memo 仅作为 task_id 缺失时的辅助字符串比对依据，不可单凭模糊包含确认真实归属' },
    ],
    credibility: 'CONFIRMED',
    unknownDetails: ['pq_score_log_archive 分表物理归档的具体时间与迁移规则目前 UNKNOWN'],
  },
  PQ_MEDIA_ASSET: {
    businessObject: 'MediaAsset',
    table: 'pq_media_asset',
    keyFields: ['id'],
    fields: {
      id: { name: 'id', type: 'int', meaning: '资产唯一 ID', credibility: 'CONFIRMED' },
      project_id: { name: 'project_id', type: 'int', meaning: '归属项目 ID', credibility: 'CONFIRMED' },
      folder_id: { name: 'folder_id', type: 'int', meaning: '归属文件夹 ID', credibility: 'CONFIRMED' },
      task_id: { name: 'task_id', type: 'int', meaning: '产生产物的 Task ID', credibility: 'CONFIRMED' },
      url: { name: 'url', type: 'varchar', meaning: '素材物理访问 URL', credibility: 'CONFIRMED' },
      file_size: { name: 'file_size', type: 'bigint', meaning: '文件字节大小', credibility: 'CONFIRMED' },
    },
    apiToDbMapping: {
      taskId: 'task_id',
      projectId: 'project_id',
      folderId: 'folder_id',
    },
    commonVerificationRules: [
      '成功任务生成的素材记录，其 project_id 必须与任务 project_id 严格一致',
      '素材的 task_id 必须与真实执行的 task_id 对应，不得悬挂孤儿素材',
    ],
    untrustedFields: [],
    credibility: 'CONFIRMED',
    unknownDetails: ['素材软删除与回收站机制目前 UNKNOWN', '底层对象存储 Bucket 跨区同步延迟目前 UNKNOWN'],
  },
};

// ============================================================================
// 5. Task 领域知识 (Task Knowledge)
// ============================================================================

export interface TaskLifecycleStep {
  status: number;
  name: string;
  isTerminal: boolean;
  isSuccess: boolean;
  description: string;
}

export interface TaskKnowledge {
  id: string;
  name: string;
  taskType: string;
  numericType: number;
  creationApi: string;
  parameters: string[];
  lifecycle: TaskLifecycleStep[];
  relations: {
    project: { required: boolean; field: string; meaning: string };
    media: { outputField: string; format: string };
    folder?: { field?: string; meaning?: string; dependencyNote?: string };
  };
  finalResultExpectation: {
    requiredFields: string[];
    credibility: KnowledgeCredibility;
  };
  differenceFromApiResponse: string;
  businessSuccessCriteria: string[];
  credibility: KnowledgeCredibility;
}

export const PANQU_TASK_KNOWLEDGE: Record<string, TaskKnowledge> = {
  VIDEO_TASK: {
    id: 'task_video_gen',
    name: '视频生成任务 (Video Generation Task)',
    taskType: 'VIDEO_GEN',
    numericType: 6,
    creationApi: '/aivideo/v2/generate/video',
    parameters: [
      'project_id',
      'row[name]',
      'row[selmodelsId]',
      'row[extra][cueword]',
      'row[extra][duration]',
      'row[extra][video_resolution]',
    ],
    lifecycle: [
      {
        status: 1,
        name: 'QUEUED_OR_PROCESSING',
        isTerminal: false,
        isSuccess: false,
        description: '任务排队中或正在渲染中',
      },
      { status: 2, name: 'SUCCESS', isTerminal: true, isSuccess: true, description: '任务渲染完成且产物就绪' },
      { status: 3, name: 'FAILED', isTerminal: true, isSuccess: false, description: '上游模型调用失败或生成异常' },
      { status: 4, name: 'ERROR', isTerminal: true, isSuccess: false, description: '底层服务故障或超时' },
    ],
    relations: {
      project: { required: true, field: 'project_id', meaning: '必须关联现有项目，决定产物归属' },
      media: { outputField: 'video_url', format: 'mp4' },
      folder: {
        field: 'folder_id',
        meaning: '可选归档目录',
        dependencyNote: '若指定 folder_id，必须确认其属于该 project_id',
      },
    },
    finalResultExpectation: {
      requiredFields: ['video_url', 'progress'],
      credibility: 'CONFIRMED',
    },
    differenceFromApiResponse:
      '【核心差异】：API 提交响应 code=1 仅表明主站成功写入任务表并发送队列消息（Technical Acceptance）。' +
      '真正的异步处理需要经过 Go Consumer 派发模型提供商、等待推流渲染并写入 OSS。' +
      '若提供商返回限流、提示词违规或超时，Task 状态将由 1 变为 3 (Failed)，而此过程对初始提交 API 响应完全透明。',
    businessSuccessCriteria: [
      '1. 提交 API 返回 code=1 且获取到有效 task_id',
      '2. 轮询 Task 终态确认为 2 (SUCCESS) 且 progress=100',
      '3. Task 产生合法的 video_url，且物理检验通过 (MP4 Box: ftyp, moov, mdat 完整，具备可解码性)',
      '4. 账务流水完成对账：防重复扣费 PASS，扣除额与刊例预期一致',
      '5. 业务产物有效归属于提交时指定的 project_id',
    ],
    credibility: 'CONFIRMED',
  },
  IMAGE_TASK: {
    id: 'task_image_gen',
    name: '生图任务 (Image Generation Task)',
    taskType: 'IMAGE_GEN',
    numericType: 2,
    creationApi: '/aivideo/goods/add',
    parameters: [
      'project_id (GET)',
      'row[name]',
      'row[extra][selmodels]',
      'row[extra][cueword]',
      'row[extra][resolution]',
      'row[extra][serviceline]',
      'row[extra][size_type]',
    ],
    lifecycle: [
      { status: 1, name: 'QUEUED_OR_PROCESSING', isTerminal: false, isSuccess: false, description: '生图渲染排队' },
      { status: 2, name: 'SUCCESS', isTerminal: true, isSuccess: true, description: '生图完成' },
      { status: 3, name: 'FAILED', isTerminal: true, isSuccess: false, description: '生图失败' },
      { status: 4, name: 'ERROR', isTerminal: true, isSuccess: false, description: '系统异常' },
    ],
    relations: {
      project: { required: true, field: 'project_id', meaning: '所属项目' },
      media: { outputField: 'pic_url', format: 'png/jpg' },
    },
    finalResultExpectation: {
      requiredFields: ['pic_url', 'progress'],
      credibility: 'CONFIRMED',
    },
    differenceFromApiResponse: 'API 成功仅代表入库排队；若模型服务下线或尺寸不支持，Task 终态会变为 3/4。',
    businessSuccessCriteria: [
      '1. 提交 API 返回 code=1',
      '2. Task 终态为 2 (SUCCESS)',
      '3. 产物图片物理存在，PNG IHDR / JPG 格式完整可解析',
      '4. 积分扣除与分辨率单价一致',
    ],
    credibility: 'CONFIRMED',
  },
};

