# LBS Map Starter

[在线演示](https://icesixgod.github.io/lbs-map-starter/) · [English](README.en.md)

基于 **Three.js + OpenStreetMap** 的 LBS 地图基础项目，适合街区探索、位置游戏与建筑交互原型。

- 2D/3D 切换、平移、缩放，内置上海陆家嘴街区。
- 单栋建筑点选、高亮、搜索筛选，以及高度、占地面积和坐标详情。
- 本地运行支持在线地图补载、坐标探索与 GPS 定位。

## 启动

需要 **Node.js 20+**，无需安装依赖或配置 API Key。

```sh
git clone https://github.com/icesixgod/lbs-map-starter.git
cd lbs-map-starter
npm start
```

打开 **http://localhost:8789**。在线演示仅覆盖内置街区；探索其他区域请本地运行。

## 开发

```sh
npm run build       # 生成 dist/index.html
npm run build:demo  # 生成适合静态托管的街区演示
npm run verify      # 构建、测试与检查
```

[启动与部署](docs/getting-started.md) · [二次开发](docs/customization.md) · [架构](docs/architecture.md)

代码采用 [MIT](LICENSE)。地图数据 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，遵循 ODbL；其他依赖见 [第三方许可](THIRD_PARTY_NOTICES.md)。建筑高度可能为估算值，外观为程序化表现。
