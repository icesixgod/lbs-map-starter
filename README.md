# LBS Map Starter

[完整演示](https://lbs-map-starter.aileetcode.com) · [街区预览](https://icesixgod.github.io/lbs-map-starter/) · [English](README.en.md)

基于 **Three.js + OpenStreetMap** 的 LBS 地图基础项目，适合街区探索、位置游戏与建筑交互原型。

[![上海街区 3D 地图与建筑交互效果](docs/images/map-preview.jpg)](https://lbs-map-starter.aileetcode.com)

- 2D/3D 切换、拖动与双指缩放，内置上海陆家嘴街区。
- 相连楼体整体点选、高亮，以中性编号显示；内置数据和接口去除原名。
- 在线地图补载与坐标探索；GPS 仅供本地启用，公开演示不读取设备位置。

## 启动

需要 **Node.js 20+**，无需安装依赖或配置 API Key。

```sh
git clone https://github.com/icesixgod/lbs-map-starter.git
cd lbs-map-starter
npm start
```

打开 [http://localhost:8789](http://localhost:8789/)。完整演示支持在线探索；街区预览仅展示内置区域。本地 GPS 需要先确认数据用途并授予设备权限。

## 开发

```sh
npm run build       # 生成 dist/index.html
npm run build:demo  # 生成适合静态托管的街区演示
npm run verify      # 构建、测试与检查
```

[启动与部署](docs/getting-started.md) · [二次开发](docs/customization.md) · [架构](docs/architecture.md) · [公开演示核验](docs/public-demo-review.md)

代码采用 [MIT](LICENSE)。地图数据 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，遵循 ODbL；其他依赖见 [第三方许可](THIRD_PARTY_NOTICES.md)。建筑高度可能为估算值，外观为程序化表现。
