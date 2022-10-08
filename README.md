# Noslated

## 配置

请参考 `config/default.js`。若在开发阶段需要更改配置，请新建一个 `config/local.json`，并添加你需要修改的字段，如：

```json
{
  "turf": {
    "startTurfD": true,
  }
}
```

该配置表明，在启动 Alice 的时候，自动启动 `turfd`。

### 可配环境变量

配置的最高优先级在环境变量，目前支持：

+ `NOSLATE_LOGDIR`
+ `NOSLATED_WORKDIR`
+ `NOSLATED_MAX_ACTIVATE_REQUESTS`
