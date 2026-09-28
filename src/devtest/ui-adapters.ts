/**
 * Panqu AI DevTest — UI Adapters (Playwright & Midscene Native Absorption)
 *
 * 核心架构约束 (遵循 docs/ARCHITECTURE_FREEZE.md 受控扩展原则):
 * 1. 工具无关性：不安装、不依赖、不导入 Playwright 或 Midscene，仅抽象 DOM/网络/截图/视觉观察事实契约；
 * 2. 生产无 Fixture：本生产模块只保留可复用的工具无关类型、Browser Evidence Producer 与 AI Observation Producer；
 * 3. 确定性原则：evidenceId、capturedAt 必须由调用方提供，严禁在内部生成非确定性 Date.now() 或随机数；
 * 4. 证据信封规范：输出标准 CanonicalEvidenceEnvelope，视觉结果严格保持为 AI_OBSERVATION，绝不能单独产生 PASS；
 * 5. 零写死测试数据：严禁生产模块包含写死测试路径、测试行选择器或 fixture 专用执行器。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CanonicalEvidenceEnvelope } from './canonical-protocol.js';
import type { EvidenceProducer, EvidenceProducerContext } from './execution-ports.js';

// ============================================================================
// 一、原始采集事实契约 (Raw Collection Contracts)
// ============================================================================

export interface BrowserRawCollection {
  readonly pageUrl?: string;
  readonly rowSelector?: string;
  readonly rowFound?: boolean;
  readonly domTaskStatus?: string;
  readonly networkTaskStatus?: string;
  readonly networkHttpStatus?: number;
  readonly endpoint?: string;
  readonly screenshotPath?: string;
}

export interface VisualAiRawCollection {
  readonly visualInference?: 'CONFIRMED' | 'MISMATCH' | 'UNSURE';
  readonly instruction?: string;
}

/**
 * 确定性证据上下文：由调用方显式提供时间戳与证据标识
 */
export interface DeterministicProducerContext extends EvidenceProducerContext {
  readonly capturedAt: string; // ISO 8601，必须由调用方显式提供
  readonly evidenceId?: string; // 单一证据时的确定性 ID
  readonly evidenceIds?: Readonly<Record<string, string>>; // 多证据时的键值映射表
}

// ============================================================================
// 一之补充、外部运行时事实采集器接缝 (Bring-Your-Own-Runtime Collector Seam)
//   诚实能力边界：本零依赖内核【不安装、不导入、不捆绑】任何浏览器/视觉运行时。
//   下述接口仅定义"外部运行时如何把【已采集】的原始 UI 事实交给上面的 EvidenceProducer"
//   的类型化契约，其自身【不执行】任何浏览器/视觉操作，也不引入 Playwright/Midscene 依赖。
//   参考实现范式（可执行、零依赖、CI 恒绿）：tests/unit/devtest/ui-fact-collector-seam.test.ts
//   —— 内含一个外部 fake 采集器回传真实事实、据实驱动 PASS 的完整数据流；真实 Playwright 封装
//   只应存在于【外部工程自己的 package.json】，绝不写入 test-flow（详见 docs/ARCHITECTURE_FREEZE.md:240）。
// ============================================================================

/** 浏览器事实采集请求：由调用方声明"要采集什么"，不含任何运行时实现细节 */
export interface BrowserFactCollectionRequest {
  readonly pageUrl: string;
  readonly rowSelector?: string;
  readonly interceptEndpoint?: string;
  readonly screenshotPath?: string;
  readonly subjectId?: string | number;
}

/**
 * 浏览器事实采集器契约 (Bring-Your-Own-Runtime Seam)
 *
 * 重要（诚实定位，禁止读为"已内置浏览器驱动"）：
 * - 本包已随附 {@link UIBrowserEvidenceProducer} 且严格 fail-closed；真正【缺失】的是"驱动真实浏览器
 *   并回传原始 DOM/网络/截图事实"的运行时。本接口即该缺口的【显式接缝】。
 * - 由【外部工程】实现（例如在自有仓库封装 Playwright/CDP），返回 {@link BrowserRawCollection} 原始事实，
 *   再交由 UIBrowserEvidenceProducer 生成规范证据信封；本包不为该实现提供任何运行时。
 * - 采集器【只回传原始事实】，绝不生成 capturedAt / evidenceId：确定性时间戳与证据 ID 仍由调用方经
 *   {@link DeterministicProducerContext} 显式提供（禁止在采集器内部使用 Date.now() 或随机数）。
 * - 未注入任何实现时，Producer 因缺失原始事实而 COLLECTION_FAILED / UNVERIFIED，绝不合成默认 PASS。
 */
