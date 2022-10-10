# Noslated

## Configuration

Please refer to `config/default.js`. If you need to change the configuration in the development phase, please create a `config/local.json` and add the fields you need to modify, such as:

```json
{
  "turf": {
    "startTurfD": true,
  }
}
```

This configuration indicates that `turfd` is automatically started when Noslated is started.


### Configurable environment variables

The highest priority of the configuration is the environment variable. Currently, it supports:

+ `NOSLATE_LOGDIR`
+ `NOSLATED_WORKDIR`
+ `NOSLATED_MAX_ACTIVATE_REQUESTS`

## More

https://noslate.midwayjs.org/docs/noslate_workers/noslated/intro
