# 启动说明

## 1. 准备环境

安装 [Node.js](https://nodejs.org/) 20 或更新版本，安装包中包含 npm。确认终端能找到它们：

```sh
node --version
npm --version
```

使用支持 WebGL 的现代浏览器。默认数据源不需要 API Key。项目已附带固定版本的 JavaScript 库，构建和启动均使用 Node.js 内置模块，无需 npm 安装依赖、Python、数据库或其他服务。

## 2. 启动地图

克隆仓库，进入包含 `package.json` 的目录（也可下载／解压源码）：

```sh
git clone https://github.com/icesixgod/lbs-map-starter.git
cd lbs-map-starter
npm start
```

启动过程先构建 `dist/index.html`，再启动本地服务。看到 `LBS Map Starter: http://localhost:8789` 后，在浏览器打开该地址。

默认显示内置真实街区。内置街区无需在线取数即可显示；在线道路和建筑随后补载。服务只绑定 `127.0.0.1`，按 `Ctrl+C` 关闭。

macOS 可双击 `scripts/启动地图.command`，它会构建、启动并打开浏览器。如果执行权限丢失，可先运行 `chmod +x scripts/启动地图.command`。Windows 可双击 `scripts/start.cmd`。

## 3. 基本操作

1. 拖动地图平移，使用滚轮或右下方缩放按钮调整视野。
2. 点击建筑屋顶、立面或二维轮廓，查看详情；点空白处、关闭按钮或按 Esc 取消选择。
3. 打开“建筑列表”搜索／筛选建筑；使用“居中查看”定位到选中的楼体。
4. 使用“2D 地图／3D 地图”切换视图。
5. 使用“探索坐标”输入 WGS84 纬度和经度。经纬度顺序为纬度在前、经度在后。
6. 按“启用 GPS”后才会申请定位权限。GPS 跟随时可拖动自由浏览，使用定位相关按钮恢复跟随。

## 4. 常用启动参数

更换被占用的端口：

```sh
npm start -- --port 8790
```

关闭地图磁盘缓存，适合检查首次加载行为：

```sh
npm start -- --no-cache
```

参数可以组合：

```sh
npm start -- --port 8790 --no-cache
```

查看参数：`node scripts/serve.cjs --help`。也可通过环境变量 `LBS_PORT` 指定端口。在线地图缓存默认写入 `.cache/maps/`，目录会按需创建，已加入 `.gitignore`。

## 5. 构建与离线查看

```sh
npm run build
```

用浏览器打开 `dist/index.html`。HTML 内嵌起始地图、材质、浏览器依赖和许可文本；内置区域可以离线查看。在线补载和探索其他坐标需要通过本地服务访问。GPS 使用 localhost 或 HTTPS。

`dist/` 是构建产物，不需要提交到源码仓库。分享单文件演示时可以单独分发生成的 HTML，其中已保留许可文本和页面署名。

### 完整版在线演示

[打开完整演示](https://lbs-map-starter.aileetcode.com)。站点托管于 Sites，包含在线 `/api/map` 接口，可探索其他坐标并按视野补载道路和建筑，保留 2D/3D、建筑交互与 GPS 入口。GPS 需要浏览器和设备授权。

地图接口沿用相同的数据解析和流式加载逻辑，适配 Workers 的请求与响应；服务端不使用磁盘缓存。

### 发布静态展示

[街区预览](https://icesixgod.github.io/lbs-map-starter/) 托管于 GitHub Pages，只展示内置上海街区，保留 2D/3D、缩放、建筑选择、搜索与筛选；不请求地图 API 或设备定位。

```sh
npm run build:demo
```

将生成的 `dist/` 发布到静态托管即可。仓库的 `Deploy demo` 工作流会在 `main` 更新时自动构建并部署到 GitHub Pages；fork 后需在仓库 Settings → Pages 中选择 GitHub Actions，再运行该工作流。修改 `src/map.template.html` 中的 GitHub 源码链接，以及 README 中的仓库和展示地址。

需要在线补载、坐标探索与 GPS 时，使用 `npm start` 启动完整版。此命令会重新构建，自动恢复在线模式。

## 6. 修改代码与验证

浏览器代码修改后运行 `npm run build` 并刷新页面；服务脚本修改后重新启动服务。完整检查：

```sh
npm run verify
```

该命令先构建，再运行自动化测试和生成文件语法检查，不依赖原项目、浏览器截图、旧缓存或测试录屏。仅运行 `npm test` 时需先构建一次，因为页面和 HTTP 测试会读取生成 HTML。

## 常见问题

| 情况 | 处理方式 |
| --- | --- |
| `node`／`npm` 找不到 | 安装 Node.js，重开终端后执行版本检查 |
| 端口被占用 | 使用 `npm start -- --port 8790` |
| 页面提示先构建 | 从项目根目录运行 `npm start`，或先执行 `npm run build` |
| 内置区域之外没有建筑 | 检查地图服务是否运行，以及终端中的数据源错误；公共数据源可能限流 |
| 修改源码后画面没变化 | 重建后刷新；服务脚本有变化时同时重启服务 |
| GPS 无法使用 | 在 localhost／HTTPS 下访问，检查浏览器与操作系统定位权限 |
| 楼高或名称不准确 | 检查数据来源；高度可能为推算值，当前还保留展示用高度上限 |

## 地图源配置

默认先尝试 OpenFreeMap，失败时尝试 Overpass。开发自有数据服务时，可以使用 `LBS_MAP_ENDPOINT` 设置首选来源，或使用 `LBS_MAP_ENDPOINTS` 提供以空格、逗号或分号分隔的完整端点列表。默认矢量入口使用 OpenMapTiles 格式，其他端点按 Overpass 接口调用；更换矢量服务还需修改 `scripts/vector-map-source.cjs` 的端点与相应配置。

这些环境变量由 Node.js 进程读取，项目不会自动加载 `.env` 文件。自定义数据源应保留对应署名与许可。
