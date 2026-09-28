/**
 * Panqu AI DevTest 企业领域认知层 (Company Domain Knowledge) — 聚合入口 (Barrel)
 *
 * 【架构说明 · ARCHITECTURE_FREEZE 治理下的物理拆分】
 * 原单文件 (2094 行) 已按职责物理拆分为 4 个模块，本文件降级为纯 re-export 聚合入口。
 * 对外公共导出面（index.ts 及所有 `from './domain-knowledge.js'` 的消费方）保持字节级不变、零破坏：
 *   - domain-knowledge-base.ts  : 知识可信度边界 + 业务实体 / API / Oracle / Task 静态知识表
 *   - domain-experience.ts      : 经验 / 失败模式定义与匹配 + 领域上下文解析 + 执行计划构建
 *   - knowledge-sync.ts         : Memory Candidate 记录 / 最小晋升机制 / 远端知识 JSON 合并
 *   - business-verification.ts  : 业务级验真评估器 (verify 活体裁决链关键函数)
 *
 * 核心设计目标（原文保留）：
 * 1. 让 DevTest 真正理解公司业务系统（业务对象、API、Oracle、Task、参数、状态、对象关系、验证规则）。
 * 2. 严格的四级知识可信度边界（CONFIRMED / OBSERVED / INFERRED / UNKNOWN），杜绝幻觉编造。
 * 3. 支撑四大核心流程：probe / plan / execute / verify。
 * 4. 沉淀已确认测试经验 (Experience) 与失败模式 (Failure Pattern)。
 */

export * from './domain-knowledge-base.js';
export * from './domain-experience.js';
export * from './knowledge-sync.js';
export * from './business-verification.js';
