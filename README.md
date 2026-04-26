# GPT Image / 图像中枢

面向图片生成与账号池管理的自托管工作台。项目提供 OpenAI 兼容的图片 API、在线图片生成界面、作品库、管理员概览、日志中心、账号池管理和系统配置能力，适合部署在自己的服务器或本地环境中统一管理图片生成链路。

仓库地址：[xinghe118/gpt-image](https://github.com/xinghe118/gpt-image)

> [!WARNING]
> 本项目涉及对第三方网页能力和账号状态的自动化调用与封装，仅供个人学习、技术研究和非商业性交流使用。请遵守 OpenAI 服务条款以及所在地法律法规。使用者需自行承担账号限制、接口变更、服务不可用及违规使用带来的全部风险。

## 功能概览

- 图片工作台：支持文生图、图片编辑、参考图上传、模型选择和生成参数配置。
- 作品库：自动汇总本地生成记录，便于回看、检索、下载和继续创作。
- 管理员概览：集中查看账号池、导入源、存储、代理、图片链路和异常状态。
- 日志中心：记录 API 调用、成功/失败状态、耗时、模型和错误摘要，方便定位问题。
- 账号池管理：支持账号搜索、筛选、刷新、导入、导出、禁用和异常账号清理。
- 系统设置：集中管理用户密钥、刷新周期、全局代理、图片访问地址、CPA 连接和 Sub2API 连接。
- OpenAI 兼容 API：提供图片生成、图片编辑、模型列表，以及面向图片场景的 Chat Completions / Responses 兼容接口。
- 多存储后端：支持本地 JSON、SQLite、PostgreSQL 和 Git 仓库存储。

## 页面入口

| 路径 | 说明 |
| --- | --- |
| `/login/` | 密钥登录页 |
| `/image/` | 用户端图片工作台 |
| `/library/` | 作品库 |
| `/admin/` | 管理员概览 |
| `/admin/logs/` | 日志中心 |
| `/accounts/` | 账号池管理 |
| `/settings/` | 系统设置 |

普通用户使用用户密钥登录后只能进入图片相关页面；管理员密钥来自后端配置，可进入账号池、概览、日志和系统设置。

## 快速开始

### 使用 Docker Compose

```bash
git clone https://github.com/xinghe118/gpt-image.git
cd gpt-image

# 按需修改 config.json 或 .env
docker compose up -d
```

启动后访问：

```text
http://127.0.0.1:8000
```

### 本地开发

后端要求 Python 3.13+。推荐使用 `uv` 安装依赖：

```bash
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

前端位于 `web/`，使用 Next.js：

```bash
cd web
npm install
npm run dev
```

生产构建前端并交给后端静态托管：

```bash
cd web
npm run build

# 将 web/out 的内容复制到项目根目录 web_dist
```

## 配置说明

核心配置可通过 `config.json`、`.env` 或环境变量提供。常用项如下：

| 配置 | 说明 |
| --- | --- |
| `GPT_IMAGE_AUTH_KEY` | 管理员访问密钥，可覆盖配置文件中的 auth key |
| `STORAGE_BACKEND` | 存储后端，支持 `json`、`sqlite`、`postgres`、`git` |
| `DATABASE_URL` | PostgreSQL 连接地址，`STORAGE_BACKEND=postgres` 时使用 |
| `GIT_REPO_URL` | Git 存储仓库地址，`STORAGE_BACKEND=git` 时使用 |
| `GIT_TOKEN` | Git 存储访问令牌 |
| `refresh_account_interval_minute` | 账号信息自动刷新周期，单位分钟 |

存储后端示例：

```yaml
environment:
  - STORAGE_BACKEND=postgres
  - DATABASE_URL=postgresql://user:password@host:5432/dbname
```

## API 使用

所有 AI 接口都需要携带：

```http
Authorization: Bearer <auth-key>
```

### 获取模型

```bash
curl http://localhost:8000/v1/models \
  -H "Authorization: Bearer <auth-key>"
```

### 图片生成

```bash
curl http://localhost:8000/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张未来城市中的霓虹雨夜街景",
    "n": 1,
    "response_format": "b64_json"
  }'
```

### 图片编辑

```bash
curl http://localhost:8000/v1/images/edits \
  -H "Authorization: Bearer <auth-key>" \
  -F "model=gpt-image-2" \
  -F "prompt=把这张图改成电影感夜景风格" \
  -F "n=1" \
  -F "image=@./input.png"
```

### Chat Completions 兼容入口

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-image-2",
    "messages": [
      {
        "role": "user",
        "content": "生成一张极简风格的产品海报"
      }
    ],
    "n": 1
  }'
```

### Responses 兼容入口

```bash
curl http://localhost:8000/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-5",
    "input": "生成一张未来感城市天际线图片",
    "tools": [
      {
        "type": "image_generation"
      }
    ]
  }'
```

## 管理功能

### 账号池

账号池用于保存和轮询可用账号。系统会自动刷新账号邮箱、订阅类型、额度、恢复时间和状态；当检测到 token 失效或账号异常时，会在管理端优先暴露。

支持的导入方式：

- 本地 CPA JSON 文件导入
- 远程 CPA 服务器导入
- Sub2API 服务器导入
- `access_token` 手动导入

### 日志中心

日志中心记录图片 API 的调用轨迹，包括请求事件、状态、模型、耗时、错误摘要和敏感信息脱敏后的访问痕迹。排查失败请求时，建议优先查看 `/admin/logs/`。

### 系统设置

设置页集中管理运行参数：

- 用户密钥管理：为普通用户创建独立访问密钥。
- 基础运行参数：账号刷新间隔、图片访问地址、全局代理。
- CPA 连接管理：保存远程 CPA 服务信息并同步账号。
- Sub2API 连接管理：查询 OAuth 账号并批量导入本地账号池。

## 项目结构

```text
api/          FastAPI 路由与后端入口
services/     账号、配置、存储、日志和 ChatGPT 调用服务
utils/        通用工具
web/          Next.js 前端源码
web_dist/     前端静态构建产物，由后端托管
data/         本地运行数据
docs/         文档补充
```

## 验证命令

修改代码后建议执行：

```bash
python -m compileall api services

cd web
npm run build
npx tsc --noEmit
```

## 安全建议

- 不要把管理员密钥、账号 token、数据库密码提交到公开仓库。
- 公网部署时务必增加反向代理访问控制、HTTPS 和强密钥。
- 不建议使用重要账号、高价值账号或常用账号测试。
- 如果需要给他人使用，请创建普通用户密钥，不要直接共享管理员密钥。
- 定期查看日志中心和账号池异常状态，及时清理失效账号。

## 许可证

本项目保留原仓库许可文件，详见 [LICENSE](./LICENSE)。
