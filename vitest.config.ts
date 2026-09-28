// Panqu AI DevTest v6.0.0 Vitest Configuration
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // 29.2：性能基准套件独立于默认全量回归（tests/perf，经 config/test/vitest.perf.config.ts 单独运行）
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/perf/**'],
    environment: 'node',
    // 负载敏感 flake 修复（2026-09-28，n=8 压测坐实）：默认 5000ms testTimeout 对 async 集成用例
    // （verify() 流水线 / 状态轮询 / getEditData，全程离线、CPU-bound）在 CPU 被抢占时（并发压测或小 CI 机器）
    // 会因事件循环饥饿在墙钟 5s 内跑不完而被过早掐死 → 假超时 FAIL（非断言 flaky、非裁决非确定）。
    // 抬高上限只给足墙钟、不弱化任何断言（健康用例正常 <1s，20s 仍能抓住真·死循环）——套件层「零假 FAIL」正解。
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage/',
      include: ['src/devtest/**/*.ts'],
      exclude: ['node_modules/', 'dist/', 'tests/', 'src/devtest/exploration/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
