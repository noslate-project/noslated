# Alice

## 当前版本测试启动

```sh
node --unhandled-rejections=strict index.js
```

请求：

```
http://127.0.0.1:3000/emp?params={"id":工号}
```

> 其中 `emp` 是函数名，`params` 是传入函数的 `event`。使用的是 `mock/server/test.js` 中的函数配置。

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

+ `ALICE_LOGDIR`
+ `ALICE_WORKDIR`
+ `ALICE_PLATFORM_SERVER`
+ `ALICE_LOG_LEVEL`
+ `ALICE_SOCK_CONN_TIMEOUT`
+ `ALICE_MAX_ACTIVATE_REQUESTS`

### 爱丽丝·玛格特洛依德

爱丽丝·玛格特洛依德，系列作品《东方Project》中的角色，七色的人偶师，有着**操控人偶的能力**。

![alice](./assets/alice.jpg)
