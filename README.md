# Notebook
一个简单的笔记系统

利用 GitHub Pages 获取json，cloudflare workers 上传更新json。

worker变量：

| 变量名 | 示例值 | 说明 |
|-----|---|-----|
| GITHUB_OWNER | ha47i | GitHub 用户名 |
| GITHUB_REPO | TextsDataBase 仓库名 |
| GITHUB_BRANCH | main | 可选，默认 main |
| GITHUB_TOKEN | github_pat_xxx... | 新版 Fine-grained Token |
| VALID_API_KEYS | {"liuli":"default_user"} | JSON 字符串 |