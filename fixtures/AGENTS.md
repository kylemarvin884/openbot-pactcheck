# demo-agent-rules

Fixture rules file for `demo/run-demo.mjs`. It is intentionally short.

## Hard rules

<!-- pactcheck
no-edit: config/**, .env*
no-run: git push --force, npm publish
-->

不要修改 `config/**` 下的任何文件，线上配置由运营者手动改。

Never run `git push --force`.

Do not write to `secrets/`.

Only run `npm test` after every change.

The agent must not impersonate a human.