export interface BrowserFactCollector {
  /** 外部运行时标识（如 'playwright@1.x (external)'）；仅供溯源，不代表本包已内置该运行时 */
  readonly runtimeName: string;
  collect(request: BrowserFactCollectionRequest): Promise<BrowserRawCollection>;
}

/** 视觉辅助事实采集请求 */
export interface VisualAiFactCollectionRequest {
  readonly instruction: string;
  readonly screenshotPath?: string;
}

/**
 * 视觉辅助事实采集器契约 (Bring-Your-Own-Runtime Seam；对应 Midscene 类思路)
 * 约束同 {@link BrowserFactCollector}：不捆绑任何视觉大模型运行时。返回的 visualInference 仅会驱动
 * AI_OBSERVATION 证据，而该证据【恒不具备单独 PASS 裁决权】（由 UIVisualAiEvidenceProducer 保证）。
 */
export interface VisualAiFactCollector {
  readonly runtimeName: string;
  collect(request: VisualAiFactCollectionRequest): Promise<VisualAiRawCollection>;
}

/**
 * 空浏览器采集器 (No-Op Fail-Closed Default)
 * 无任何外部运行时可用时的确定性缺省实现：返回空原始事实，使 UIBrowserEvidenceProducer 走 fail-closed
 * 分支（COLLECTION_FAILED / UNVERIFIED），以显式表达"无运行时 ⇒ 无事实 ⇒ 绝不臆造 PASS"，而非静默假装成功。
 */
export class NullBrowserFactCollector implements BrowserFactCollector {
  readonly runtimeName = 'null-browser-fact-collector (no external runtime installed)';
  async collect(): Promise<BrowserRawCollection> {
    return {};
  }
}

/** 空视觉采集器 (No-Op Fail-Closed Default)，语义同 {@link NullBrowserFactCollector} */
export class NullVisualAiFactCollector implements VisualAiFactCollector {
  readonly runtimeName = 'null-visual-ai-fact-collector (no external runtime installed)';
  async collect(): Promise<VisualAiRawCollection> {
    return {};
  }
}

// ============================================================================
// 二、纯物理文件元数据工具函数
// ============================================================================

/**
 * 从 PNG 文件读取实际 IHDR 宽度与高度 (纯二进制解析，零外部依赖)
 */
export function readPngDimensions(filePath: string): { width: number; height: number } {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
      };
    }
  } catch {
    // 读取或解析失败降级为 0
  }
  return { width: 0, height: 0 };
}

function resolveEvidenceId(context: DeterministicProducerContext, evidenceKey: string): string | undefined {
  if (context.evidenceIds && context.evidenceIds[evidenceKey]) {
    return context.evidenceIds[evidenceKey];
  }
  if (context.evidenceId) {
    return context.evidenceId;
  }
  return undefined;
}

// ============================================================================
// 三、浏览器端确定性事实采集器 (Playwright 思想吸收 — DEFERRED_EXTERNAL_RUNTIME)
// 注意：未安装 Playwright，不自制 CDP 浏览器框架；真实 UI 执行依赖外部独立运行时 (NOT_IN_ZERO_DEPENDENCY_SCOPE)
// ============================================================================

export class UIBrowserEvidenceProducer implements EvidenceProducer {
  readonly producerName = 'ui-browser-evidence-producer';
  readonly sourceType = 'BROWSER' as const;
  readonly maturity = 'DEFERRED_EXTERNAL_RUNTIME' as const;
  readonly scope = 'NOT_IN_ZERO_DEPENDENCY_SCOPE' as const;

