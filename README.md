<div align="center">

# 🛡️ Panqu AI DevTest

**面向 Panqu AI 图片 / 视频生成链路的测试工程副驾 —— 意图编排、物理证据验真、零假 PASS 确定性验收门禁**

[![Version](https://img.shields.io/badge/version-6.0.0-blue.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-51%20suites%20%7C%20906%20passed%20(100%25)-brightgreen.svg)](tests/unit/devtest)
[![Coverage](https://img.shields.io/badge/coverage-87.51%25%20(Lines)%20%7C%2086.51%25%20(Stmts)-brightgreen.svg)](vitest.config.ts)
[![Security Gates](https://img.shields.io/badge/security-5%20automated%20gates-success.svg)](.github/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-orange.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/typescript-%3E%3D5.9-blue.svg)](package.json)
[![Verdict](https://img.shields.io/badge/verdict-Single%20Engine%20(PASS%7CFAIL%7CUNVERIFIED)-purple.svg)](docs/ARCHITECTURE_FREEZE.md)
[![Interface](https://img.shields.io/badge/interface-CLI%20%C2%B7%20any--agent%20%C2%B7%20MCP-informational.svg)](docs/CLI_REFERENCE.md)

</div>

---

## 📖 定位：只测不跑 · 零假 PASS

Panqu AI DevTest 是轻量、纯净、无副作用的测试工程副驾。它负责**测试意图编排、多维物理证据链验真与全链路验收闭环**，**不承载模型训练与推理服务本身**。

> **核心业务原则：代码/需求变更 ➔ 意图编排 ➔ 物理证据与真实对账 ➔ 确定性门禁裁决（零副作用 · 零假 PASS）**

> [!IMPORTANT]
> **全系统唯一裁决权威**：全链路业务裁决统一收敛至 `CanonicalVerdictEngine` 纯三态（`PASS` \| `FAIL` \| `UNVERIFIED`）。任何领域模块、执行适配器、CLI 或 MCP 均无权自制业务通过裁决。

---

## 🏛️ 全景系统架构拓扑 (System Architecture Topology)

系统遵循严格的**单向无环数据流（Unidirectional DAG，运行时环路严格为 0）**，确立了 **“规约驱动（Spec-Driven）➔ 事实收集（Evidence Collection）➔ 唯一裁决（Canonical Verdict）➔ 投影呈现（Projection）”** 的核心管线：

```mermaid
flowchart TD
    %% 全局统一现代极简调色板 (纯净高质感：蓝/灰/绿/紫，零默认黄色)
    classDef specNode fill:#eff6ff,stroke:#3b82f6,stroke-width:1.5px,color:#1e40af
    classDef kernelNode fill:#f5f3ff,stroke:#7c3aed,stroke-width:2px,color:#5b21b6
    classDef adapterNode fill:#faf5ff,stroke:#a855f7,stroke-width:1.5px,color:#6b21a8
    classDef evidenceNode fill:#f0fdf4,stroke:#16a34a,stroke-width:1.5px,color:#15803d
    classDef hubNode fill:#f8fafc,stroke:#334155,stroke-width:2px,color:#0f172a
    classDef engineNode fill:#eff6ff,stroke:#1d4ed8,stroke-width:2.5px,color:#1e3a8a
    classDef gateNode fill:#f8fafc,stroke:#94a3b8,stroke-width:1px,color:#475569
    classDef outNode fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,color:#1e293b
    classDef sinkNode fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46

    %% 阶段一：需求与规约
    REQ["📋 业务需求变更 / Git Diff / 需求意图"] --> TRACE["RequirementTrace<br/>• 变更关联分析 • 纯函数影响域推导"]
    TRACE --> SPEC["📜 CanonicalTestSpec 规约<br/>• 确定性断言 • 预算门禁 • 副作用策略 (默认只读)"]

    %% 阶段二：核心调度中枢
    SPEC ==> KERNEL[["⚙️ core-kernel.ts 统一调度中枢<br/>probe() · plan() · execute() · verify()"]]
    
    KERNEL -->|"探活画像"| ACT_PROBE["🔍 probe() 环境与模型画像发现"]
    KERNEL -->|"分流推导"| ACT_PLAN["🔀 plan() 决策消除歧义与刊例预算"]
    KERNEL -->|"受控派发"| ACT_EXEC["🚀 execute() 受控派发与状态跟踪"]
    KERNEL ==>|"权威验真"| ACT_VERIFY["🛡️ verify() 物理证据汇聚与裁决"]

    %% 阶段三：执行适配与物理取证
    ACT_EXEC --> ADAPT["🔌 PanquMediaExecutionAdapter<br/>API 提交流水 / 严格隔离写副作用"]
    
    ACT_VERIFY --> P_DB["🗄️ DatabaseEvidenceProducer<br/>SSH 跳板机隧道 ➔ MySQL 只读 SELECT 对账"]
    ACT_VERIFY --> P_BILL["💰 BillingLedgerReconciler<br/>预扣/净扣/退款三大金融不变量核算"]
    ACT_VERIFY --> P_MEDIA["🎬 MediaInspector<br/>MP4 moov atom 流式解析 / Range 探测"]
    ACT_VERIFY --> P_DIV["📊 DiversionEligibilityProducer<br/>line=10 分流规则 · 飞书权威渠道表"]
    ACT_VERIFY --> P_UI["🖥️ UI Fact Seam<br/>DOM / 网络 / 视觉辅助 (仅 AI 观察)"]

    %% 阶段四：证据信封汇聚
    ADAPT -.-> ENV
    P_DB & P_BILL & P_MEDIA & P_DIV & P_UI ==> ENV[("📦 CanonicalEvidenceEnvelope Hub<br/>不可变信封 · 来源隔离 · 真实性防伪验签")]

    %% 阶段五：唯一最终裁决
    SPEC ==> ENGINE
    ENV ==> ENGINE{{"⚖️ CanonicalVerdictEngine<br/>全系统唯一最终裁决源: PASS | FAIL | UNVERIFIED"}}

    %% 严密门禁护栏
    ENGINE -.-> G1["门禁①: 1.1 最小规约底线 (空规约必阻断)"]
    ENGINE -.-> G2["门禁②: 关键断言强求值 (断言失败一票否决)"]
    ENGINE -.-> G3["门禁③: 必需证据匹配 (缺物理证据不放行)"]
    ENGINE -.-> G4["门禁④: 来源隔离 (外部声明不得冒充网关事实)"]

    %% 阶段六：呈现与归档
    ENGINE ==>|"只读单向投影"| PROJ["projectCanonicalVerdictToLegacy()"]
    PROJ --> CLI["💻 devtest CLI (终端人读高亮 + JSON 管道)"]
    PROJ --> MCP["🤖 Trae / Cursor MCP (stdio 协议自动化工具)"]
    ENGINE ==>|"只写不读深冻结"| SINK[("💾 ResultSink 结果归档<br/>NDJSON 单向持久化 · 绝不回写状态")]

    %% 样式绑定
    class REQ,TRACE,SPEC specNode
    class KERNEL,ACT_PROBE,ACT_PLAN,ACT_EXEC,ACT_VERIFY kernelNode
    class ADAPT adapterNode
    class P_DB,P_BILL,P_MEDIA,P_DIV,P_UI evidenceNode
    class ENV hubNode
    class ENGINE engineNode
    class G1,G2,G3,G4 gateNode
    class PROJ,CLI,MCP outNode
    class SINK sinkNode
```

---

## 🏗️ 四级架构分层规范 (4-Tier Component Boundaries)

系统代码资产严格受控于 [ARCHITECTURE_FREEZE.md](docs/ARCHITECTURE_FREEZE.md)，划分为四大层级，严禁越权渗透：

| 层级 (Tier) | 代表性组件 | 职责与生命周期 | 依赖与隔离规则 |
|---|---|---|---|
| **Tier 1: 生产调用链核心** | `canonical-protocol.ts`<br>`core-kernel.ts`<br>`canonical-verdict-engine.ts`<br>`database-evidence-producer.ts` | 承载生产环境运行的最小闭环核心；控制规约强校验、任务派发与最终裁决。 | 零外部重量级框架依赖，模块间依赖为严格无环有向图（DAG），不可引入测试桩。 |
| **Tier 2: 可选注入适配器** | `result-sink.ts`<br>`ui-adapters.ts`<br>`agent-evaluation.ts`<br>`exploration/` | 扩展性端口与纯库函数；支持单向导出、UI 契约接缝、提示词评测与自演化状态图。 | 严格遵循“四可隔离原则”（可开关、可替换、可单测、可删除），默认不污染生产调用。 |
| **Tier 3: 测试专用资产** | `TestOfflineExecutionAdapter`<br>`UIFixtureExecutionAdapter`<br>`tests/fixtures/` | 提供离线仿真、单元回归与断言契约校验。 | 严格限制在 `tests/` 目录，绝对禁止导出到 `src/`，严禁生产运行时装载。 |
| **Tier 4: 思想吸纳隔离层** | Playwright / Midscene / Promptfoo / ReportPortal / wardenIQ | 吸收业界先进理念（视觉辅助仅为 AI 观察、深冻结单向导出、Git 变更分析）。 | 坚持**纯轻量契约吸纳**，未安装外部大包（如无 playwright / @midscene 运行时），防架构虚浮膨胀。 |

---

## 🔄 核心数据流与裁决状态机 (Data Flow & Verdict State Machine)

每次验证严格按照以下状态机执行，实现物理级防作弊与 Fail-Closed 判定：

```mermaid
flowchart TD
    %% 全局现代极简调色板 (干净白底与柔和边框，杜绝任何默认黄色)
    classDef startEnd fill:#f8fafc,stroke:#475569,stroke-width:1.5px,color:#0f172a
    classDef gateNode fill:#eff6ff,stroke:#2563eb,stroke-width:2px,color:#1e3a8a
    classDef passNode fill:#f0fdf4,stroke:#16a34a,stroke-width:2px,color:#15803d
    classDef failNode fill:#fef2f2,stroke:#dc2626,stroke-width:2px,color:#b91c1c
    classDef blockNode fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#b45309
    classDef stepNode fill:#ffffff,stroke:#64748b,stroke-width:1.5px,color:#1e293b
    classDef actionNode fill:#f1f5f9,stroke:#94a3b8,stroke-width:1px,color:#334155

    INPUT(["📥 触发输入: 业务任务与执行上下文 (TaskId / Session / Spec)"]) --> C_VALID{"① 规约合法性自检<br/>(Spec Admission Guard)"}

    %% 门禁一：空规格直接阻断
    C_VALID -- "空规约 / 无断言无必需证据" --> R_EMPTY["⚠️ 1.1 最小证据底线阻断<br/>[NO_EVALUABLE_EVIDENCE_SPEC]"] --> V_UNVER

    %% 规约通过，触发物理取证
    C_VALID -- "规约合法" --> HARVEST["② 汇聚多维物理客观证据链 (Physical Evidence Gathering)"]

    HARVEST --> E_DB["🗄️ SSH 隧道 MySQL 只读取证<br/>SELECT pq_aivideo_new & pq_score_log"]
    HARVEST --> E_BIN["🎬 二进制流式 Range 探测<br/>MP4 moov atom 解析 / 容器验真"]
    HARVEST --> E_BILL["💰 账务三大不变量核算<br/>计费扣费与冲正退款流水"]
    HARVEST --> E_DIV["🔀 分流规则与渠道权威匹配<br/>line=10 判定 / 飞书刊例价"]

    E_DB & E_BIN & E_BILL & E_DIV --> C_FILTER{"③ 凭据校验与防伪隔离<br/>(Evidence Integrity Filter)"}

    C_FILTER -- "信封伪造 / 哈希不一致" --> R_SPOOF["⚠️ 凭据校验失败<br/>[EVIDENCE_HASH_MISMATCH]"] --> V_UNVER
    C_FILTER -- "REAL 模式引用外部假断言" --> R_ASSERT["⚠️ 伪真断言驳回<br/>[USER_ASSERTION_REJECTED]"] --> V_UNVER

    C_FILTER -- "证据信封合规" --> C_CRIT{"④ 关键确定性断言求值<br/>(Critical Assertions Check)"}

    %% 断言失败直接判 FAIL
    C_CRIT -- "任务未入库 / 状态非终态 / 净扣错账" --> R_CRIT_FAIL["❌ 关键物理断言失败<br/>[PHYSICAL_ASSERTION_FAIL]"] --> V_FAIL

    %% 断言通过，检查必需证据完整度
    C_CRIT -- "断言全部通过" --> C_REQ{"⑤ 必需证据契约评估<br/>(Required Evidence Complete?)"}

    C_REQ -- "凭据缺失 / SSH 中断 / 流水缺失" --> R_MISSING["⚠️ 必需证据缺失或受阻<br/>[BLOCKER_ACCUMULATED]"] --> V_UNVER
    C_REQ -- "全部必需证据通过 (PASS)" --> V_PASS

    %% 终态裁决节点 (完全去除任何 Subgraph 容器，彻底消除黄色背景)
    V_FAIL["❌ FAIL<br/>业务或物理断言明确失败"]
    V_UNVER["⚠️ UNVERIFIED<br/>物理证据缺口 · 结构化 Blocker 阻断"]
    V_PASS["✅ PASS<br/>全链路物理证据闭环 · 零假 PASS"]

    %% 呈现与归档
    V_FAIL --> P_REJ["投影: acceptance: REJECTED"]
    V_UNVER --> P_BLK["投影: acceptance: BLOCKED"]
    V_PASS --> P_ACC["投影: acceptance: ACCEPTED"]

    P_REJ & P_BLK & P_ACC --> DISPATCH["💾 单向只写归档 (ResultSink NDJSON 递归深冻结)"]
    DISPATCH --> DONE(["🏁 终端人读高亮呈现 + 证据报告交付"])

    %% 节点分类样式
    class INPUT,DONE startEnd
    class C_VALID,C_FILTER,C_CRIT,C_REQ gateNode
    class HARVEST,E_DB,E_BIN,E_BILL,E_DIV stepNode
    class R_EMPTY,R_SPOOF,R_ASSERT,R_CRIT_FAIL,R_MISSING,DISPATCH actionNode
    class V_PASS,P_ACC passNode
    class V_FAIL,P_REJ failNode
    class V_UNVER,P_BLK blockNode
```

---

## 🎛️ 四大核心动作闭环

```mermaid
flowchart LR
    A["① probe()<br>环境探活与能力发现"] --> B["② plan()<br>分流推导与消歧规约"]
    B --> C["③ execute()<br>任务派发与状态跟踪"]
    C --> D["④ verify()<br>5D 事实汇聚与唯一裁决"]

    style A fill:#e0f2fe,stroke:#0369a1
    style B fill:#fef3c7,stroke:#b45309
    style C fill:#f3e8ff,stroke:#6b21a8
    style D fill:#dcfce7,stroke:#15803d
```

- **`probe()`**：环境连通、脱敏凭证有效性感知与模型白名单探测。无裁决权。（`--mock` 为离线仿真，人读报告标注 `[MOCK]`）
- **`plan()`**：Direct 直连 vs NewAPI 分流决策、目标对象消歧、刊例积分预算（标为 `DEVTEST_EXPECTATION`）。无裁决权。
- **`execute()`**：受控离线仿真（`mock`）与真实提交（`real`）。真实提交默认 `READ_ONLY` 预检阻断，需显式 `--allow-submit` / `--allow-paid` 授权。
- **`verify()`**：采集 5 维客观事实（Task 终态、产物归属、容器物理结构、账单流水、金融不变量），提交唯一裁决引擎终审。使用 `--wait` 可从 `execute` 自动桥接至 `verify` 一键闭环。

---

## ⚖️ 零假 PASS 裁决门禁（确定性 Fail-Closed）

```mermaid
flowchart TD
    START(["输入: 证据信封 + 声明式断言 + 必需证据契约"]) --> CRIT{"任一必需证据 FAIL<br>或任一确定性断言 FAIL?"}
    CRIT -- 是 --> FAIL["❌ FAIL (业务明确失败)"]
    CRIT -- 否 --> BLOCK{"存在门禁阻断 (Blocker)<br>或必需证据缺失 / 空规格?"}
    BLOCK -- 是 --> UNVER["⚠️ UNVERIFIED (+ Blocker)<br>兼容投影为 acceptance: BLOCKED"]
    BLOCK -- 否 --> PASS["✅ PASS (全部必需证据与断言闭环)"]

    style FAIL fill:#fee2e2,stroke:#b91c1c,color:#b91c1c
    style UNVER fill:#fef3c7,stroke:#b45309,color:#b45309
    style PASS fill:#dcfce7,stroke:#15803d,color:#15803d
```

> [!CAUTION]
> **最小证据契约红线**：TestSpec 必须至少声明 `requiredEvidence` 或 `deterministicAssertions` 之一；两者皆空时裁决引擎直接返回 `UNVERIFIED`（blocker `NO_EVALUABLE_EVIDENCE_SPEC`），**严禁"空规格 PASS"**。证据 provenance 严禁从预期值反推（`PROVENANCE_DERIVED_FROM_EXPECTATION` 门禁）。真实模式下，调用者外部断言（如 `--gateway-channel-confirmed`）严禁被升级为网关事实。

---

## 🗄️ 真实数据库物理取证（原生接入 TS 流水线）

涉及真实任务派发与账目变动的场景，`verify` 在**真实模式**下会自动经 `DatabaseEvidenceProducer` 与 `db-preflight.ts` 通过 SSH 隧道（跳板机 `115.191.19.88:22`）对测试库执行**只读**物理落库取证，并将证据信封折算进唯一裁决：

- **严格只读原则**：仅执行 `SELECT` 查询，严禁执行 `INSERT` / `UPDATE` / `DELETE`；
- **凭据卫生管理**：凭据由本地 `db-credentials.json` 自动解析加载，严禁打印、记录或提交明文口令；
- **媒体源表自动消歧**：视频查询 `pq_aivideo_new`；图片按模式分别查询 `pq_aivideo_goods` / `_character` / `_scene` / `_fusion`；另核验后台调度表 `pq_volcengine_ai_task`；
- **账务严格闭环**：成功任务核对前台预扣流水 `pq_score_log` 与净扣对账；失败任务核对退款冲正流水，确保净扣积分严格归零；
- **严禁越权绕过**：真实数据变更场景强制执行数据库取证，不能被 CLI `--no-db-verify` 绕过；离线 fixture 测试方可显式跳过真实 MySQL。

> [!NOTE]
> **真实端到端闭环验证实证**：真实视频任务（Seedance 2.0 任务 `239545`）与真实图片任务（`1037`）已通过 `execute`（真实付费提交）➔ 轮询终态 ➔ 产物二进制解码 ➔ DB 只读取证 ➔ 账单流水对账，全流程跑通真实闭环。

---

## 🧩 内置技能库（Skills · agent 无关）

技能是给智能体的**领域决策指南 + 代码取证映射**，源在 `src/devtest/assets/<name>/`，构建时同步到 `dist/` 与 `.trae/skills/`，本地 CLI、Codex、Trae 共用：

| 技能 | 覆盖场景 |
|---|---|
| `panqu-newapi-diversion` | NewAPI 两级分流决策、渠道权重与降级回退（含 [`diversion-flow.md`](src/devtest/assets/panqu-newapi-diversion/references/diversion-flow.md) 真实代码端到端流程，带 `文件:行号` 取证） |
| `panqu-video-models` / `panqu-image-models` | 视频 / 图片模型接入、能力参数、任务与结果 |
| `panqu-billing` | 计费扣费、积分预估、账单大盘与对账 |
| `panqu-newapi-model-onboarding` | NewAPI 新模型接入 SOP 与排障 |
| `panqu-canvas` | 画布、工作流节点、协作与执行 |
| `devtest` | DevTest 主技能：需求澄清、计划一次确认、证据门禁、报告产出（见下方「自测报告产物」与 [`report-template.md`](src/devtest/assets/devtest/report-template.md)） |

---

## 🧾 自测报告产物（双模同源）

测试结果可输出为聊天简报或文件报告，均须对应实际执行记录；涉及业务裁决时引用唯一裁决引擎的实际结果，未产生裁决时明确说明：

- **聊天简报**（默认）：按实际场景、原始结果、证据与缺口组织，规约见 [`devtest/SKILL.md`](src/devtest/assets/devtest/SKILL.md) 第十节。
- **文件报告**（可交付）：按 [`report-template.md`](src/devtest/assets/devtest/report-template.md) 围绕实际使用场景组织覆盖、执行、专项核验和问题定位，重要异常展开预期差异、影响、证据与复现，未覆盖的风险单列。

> [!NOTE]
> **文件报告填写原则**：按场景主动检查差异、告警、证据冲突与关联回归；问题说明触发条件、影响与复现，根因假设和已确认原因分开；原始结果和证据可追溯，必需证据缺失及未覆盖风险不能省略；统计与费用按实际对象计算，不预填业务值或案例。详细规则以模板为准。

---

## 🛡️ 五重自动化安全门禁 (GitHub Actions)

| 安全层级 / Job | 扫描工具 | 目标 |
|---|---|---|
| **1. 生产依赖审计** (`security-audit`) | `npm audit --audit-level=high` | 阻断 High / Critical CVE 生产依赖 |
| **2. SAST 静态分析** (`security-sast`) | **Semgrep** (OWASP Top 10 & CWE) | 阻断注入、反序列化、不安全路径与敏感 API 误用 |
| **3. 秘钥与凭证防泄漏** (`security-secrets`) | **Gitleaks** (全历史) | 阻断 JWT / API Key / SSH 私钥 / 明文密码入库 |
| **4. 配置与容器安全** (`security-trivy`) | **Trivy** | 阻断畸变容器配置与云原生隐患 |
| **5. 开源协议合规** (`security-license`) | 自研合规审计器 | 阻断未授权传染性协议 (GPL/AGPL) 污染 |

---

## 🧪 质量门禁与测试矩阵

```bash
npm test                      # 全量 51 套件 / 906 单元测试 (100% 通过)
npx vitest run --coverage     # 覆盖率门禁 (Statements 86.51%, Lines 87.51%, Functions 91.55%, Branches 79.14%)
npm run build                 # TypeScript 编译 + 内置技能同步 (dist/ 与 .trae/skills/)
npm run lint                  # ESLint + Prettier
```

当前状态：**51 套件 / 906 用例 100% 通过，零跳过零失败**；`dependency-cycle.test.ts` 保证运行时依赖回环严格为 0。

<details>
<summary><b>📊 测试矩阵（按验证域）</b></summary>

| 验证域 | 代表套件 | 核心验证范围 |
|---|---|---|
| **核心调度 / CLI** | `core-kernel-and-cli`、`core-kernel-canonical-switch` | 四大动作、CLI 退出码、E2E 闭环状态机、10 大安全反证 |
| **唯一裁决** | `canonical-verdict-engine`、`canonical-protocol`、`canonical-shadow-comparison`、`legacy-protocol-mappers` | 纯三态断言、最小证据契约底线、证据信封校验、单向投影 |
| **分流路由** | `routing`、`routing-disambiguation`、`dynamic-plan`、`diversion-*` | Direct/NewAPI 决策、渠道消歧防伪、动态规划与刊例计算、line=10 规则 |
| **执行 / 媒体 / 账务** | `execution-ports`、`media-flow`、`media-inspector`、`billing`、`database-evidence-producer` | 受控执行端口、轮询退避、MP4/PNG 物理解析、三大金融不变量、SSH 隧道 DB 只读取证 |
| **需求 / 知识 / 能力** | `requirement-trace`、`domain-knowledge`、`knowledge-*`、`self-evolving-tester`、`capability-maturity-and-reality`、`agent-evaluation` | 需求追溯、知识召回/晋升/解耦、能力成熟度、智能体可信度评测 |
| **架构 / 契约 / 隔离 / 安全** | `architecture-convergence`、`dependency-cycle`、`public-api-contract`、`test-isolation`、`result-sink`、`security-ci`、探索变异 6 套件 | 拓扑收敛、零环依赖 (Cycle Count=0)、API 契约、故障恢复、CI 安全门禁契约 |

</details>

---

## 📚 深度文档中心

- 📐 [**架构永久冻结规范**](docs/ARCHITECTURE_FREEZE.md) — 核心拓扑、受控扩展红线与不可变原则
- 💻 [**命令行参考手册**](docs/CLI_REFERENCE.md) — 四大动作完整参数、示例与 JSON 管道
- 🤖 [**MCP 集成指南**](docs/MCP_GUIDE.md) — Trae / Cursor 配置与闭环交互
- 🔍 [**验真与金融对账白皮书**](docs/VERIFICATION_SPEC.md) — MP4 Box 解构、尾部切片、三大金融不变量
- 🔀 [**NewAPI 分流真实代码流程**](src/devtest/assets/panqu-newapi-diversion/references/diversion-flow.md) — 主站分流端到端取证映射
- 🧾 [**文件报告默认模板**](src/devtest/assets/devtest/report-template.md) — 按实际执行组织结论、证据与缺口
