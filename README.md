<div align="center">

# YamlVim

**本地优先的 mihomo 路由与 DNS 工作台**

[![CI](https://github.com/youbilin/yamlVim/actions/workflows/ci.yml/badge.svg)](https://github.com/youbilin/yamlVim/actions/workflows/ci.yml)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-0.1.0-orange)

把 mihomo 配置当作可以安全编辑的工作区：可视化维护节点、策略组、规则与 DNS，
一键导出标准 YAML，或直接写入 Clash Verge；实时页面挂接运行中的内核，
可切换出口、测速、查看连接流。

</div>

---

## 特性

### 工作区驱动

- **Workspace-only 架构**：所有编辑落在 workspace.json，没有隐藏的基础配置，也没有历史快照层；导出永远基于当前工作区重新生成完整 YAML。
- **可视化编辑**：节点、策略组（出口）、规则、链式节点全部支持增删改；删除/重命名节点时自动清理与改写策略组引用。
- **混合批量导入**：导入框逐行处理——配置路径、订阅 URL、节点分享链接、YAML、Base64，互不阻断，失败行单独提示。

### 规则与策略组

- **内置规则目录**：打包 MetaCubeX meta-rules-dat 全量目录，中文名称/描述/分类，本地离线检索（如搜「抖音」），一键导入为 http .mrs rule-provider + RULE-SET 规则。
- **策略组模板**：内置 14 组标准模板（节点选择 / 自动选择 / 广告拦截 / AI / 油管 / 谷歌 / 微软 / 苹果 / 电报 / 代码托管 / 私有 / 国内 / 非中国 / 漏网之鱼），一键创建全部策略组、22 个规则集与 MATCH 兜底规则；IP 类规则自动带 no-resolve。
- **推荐组合**：新增单个策略组时按服务维度推荐规则集组合，自动包含全部节点。

### 实时连接（Safe Mode）

- 挂接运行中的 mihomo 外部控制器，轮询展示连接流：域名、命中规则、链路、速率。
- **点击连接即可改出口**：定位链路上的 Selector 组，在「策略组 / 节点」中直接切换，并断开该连接使其按新出口重连。
- 策略组测速、DNS 查询与缓存清理均为显式动作；不会启动/停止/重载内核。

### DNS 覆写

- 可视化表单 + 可收起的原始 YAML 编辑，支持 nameserver-policy、固定 IP、拦截、绕过 fake-IP 等策略。
- **持久默认配置**：内置实战调优的默认 DNS（fake-ip、多上游、fallback-filter、本地域名策略），没有内核时也能直接应用；配置内核后自动执行 mihomo -t 校验。

### 导出与 Clash Verge 集成

- **导出页**：完整 YAML 可编辑，mihomo -t 校验、与上次导出 diff、时间戳落盘。
- **写入 Clash Verge**：把当前配置作为本地订阅写入 Verge 的 profiles.yaml 并设为当前，本地规则集文件一并复制，Verge 刷新即生效。
- **读取 Clash Verge**：反向导入 Verge 当前启用的订阅，并可自动带出 Verge 的控制器地址与密钥。

### 桌面体验

- Tauri 2 + React 19 + Vite，白黑灰单色视觉，可折叠侧边栏，NSIS 安装包。
- 文件页管理每次导出的 YAML：预览、删除、或作为全新工作区载入继续编辑。

## 快速开始

```bash
# 从源码构建（Node >= 22, Rust stable + MSVC）
npm install
npm run desktop:build   # 产出 NSIS 安装包
```

安装后：

1. **内核页**（可选）：设置 mihomo 可执行文件路径，用于 mihomo -t 校验。没有内核也能完成全部编辑与 DNS 应用。
2. **导入**：粘贴订阅 URL / 节点链接 / 配置路径 / YAML，或直接从 Clash Verge 读取。
3. **策略组**：出口页点「应用模板」一键生成完整骨架，或按推荐组合逐个创建。
4. **导出**：校验后导出 YAML，或直接「导入到 Clash Verge」。
5. **实时连接**：填入控制器地址（如 127.0.0.1:9090）连接运行中的内核。

## 数据目录

```
<data>/
├── workspace.json      # 唯一事实来源
├── config.yaml         # 由 workspace 生成的完整配置
├── settings.json       # 内核路径与控制器设置
├── dns-default.yaml    # 默认 DNS（未保存时使用内置默认）
├── core/               # 校验工作目录 + 规则集缓存
└── exports/            # 每次导出的时间戳 YAML
```

## 架构

| 层 | 说明 |
| --- | --- |
| src/ | React 19 + zustand + Vite 前端 |
| crates/yamlvim-core | 工作区模型、YAML 生成、DNS 编译器、分享链接解析 |
| crates/yamlvim-mihomo | 内核探测、mihomo -t 校验、外部控制器客户端 |
| src-tauri/ | Tauri 2 壳、托盘、单实例、全部 IPC 命令 |

## 开发

```bash
npm run dev            # Web 预览（浏览器 mock）
cargo test --workspace # Rust 测试 + clippy
npm run desktop:dev    # Tauri 开发模式
```

## 已知限制

- 实时数据为 1s 轮询（WebSocket 推送在路线图中）
- 未做代码签名，Windows SmartScreen 可能提示
- provider 路径按各客户端数据目录生成，跨客户端搬运请重新导出

## License

[MIT](LICENSE)
