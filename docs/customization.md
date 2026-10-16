# 二次开发

## 修改界面和建筑样式

| 目标 | 位置 |
| --- | --- |
| 标题、按钮、详情字段 | `src/map.template.html` |
| 布局、配色与适配 | `src/map.css` |
| 建筑类型主题 | `src/map-model.js` |
| 数据字段与去名策略 | `src/map-data-policy.js` |
| 程序化外墙和窗户 | `src/lbs-city-art.js` |
| 建筑高度和类型判定 | `src/coop-local-places.js` |
| 三维几何、相机和点选 | `src/coop-district-scene.js` |
| 视野预取与几何准备 | `src/lbs-map-stream.js`、`src/lbs-map-work.js` |

编辑后执行 `npm run build` 并刷新页面。

## 替换内置区域

例如将起始地图改为伦敦：

```sh
node scripts/fetch-map.cjs 51.5074 -0.1278 src/assets/default-map.json
npm run build
```

取数需要网络。命令保留地图来源信息；默认地图只有这一份，脚本会覆盖指定目标文件。也可先导出到其他 JSON 文件，检查后再替换。

`default-map.json` 采用项目的地理数据结构，包含 `center`、`radiusMeters`、`extentMeters`、`source`、`features`、`places` 和兼容字段 `gameNodes`。任意 GeoJSON 不能直接替换，需要先转换。初始视野中心由内置数据决定。

## 在应用中读取和选择建筑

页面启动后，浏览器中可使用 `window.lbsMap`：

```js
const app = window.lbsMap;
await app.ready;

console.log(app.snapshot());
console.log(app.mapView);     // 当前地图视野
console.log(app.selected);    // 当前选择，未选中时为 null

const building = app.districts.regions[0];
if (building) {
  app.selectBuilding(building.id);
  console.log(app.selected.id, app.selected.height, app.selected.area);
}

app.clearSelection();
```

这些是当前应用的接口，便于开始接入自定义逻辑；内部对象结构尚未作为稳定 SDK 承诺。只在初始化完成后使用它们，不要在视图更新期间直接修改注册表或选择索引。

添加建筑交互时，入口在 `src/map-client.js` 的 `selectMapDistrict()`，取消选择在 `closeBrief()`。保持原有高亮和详情更新，在自己的模块中记录所需的建筑字段即可。

为建筑附加“探索过”“资源点”等状态时，可以先使用当前会话内的建筑 ID。需要保存到长期存档时，应另行设计地理坐标、来源 ID、地图版本及迁移／匹配策略，不能默认显示模型 ID 永久不变。

## 数据源与部署

本地服务器通过 `/api/map` 提供普通 JSON 和 `stream=1` 时的 NDJSON，浏览器按同源路径请求。在线地图依赖服务层；将 `dist/index.html` 单独放到静态托管只能提供内置区域，需要同时接入兼容的地图 API 才能在线探索。

取数、缓存和构建均执行字段白名单；接口不提供原建筑名、机构名、别名或地址。自定义数据源应保留几何、类型、高度和来源字段，并遵守相同的去名策略。

`npm run build:demo` 会关闭在线取数并隐藏坐标探索和 GPS，适合静态展示；仓库包含 GitHub Pages 自动部署工作流。在线版本需另行配置 Node.js 服务入口与 HTTPS。保留页面的数据署名及 `THIRD_PARTY_NOTICES.md`。

## 当前边界

- 建筑高度优先采用地图数据，缺失时按楼层数乘 3.2 米或按类型估算；在线瓦片的高度也可能由上游推算。
- 当前保留 220 米建筑高度上限及交通设施简化；外墙、窗户、屋顶设施为程序化表现，面积为占地面积。
- 地图覆盖与属性取决于 OSM，建筑身份匹配面向当前会话；对外接口尚未承诺通用 SDK 的兼容性。
- GPS 精度和首次补载速度取决于设备与网络。
