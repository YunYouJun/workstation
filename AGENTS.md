# 项目清单

生成或修改 `projects*.yaml` / `projects*.yml` 时，遵循 [项目清单规范](docs/guide/projects.md)，复用现有格式与解析器。运行 `pnpm projects:schema:check`，并按 [Host 内容校验协议](docs/guide/host-api.md#项目清单内容校验) 用 `workstation host-json` 的 `validate-projects` 请求校验每份修改的清单，直到均返回 `ok: true` 且 `result.valid: true`。
