# 全局 Codex 约定

## Git 提交信息规范

- 当需要生成、修改或建议 Git 提交信息时，必须遵循 Angular Commit / Conventional Commits。
- 提交标题格式：`<type>(<scope>): <subject>`；当 `scope` 无法明确判断时，可以使用 `<type>: <subject>`。
- `type` 仅允许：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。
- `scope` 使用受影响的模块、包名、页面、组件或工具名，保持简短小写。
- `subject` 使用祈使句或简短动宾结构，描述实际改动，不以句号结尾。
- 不要生成泛泛的提交信息，例如 `update code`、`fix issue`、`misc changes`。
- 如果一次提交包含多个无关改动，优先建议拆分提交。

示例：

```text
feat(auth): add login state persistence
fix(toolbar): avoid unsupported gap styles
docs(readme): clarify setup steps
chore(deps): update lockfile
```
