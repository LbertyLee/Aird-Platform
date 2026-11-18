# 运营看板：用户活跃趋势

`GET /admin/dashboard/trends` 的 `points[].activeUserCount` 表示业务时区日历日内发起研究检索的去重用户数，数据来自 `ResearchRun.user_id`。

- 同一用户当日多次检索计 1 人，跨日分别计数。
- 按检索发起时间统计，包含成功、失败和执行中的检索。
- 无用户 ID 的匿名检索计入 `searchCount`，不计入活跃用户。
- 无检索的日期返回 `0`；无法取得统计数据时返回 `null`，前端显示缺口，不用新增用户数或累计用户数替代。
- 这项指标衡量检索活跃用户，不包含仅登录、浏览但未发起检索的用户。

`newUserCount` 仍表示当天新增注册人数，`userTotal` 仍表示截至当日结束的用户量快照。前端的用户活跃图只使用 `activeUserCount`，这些字段不能互相替代。

活跃数保存在 `dashboard_daily_stats.metrics` 中，不需要新增表或迁移。部署新版 API 后，首次请求会从原始检索记录重算缺少该字段的旧快照；趋势缓存升级为 `dashboard:trends:v2`。部署新版管理端前应先部署 API；旧 API 不提供该字段时新版管理端显示暂无趋势数据。
