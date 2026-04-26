# VPS 一键部署

推荐在 Ubuntu 22.04/24.04 或 Debian 12 上部署。脚本会自动安装 Docker，检查 PostgreSQL 状态，确认数据库密码可用后再启动 GPT Image。

## 一条命令部署

```bash
curl -fsSL https://raw.githubusercontent.com/xinghe118/gpt-image/main/scripts/vps-install.sh | sudo bash
```

脚本会提示输入管理员登录密钥、可选公网地址和 PostgreSQL 密码。SQL 密码需要输入两次，先做本地确认，再进行数据库连接测试：

```text
Enter admin login key:
Enter public URL, optional, e.g. https://img.example.com:
Enter PostgreSQL password:
Confirm PostgreSQL password:
```

可选输入公网地址，例如：

```text
https://image.example.com
```

如果暂时没有域名，公网地址直接回车即可，部署后访问：

```text
http://服务器IP:3000
```

## 非交互部署

```bash
curl -fsSL https://raw.githubusercontent.com/xinghe118/gpt-image/main/scripts/vps-install.sh \
  | sudo GPT_IMAGE_AUTH_KEY="your-admin-key" GPT_IMAGE_BASE_URL="https://image.example.com" bash
```

可选变量：

```bash
APP_DIR=/opt/gpt-image
APP_PORT=3000
APP_IMAGE=ghcr.io/xinghe118/gpt-image:latest
POSTGRES_DB=gpt_image
POSTGRES_USER=gpt_image
POSTGRES_PASSWORD=change-this-password
POSTGRES_CONTAINER=gpt-image-postgres
RESET_POSTGRES_DATA=false
```

## 数据库密码检查

安装脚本会先检查 VPS 上是否已有名为 `gpt-image-postgres` 的 PostgreSQL 容器。

如果已有容器，脚本会用你输入的 `POSTGRES_USER`、`POSTGRES_DB` 和 `POSTGRES_PASSWORD` 执行连接测试，测试通过才会继续部署。这样可以提前发现“应用密码和旧数据库真实密码不一致”的问题，避免容器反复重启。

如果测试失败，脚本会询问是否删除旧数据库数据并重新初始化。全新部署或旧数据不需要保留时，可以输入 `y` 继续。

非交互部署时，如确认可以清空旧数据库，可显式开启：

```bash
RESET_POSTGRES_DATA=true
```

如果需要保留旧数据，可以在 VPS 上修正数据库用户密码：

```bash
cd /opt/gpt-image
docker compose exec postgres psql -U postgres -d postgres
```

进入 PostgreSQL 后执行：

```sql
ALTER USER gpt_image WITH PASSWORD '你的新密码';
\q
```

然后重新运行安装脚本。

也可以手动删除旧数据库卷后重新安装：

```bash
cd /opt/gpt-image
docker compose down -v
```

## 常用命令

```bash
cd /opt/gpt-image
docker compose ps
docker compose logs -f app
docker compose pull && docker compose up -d
```

## 更新 Docker 镜像

仓库提交推送到 `main` 后，会触发 GitHub Actions 的 `Publish Docker Image` 工作流。只有工作流成功后，`ghcr.io/xinghe118/gpt-image:latest` 才会变成新镜像。

在 VPS 上更新：

```bash
cd /opt/gpt-image
docker compose pull
docker compose up -d --force-recreate
docker compose ps
```

验证服务是否起来：

```bash
curl -I http://127.0.0.1:3000
docker compose logs --tail=120 app
```

如果页面没有变化，先检查 GitHub Actions 是否成功。如果 `Publish Docker Image` 报 `permission_denied: write_package`，说明 GHCR 包没有允许这个仓库写入。

处理方式：

1. 打开 GitHub 仓库右侧的 `Packages`，进入 `gpt-image` 包。
2. 进入 `Package settings`。
3. 在 `Manage Actions access` 中添加 `xinghe118/gpt-image`。
4. 权限选择 `Write`。
5. 回到 `Actions` 重新运行 `Publish Docker Image`。
6. 工作流成功后，再到 VPS 执行 `docker compose pull && docker compose up -d --force-recreate`。

## 数据备份

```bash
cd /opt/gpt-image
docker compose exec postgres pg_dump -U gpt_image gpt_image > backup.sql
```

恢复：

```bash
cd /opt/gpt-image
cat backup.sql | docker compose exec -T postgres psql -U gpt_image gpt_image
```

## Nginx 反代

```nginx
server {
    listen 80;
    server_name image.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

HTTPS：

```bash
sudo certbot --nginx -d image.example.com
```