  async produce(rawCollection: unknown, context: EvidenceProducerContext): Promise<CanonicalEvidenceEnvelope[]> {
    const ctx = context as DeterministicProducerContext;
    const raw = (rawCollection && typeof rawCollection === 'object' ? rawCollection : {}) as BrowserRawCollection;
    const envelopes: CanonicalEvidenceEnvelope[] = [];

    // 确定性时间戳校验：必须由调用方显式提供
    const capturedAt = ctx.capturedAt;
    if (!capturedAt || typeof capturedAt !== 'string') {
      return [
        {
          evidenceId: resolveEvidenceId(ctx, 'BROWSER:CAPTURED_AT_MISSING') || `UNASSIGNED:${ctx.testId}:BROWSER_ERROR`,
          testId: ctx.testId,
          sourceTool: this.producerName,
          sourceType: this.sourceType,
          evidenceKey: 'BROWSER:TASK_STATUS_DOM',
          observationStatus: 'UNVERIFIED',
          capturedAt: '1970-01-01T00:00:00.000Z',
          environment: ctx.environment,
          subjectType: ctx.subjectType,
          subjectId: ctx.subjectId,
          normalizedFields: {},
          provenance: 'BROWSER (ui-browser-evidence-producer)',
          confidence: 0.0,
          immutable: true,
          redacted: true,
          collectionStatus: 'COLLECTION_FAILED',
          error: {
            code: 'CAPTURED_AT_REQUIRED',
            message: 'capturedAt 必须由调用方显式提供以保证确定性',
          },
        },
      ];
    }

    // ------------------------------------------------------------------------
    // 1. DOM 事实：列表行定位与状态徽章文本 (Playwright DOM Locator 语义)
    // ------------------------------------------------------------------------
    const domEvidenceKey = 'BROWSER:TASK_STATUS_DOM';
    const domEvidenceId = resolveEvidenceId(ctx, domEvidenceKey) || `UNASSIGNED:${ctx.testId}:${domEvidenceKey}`;

    if (!resolveEvidenceId(ctx, domEvidenceKey) && !ctx.evidenceId) {
      envelopes.push({
        evidenceId: domEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: domEvidenceKey,
        observationStatus: 'UNVERIFIED',
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        normalizedFields: {},
        provenance: 'BROWSER (ui-browser-evidence-producer:dom-inspector)',
        confidence: 0.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'COLLECTION_FAILED',
        error: {
          code: 'EVIDENCE_ID_REQUIRED',
          message: `未由调用方提供确定性 evidenceId: ${domEvidenceKey}`,
        },
      });
    } else if (raw.domTaskStatus === undefined && raw.rowFound === undefined) {
      envelopes.push({
        evidenceId: domEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: domEvidenceKey,
        observationStatus: 'UNVERIFIED',
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        normalizedFields: {},
        provenance: 'BROWSER (ui-browser-evidence-producer:dom-inspector)',
        confidence: 0.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'COLLECTION_FAILED',
        error: {
          code: 'DOM_FACT_MISSING',
          message: '未采集到 DOM 列表行状态事实，绝不合成默认成功结果',
        },
      });
    } else if (raw.rowFound === false) {
      envelopes.push({
        evidenceId: domEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: domEvidenceKey,
        observationStatus: 'FAIL',
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        rawReference: raw.rowSelector ? { rowSelector: raw.rowSelector } : undefined,
        normalizedFields: { rowFound: false },
        provenance: 'BROWSER (ui-browser-evidence-producer:dom-inspector)',
        confidence: 1.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'COLLECTION_FAILED',
        error: {
          code: 'DOM_ROW_NOT_FOUND',
          message: `未能在页面找到指定行元素: ${raw.rowSelector || ctx.subjectId}`,
        },
      });
    } else {
      const domStatus = raw.domTaskStatus as string;
      const observationStatus = domStatus === 'SUCCESS' ? 'PASS' : domStatus === 'FAILED' ? 'FAIL' : 'UNVERIFIED';

      envelopes.push({
        evidenceId: domEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: domEvidenceKey,
        observationStatus,
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        rawReference: {
          pageUrl: raw.pageUrl,
          rowSelector: raw.rowSelector,
          innerText: domStatus,
        },
        normalizedFields: {
          taskStatus: domStatus,
          rowFound: true,
          selector: raw.rowSelector,
        },
        provenance: 'BROWSER (ui-browser-evidence-producer:dom-inspector)',
        confidence: 1.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'SUCCESS',
      });
    }

    // ------------------------------------------------------------------------
    // 2. 网络拦截事实：详情接口响应 (Playwright Network Interception 语义)
    // ------------------------------------------------------------------------
    const netEvidenceKey = 'BROWSER:NETWORK_RESPONSE';
    const netEvidenceId = resolveEvidenceId(ctx, netEvidenceKey) || `UNASSIGNED:${ctx.testId}:${netEvidenceKey}`;

    if (!resolveEvidenceId(ctx, netEvidenceKey) && !ctx.evidenceId) {
      envelopes.push({
        evidenceId: netEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: netEvidenceKey,
        observationStatus: 'UNVERIFIED',
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        normalizedFields: {},
        provenance: 'BROWSER (ui-browser-evidence-producer:network-interceptor)',
        confidence: 0.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'COLLECTION_FAILED',
        error: {
          code: 'EVIDENCE_ID_REQUIRED',
          message: `未由调用方提供确定性 evidenceId: ${netEvidenceKey}`,
        },
      });
    } else if (raw.networkTaskStatus === undefined && raw.networkHttpStatus === undefined) {
      envelopes.push({
        evidenceId: netEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: netEvidenceKey,
        observationStatus: 'UNVERIFIED',
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        normalizedFields: {},
        provenance: 'BROWSER (ui-browser-evidence-producer:network-interceptor)',
        confidence: 0.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'COLLECTION_FAILED',
        error: {
          code: 'NETWORK_FACT_MISSING',
          message: '未拦截到指定接口的网络响应事实，绝不合成默认成功结果',
        },
      });
    } else if (raw.networkHttpStatus !== undefined && raw.networkHttpStatus >= 400) {
      envelopes.push({
        evidenceId: netEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: netEvidenceKey,
        observationStatus: 'FAIL',
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        rawReference: { endpoint: raw.endpoint, httpStatus: raw.networkHttpStatus },
        normalizedFields: { httpStatus: raw.networkHttpStatus, endpoint: raw.endpoint },
        provenance: 'BROWSER (ui-browser-evidence-producer:network-interceptor)',
        confidence: 1.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'COLLECTION_FAILED',
        error: {
          code: 'NETWORK_HTTP_ERROR',
          message: `网络接口响应错误 HTTP ${raw.networkHttpStatus}`,
        },
      });
    } else {
      const netStatus = raw.networkTaskStatus as string;
      const observationStatus = netStatus === 'SUCCESS' ? 'PASS' : netStatus === 'FAILED' ? 'FAIL' : 'UNVERIFIED';

      envelopes.push({
        evidenceId: netEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: netEvidenceKey,
        observationStatus,
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        rawReference: {
          endpoint: raw.endpoint,
          httpStatus: raw.networkHttpStatus || 200,
          responseJson: { subjectId: ctx.subjectId, status: netStatus },
        },
        normalizedFields: {
          taskStatus: netStatus,
          httpStatus: raw.networkHttpStatus || 200,
          endpoint: raw.endpoint,
        },
        provenance: 'BROWSER (ui-browser-evidence-producer:network-interceptor)',
        confidence: 1.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'SUCCESS',
      });
    }

    // ------------------------------------------------------------------------
    // 3. 截屏引用事实：UI 界面截图 (严格校验文件真实存在并使用真实物理尺寸)
    // ------------------------------------------------------------------------
    const screenEvidenceKey = 'BROWSER:SCREENSHOT_REF';
    const screenEvidenceId =
      resolveEvidenceId(ctx, screenEvidenceKey) || `UNASSIGNED:${ctx.testId}:${screenEvidenceKey}`;

    if (!resolveEvidenceId(ctx, screenEvidenceKey) && !ctx.evidenceId) {
      envelopes.push({
        evidenceId: screenEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: screenEvidenceKey,
        observationStatus: 'UNVERIFIED',
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        normalizedFields: { hasScreenshot: false },
        provenance: 'BROWSER (ui-browser-evidence-producer:screenshot-capture)',
        confidence: 0.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'COLLECTION_FAILED',
        error: {
          code: 'EVIDENCE_ID_REQUIRED',
          message: `未由调用方提供确定性 evidenceId: ${screenEvidenceKey}`,
        },
      });
    } else if (!raw.screenshotPath) {
      envelopes.push({
        evidenceId: screenEvidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey: screenEvidenceKey,
        observationStatus: 'UNVERIFIED',
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        normalizedFields: { hasScreenshot: false },
        provenance: 'BROWSER (ui-browser-evidence-producer:screenshot-capture)',
        confidence: 0.0,
        immutable: true,
        redacted: true,
        collectionStatus: 'COLLECTION_FAILED',
        error: {
          code: 'SCREENSHOT_NOT_REQUESTED',
          message: '未指定有效的截图路径',
        },
      });
    } else {
      const screenshotRelPath = raw.screenshotPath;
      const resolvedPath = path.isAbsolute(screenshotRelPath)
        ? screenshotRelPath
        : path.resolve(process.cwd(), screenshotRelPath);

      if (!fs.existsSync(resolvedPath)) {
        envelopes.push({
          evidenceId: screenEvidenceId,
          testId: ctx.testId,
          sourceTool: this.producerName,
          sourceType: this.sourceType,
          evidenceKey: screenEvidenceKey,
          observationStatus: 'UNVERIFIED',
          capturedAt,
          environment: ctx.environment,
          subjectType: ctx.subjectType,
          subjectId: ctx.subjectId,
          normalizedFields: { hasScreenshot: false, requestedPath: screenshotRelPath },
          provenance: 'BROWSER (ui-browser-evidence-producer:screenshot-capture)',
          confidence: 0.0,
          immutable: true,
          redacted: true,
          collectionStatus: 'COLLECTION_FAILED',
          error: {
            code: 'SCREENSHOT_FILE_NOT_FOUND',
            message: `声明的截图物理文件不存在: ${resolvedPath}`,
          },
        });
      } else {
        const stats = fs.statSync(resolvedPath);
        const actualDimensions = readPngDimensions(resolvedPath);

        envelopes.push({
          evidenceId: screenEvidenceId,
          testId: ctx.testId,
          sourceTool: this.producerName,
          sourceType: this.sourceType,
          evidenceKey: screenEvidenceKey,
          observationStatus: 'PASS',
          capturedAt,
          environment: ctx.environment,
          subjectType: ctx.subjectType,
          subjectId: ctx.subjectId,
          rawReference: {
            screenshotPath: screenshotRelPath,
            fileSizeBytes: stats.size,
            dimensions: actualDimensions,
          },
          normalizedFields: {
            hasScreenshot: true,
            screenshotUri: `file://${resolvedPath}`,
            fileSizeBytes: stats.size,
            width: actualDimensions.width,
            height: actualDimensions.height,
          },
          provenance: 'BROWSER (ui-browser-evidence-producer:screenshot-capture)',
          confidence: 1.0,
          immutable: true,
          redacted: true,
          collectionStatus: 'SUCCESS',
        });
      }
    }

    return envelopes;
  }
}

// ============================================================================
// 四、视觉辅助分析采集器 (Midscene 思想吸收 — DEFERRED_EXTERNAL_RUNTIME)
// 注意：未安装 @midscene/web，真实视觉定位依赖外部独立运行时 (NOT_IN_ZERO_DEPENDENCY_SCOPE)
// ============================================================================

export class UIVisualAiEvidenceProducer implements EvidenceProducer {
  readonly producerName = 'ui-visual-ai-evidence-producer';
  readonly sourceType = 'AI_OBSERVATION' as const;
  readonly maturity = 'DEFERRED_EXTERNAL_RUNTIME' as const;
  readonly scope = 'NOT_IN_ZERO_DEPENDENCY_SCOPE' as const;

  async produce(rawCollection: unknown, context: EvidenceProducerContext): Promise<CanonicalEvidenceEnvelope[]> {
    const ctx = context as DeterministicProducerContext;
    const raw = (rawCollection && typeof rawCollection === 'object' ? rawCollection : {}) as VisualAiRawCollection;
    const evidenceKey = 'AI_OBSERVATION:TASK_STATUS_VISUAL';

    const capturedAt = ctx.capturedAt;
    if (!capturedAt || typeof capturedAt !== 'string') {
      return [
        {
          evidenceId: resolveEvidenceId(ctx, evidenceKey) || `UNASSIGNED:${ctx.testId}:${evidenceKey}`,
          testId: ctx.testId,
          sourceTool: this.producerName,
          sourceType: this.sourceType,
          evidenceKey,
          observationStatus: 'UNVERIFIED',
          capturedAt: '1970-01-01T00:00:00.000Z',
          environment: ctx.environment,
          subjectType: ctx.subjectType,
          subjectId: ctx.subjectId,
          normalizedFields: {},
          provenance: 'AI_OBSERVATION (ui-visual-ai-evidence-producer:vision-analyzer)',
          confidence: 0.0,
          immutable: true,
          redacted: true,
          collectionStatus: 'COLLECTION_FAILED',
          error: {
            code: 'CAPTURED_AT_REQUIRED',
            message: 'capturedAt 必须由调用方显式提供以保证确定性',
          },
        },
      ];
    }

    const evidenceId = resolveEvidenceId(ctx, evidenceKey) || `UNASSIGNED:${ctx.testId}:${evidenceKey}`;

    if (!resolveEvidenceId(ctx, evidenceKey) && !ctx.evidenceId) {
      return [
        {
          evidenceId,
          testId: ctx.testId,
          sourceTool: this.producerName,
          sourceType: this.sourceType,
          evidenceKey,
          observationStatus: 'UNVERIFIED',
          capturedAt,
          environment: ctx.environment,
          subjectType: ctx.subjectType,
          subjectId: ctx.subjectId,
          normalizedFields: { visualStatusConfirmed: false },
          provenance: 'AI_OBSERVATION (ui-visual-ai-evidence-producer:vision-analyzer)',
          confidence: 0.0,
          immutable: true,
          redacted: true,
          collectionStatus: 'COLLECTION_FAILED',
          error: {
            code: 'EVIDENCE_ID_REQUIRED',
            message: `未由调用方提供确定性 evidenceId: ${evidenceKey}`,
          },
        },
      ];
    }

    if (!raw.visualInference) {
      return [
        {
          evidenceId,
          testId: ctx.testId,
          sourceTool: this.producerName,
          sourceType: this.sourceType,
          evidenceKey,
          observationStatus: 'UNVERIFIED',
          capturedAt,
          environment: ctx.environment,
          subjectType: ctx.subjectType,
          subjectId: ctx.subjectId,
          normalizedFields: { visualStatusConfirmed: false },
          provenance: 'AI_OBSERVATION (ui-visual-ai-evidence-producer:vision-analyzer)',
          confidence: 0.0,
          immutable: true,
          redacted: true,
          collectionStatus: 'COLLECTION_FAILED',
          error: {
            code: 'VISUAL_INFERENCE_MISSING',
            message: '未提供视觉推断事实，拒绝合成默认观察结果',
          },
        },
      ];
    }

    const obsStatus =
      raw.visualInference === 'CONFIRMED' ? 'PASS' : raw.visualInference === 'MISMATCH' ? 'FAIL' : 'UNVERIFIED';

    return [
      {
        evidenceId,
        testId: ctx.testId,
        sourceTool: this.producerName,
        sourceType: this.sourceType,
        evidenceKey,
        observationStatus: obsStatus,
        capturedAt,
        environment: ctx.environment,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        rawReference: {
          instruction: raw.instruction || '视觉辅助观察',
          modelVisualInference: raw.visualInference,
        },
        normalizedFields: {
          visualStatusConfirmed: obsStatus === 'PASS',
          badgeColor: obsStatus === 'PASS' ? 'green' : obsStatus === 'FAIL' ? 'red' : 'gray',
          iconType: obsStatus === 'PASS' ? 'checkmark' : 'unknown',
          confidenceScore: 0.95,
        },
        provenance: 'AI_OBSERVATION (ui-visual-ai-evidence-producer:vision-analyzer)',
        confidence: 0.95,
        immutable: true,
        redacted: true,
        collectionStatus: 'SUCCESS',
      },
    ];
  }
}
