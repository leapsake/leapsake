/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "app/icon/route";
exports.ids = ["app/icon/route"];
exports.modules = {

/***/ "(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Ficon%2Froute&page=%2Ficon%2Froute&appPaths=&pagePath=private-next-app-dir%2Ficon.tsx&appDir=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!":
/*!*********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Ficon%2Froute&page=%2Ficon%2Froute&appPaths=&pagePath=private-next-app-dir%2Ficon.tsx&appDir=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D! ***!
  \*********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   patchFetch: () => (/* binding */ patchFetch),\n/* harmony export */   routeModule: () => (/* binding */ routeModule),\n/* harmony export */   serverHooks: () => (/* binding */ serverHooks),\n/* harmony export */   workAsyncStorage: () => (/* binding */ workAsyncStorage),\n/* harmony export */   workUnitAsyncStorage: () => (/* binding */ workUnitAsyncStorage)\n/* harmony export */ });\n/* harmony import */ var next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/dist/server/route-modules/app-route/module.compiled */ \"(rsc)/./node_modules/next/dist/server/route-modules/app-route/module.compiled.js\");\n/* harmony import */ var next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_dist_server_route_kind__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/dist/server/route-kind */ \"(rsc)/./node_modules/next/dist/server/route-kind.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! next/dist/server/lib/patch-fetch */ \"(rsc)/./node_modules/next/dist/server/lib/patch-fetch.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var next_metadata_route_loader_filePath_2FUsers_2Fjoshsmith_2FCode_2Fleapsake_2Fleapsake_2Fapps_2Fclient_web_2Fsrc_2Fapp_2Ficon_tsx_isDynamicRouteExtension_1_next_metadata_route___WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! next-metadata-route-loader?filePath=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp%2Ficon.tsx&isDynamicRouteExtension=1!?__next_metadata_route__ */ \"(rsc)/./node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js?filePath=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp%2Ficon.tsx&isDynamicRouteExtension=1!?__next_metadata_route__\");\n\n\n\n\n// We inject the nextConfigOutput here so that we can use them in the route\n// module.\nconst nextConfigOutput = \"\"\nconst routeModule = new next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__.AppRouteRouteModule({\n    definition: {\n        kind: next_dist_server_route_kind__WEBPACK_IMPORTED_MODULE_1__.RouteKind.APP_ROUTE,\n        page: \"/icon/route\",\n        pathname: \"/icon\",\n        filename: \"icon\",\n        bundlePath: \"app/icon/route\"\n    },\n    resolvedPagePath: \"next-metadata-route-loader?filePath=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp%2Ficon.tsx&isDynamicRouteExtension=1!?__next_metadata_route__\",\n    nextConfigOutput,\n    userland: next_metadata_route_loader_filePath_2FUsers_2Fjoshsmith_2FCode_2Fleapsake_2Fleapsake_2Fapps_2Fclient_web_2Fsrc_2Fapp_2Ficon_tsx_isDynamicRouteExtension_1_next_metadata_route___WEBPACK_IMPORTED_MODULE_3__\n});\n// Pull out the exports that we need to expose from the module. This should\n// be eliminated when we've moved the other routes to the new format. These\n// are used to hook into the route.\nconst { workAsyncStorage, workUnitAsyncStorage, serverHooks } = routeModule;\nfunction patchFetch() {\n    return (0,next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__.patchFetch)({\n        workAsyncStorage,\n        workUnitAsyncStorage\n    });\n}\n\n\n//# sourceMappingURL=app-route.js.map//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvbmV4dC9kaXN0L2J1aWxkL3dlYnBhY2svbG9hZGVycy9uZXh0LWFwcC1sb2FkZXIvaW5kZXguanM/bmFtZT1hcHAlMkZpY29uJTJGcm91dGUmcGFnZT0lMkZpY29uJTJGcm91dGUmYXBwUGF0aHM9JnBhZ2VQYXRoPXByaXZhdGUtbmV4dC1hcHAtZGlyJTJGaWNvbi50c3gmYXBwRGlyPSUyRlVzZXJzJTJGam9zaHNtaXRoJTJGQ29kZSUyRmxlYXBzYWtlJTJGbGVhcHNha2UlMkZhcHBzJTJGY2xpZW50LXdlYiUyRnNyYyUyRmFwcCZwYWdlRXh0ZW5zaW9ucz10c3gmcGFnZUV4dGVuc2lvbnM9dHMmcGFnZUV4dGVuc2lvbnM9anN4JnBhZ2VFeHRlbnNpb25zPWpzJnJvb3REaXI9JTJGVXNlcnMlMkZqb3Noc21pdGglMkZDb2RlJTJGbGVhcHNha2UlMkZsZWFwc2FrZSUyRmFwcHMlMkZjbGllbnQtd2ViJmlzRGV2PXRydWUmdHNjb25maWdQYXRoPXRzY29uZmlnLmpzb24mYmFzZVBhdGg9JmFzc2V0UHJlZml4PSZuZXh0Q29uZmlnT3V0cHV0PSZwcmVmZXJyZWRSZWdpb249Jm1pZGRsZXdhcmVDb25maWc9ZTMwJTNEISIsIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7OztBQUErRjtBQUN2QztBQUNxQjtBQUNtSTtBQUNoTjtBQUNBO0FBQ0E7QUFDQSx3QkFBd0IseUdBQW1CO0FBQzNDO0FBQ0EsY0FBYyxrRUFBUztBQUN2QjtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0EsWUFBWTtBQUNaLENBQUM7QUFDRDtBQUNBO0FBQ0E7QUFDQSxRQUFRLHNEQUFzRDtBQUM5RDtBQUNBLFdBQVcsNEVBQVc7QUFDdEI7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUMwRjs7QUFFMUYiLCJzb3VyY2VzIjpbIiJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHBSb3V0ZVJvdXRlTW9kdWxlIH0gZnJvbSBcIm5leHQvZGlzdC9zZXJ2ZXIvcm91dGUtbW9kdWxlcy9hcHAtcm91dGUvbW9kdWxlLmNvbXBpbGVkXCI7XG5pbXBvcnQgeyBSb3V0ZUtpbmQgfSBmcm9tIFwibmV4dC9kaXN0L3NlcnZlci9yb3V0ZS1raW5kXCI7XG5pbXBvcnQgeyBwYXRjaEZldGNoIGFzIF9wYXRjaEZldGNoIH0gZnJvbSBcIm5leHQvZGlzdC9zZXJ2ZXIvbGliL3BhdGNoLWZldGNoXCI7XG5pbXBvcnQgKiBhcyB1c2VybGFuZCBmcm9tIFwibmV4dC1tZXRhZGF0YS1yb3V0ZS1sb2FkZXI/ZmlsZVBhdGg9JTJGVXNlcnMlMkZqb3Noc21pdGglMkZDb2RlJTJGbGVhcHNha2UlMkZsZWFwc2FrZSUyRmFwcHMlMkZjbGllbnQtd2ViJTJGc3JjJTJGYXBwJTJGaWNvbi50c3gmaXNEeW5hbWljUm91dGVFeHRlbnNpb249MSE/X19uZXh0X21ldGFkYXRhX3JvdXRlX19cIjtcbi8vIFdlIGluamVjdCB0aGUgbmV4dENvbmZpZ091dHB1dCBoZXJlIHNvIHRoYXQgd2UgY2FuIHVzZSB0aGVtIGluIHRoZSByb3V0ZVxuLy8gbW9kdWxlLlxuY29uc3QgbmV4dENvbmZpZ091dHB1dCA9IFwiXCJcbmNvbnN0IHJvdXRlTW9kdWxlID0gbmV3IEFwcFJvdXRlUm91dGVNb2R1bGUoe1xuICAgIGRlZmluaXRpb246IHtcbiAgICAgICAga2luZDogUm91dGVLaW5kLkFQUF9ST1VURSxcbiAgICAgICAgcGFnZTogXCIvaWNvbi9yb3V0ZVwiLFxuICAgICAgICBwYXRobmFtZTogXCIvaWNvblwiLFxuICAgICAgICBmaWxlbmFtZTogXCJpY29uXCIsXG4gICAgICAgIGJ1bmRsZVBhdGg6IFwiYXBwL2ljb24vcm91dGVcIlxuICAgIH0sXG4gICAgcmVzb2x2ZWRQYWdlUGF0aDogXCJuZXh0LW1ldGFkYXRhLXJvdXRlLWxvYWRlcj9maWxlUGF0aD0lMkZVc2VycyUyRmpvc2hzbWl0aCUyRkNvZGUlMkZsZWFwc2FrZSUyRmxlYXBzYWtlJTJGYXBwcyUyRmNsaWVudC13ZWIlMkZzcmMlMkZhcHAlMkZpY29uLnRzeCZpc0R5bmFtaWNSb3V0ZUV4dGVuc2lvbj0xIT9fX25leHRfbWV0YWRhdGFfcm91dGVfX1wiLFxuICAgIG5leHRDb25maWdPdXRwdXQsXG4gICAgdXNlcmxhbmRcbn0pO1xuLy8gUHVsbCBvdXQgdGhlIGV4cG9ydHMgdGhhdCB3ZSBuZWVkIHRvIGV4cG9zZSBmcm9tIHRoZSBtb2R1bGUuIFRoaXMgc2hvdWxkXG4vLyBiZSBlbGltaW5hdGVkIHdoZW4gd2UndmUgbW92ZWQgdGhlIG90aGVyIHJvdXRlcyB0byB0aGUgbmV3IGZvcm1hdC4gVGhlc2Vcbi8vIGFyZSB1c2VkIHRvIGhvb2sgaW50byB0aGUgcm91dGUuXG5jb25zdCB7IHdvcmtBc3luY1N0b3JhZ2UsIHdvcmtVbml0QXN5bmNTdG9yYWdlLCBzZXJ2ZXJIb29rcyB9ID0gcm91dGVNb2R1bGU7XG5mdW5jdGlvbiBwYXRjaEZldGNoKCkge1xuICAgIHJldHVybiBfcGF0Y2hGZXRjaCh7XG4gICAgICAgIHdvcmtBc3luY1N0b3JhZ2UsXG4gICAgICAgIHdvcmtVbml0QXN5bmNTdG9yYWdlXG4gICAgfSk7XG59XG5leHBvcnQgeyByb3V0ZU1vZHVsZSwgd29ya0FzeW5jU3RvcmFnZSwgd29ya1VuaXRBc3luY1N0b3JhZ2UsIHNlcnZlckhvb2tzLCBwYXRjaEZldGNoLCAgfTtcblxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9YXBwLXJvdXRlLmpzLm1hcCJdLCJuYW1lcyI6W10sImlnbm9yZUxpc3QiOltdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Ficon%2Froute&page=%2Ficon%2Froute&appPaths=&pagePath=private-next-app-dir%2Ficon.tsx&appDir=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!\n");

/***/ }),

/***/ "(rsc)/./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true!":
/*!******************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true! ***!
  \******************************************************************************************************/
/***/ (() => {



/***/ }),

/***/ "(rsc)/./node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js?filePath=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp%2Ficon.tsx&isDynamicRouteExtension=1!?__next_metadata_route__":
/*!*********************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js?filePath=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp%2Ficon.tsx&isDynamicRouteExtension=1!?__next_metadata_route__ ***!
  \*********************************************************************************************************************************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   GET: () => (/* binding */ GET),\n/* harmony export */   contentType: () => (/* reexport safe */ _Users_joshsmith_Code_leapsake_leapsake_apps_client_web_src_app_icon_tsx__WEBPACK_IMPORTED_MODULE_1__.contentType),\n/* harmony export */   size: () => (/* reexport safe */ _Users_joshsmith_Code_leapsake_leapsake_apps_client_web_src_app_icon_tsx__WEBPACK_IMPORTED_MODULE_1__.size)\n/* harmony export */ });\n/* harmony import */ var next_server__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/server */ \"(rsc)/./node_modules/next/dist/api/server.js\");\n/* harmony import */ var _Users_joshsmith_Code_leapsake_leapsake_apps_client_web_src_app_icon_tsx__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./src/app/icon.tsx */ \"(rsc)/./src/app/icon.tsx\");\n/* dynamic image route */\n\n\n\nconst imageModule = { ..._Users_joshsmith_Code_leapsake_leapsake_apps_client_web_src_app_icon_tsx__WEBPACK_IMPORTED_MODULE_1__ }\n\nconst handler = imageModule.default\nconst generateImageMetadata = imageModule.generateImageMetadata\n\n\n  if (typeof handler !== 'function') {\n    throw new Error('Default export is missing in \"/Users/joshsmith/Code/leapsake/leapsake/apps/client-web/src/app/icon.tsx\"')\n  }\n  \n\n\n\nasync function GET(_, ctx) {\n  const params = await ctx.params\n  const { __metadata_id__, ...rest } = params || {}\n  const restParams = params ? rest : undefined\n  const targetId = __metadata_id__\n  let id = undefined\n  \n  if (generateImageMetadata) {\n    const imageMetadata = await generateImageMetadata({ params: restParams })\n    id = imageMetadata.find((item) => {\n      if (true) {\n        if (item?.id == null) {\n          throw new Error('id property is required for every item returned from generateImageMetadata')\n        }\n      }\n      return item.id.toString() === targetId\n    })?.id\n    if (id == null) {\n      return new next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse('Not Found', {\n        status: 404,\n      })\n    }\n  }\n\n  return handler({ params: restParams, id })\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvbmV4dC9kaXN0L2J1aWxkL3dlYnBhY2svbG9hZGVycy9uZXh0LW1ldGFkYXRhLXJvdXRlLWxvYWRlci5qcz9maWxlUGF0aD0lMkZVc2VycyUyRmpvc2hzbWl0aCUyRkNvZGUlMkZsZWFwc2FrZSUyRmxlYXBzYWtlJTJGYXBwcyUyRmNsaWVudC13ZWIlMkZzcmMlMkZhcHAlMkZpY29uLnRzeCZpc0R5bmFtaWNSb3V0ZUV4dGVuc2lvbj0xIT9fX25leHRfbWV0YWRhdGFfcm91dGVfXyIsIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFBO0FBQzBDO0FBQzBEOztBQUVwRyxzQkFBc0IsR0FBRyxxR0FBUTs7QUFFakM7QUFDQTs7O0FBR0E7QUFDQTtBQUNBO0FBQ0E7QUFDNEc7OztBQUdyRztBQUNQO0FBQ0EsVUFBVSwyQkFBMkI7QUFDckM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHdEQUF3RCxvQkFBb0I7QUFDNUU7QUFDQSxVQUFVLElBQXFDO0FBQy9DO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQSxpQkFBaUIscURBQVk7QUFDN0I7QUFDQSxPQUFPO0FBQ1A7QUFDQTs7QUFFQSxtQkFBbUIsd0JBQXdCO0FBQzNDIiwic291cmNlcyI6WyI/X19uZXh0X21ldGFkYXRhX3JvdXRlX18iXSwic291cmNlc0NvbnRlbnQiOlsiLyogZHluYW1pYyBpbWFnZSByb3V0ZSAqL1xuaW1wb3J0IHsgTmV4dFJlc3BvbnNlIH0gZnJvbSAnbmV4dC9zZXJ2ZXInXG5pbXBvcnQgKiBhcyB1c2VybGFuZCBmcm9tIFwiL1VzZXJzL2pvc2hzbWl0aC9Db2RlL2xlYXBzYWtlL2xlYXBzYWtlL2FwcHMvY2xpZW50LXdlYi9zcmMvYXBwL2ljb24udHN4XCJcblxuY29uc3QgaW1hZ2VNb2R1bGUgPSB7IC4uLnVzZXJsYW5kIH1cblxuY29uc3QgaGFuZGxlciA9IGltYWdlTW9kdWxlLmRlZmF1bHRcbmNvbnN0IGdlbmVyYXRlSW1hZ2VNZXRhZGF0YSA9IGltYWdlTW9kdWxlLmdlbmVyYXRlSW1hZ2VNZXRhZGF0YVxuXG5cbiAgaWYgKHR5cGVvZiBoYW5kbGVyICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdEZWZhdWx0IGV4cG9ydCBpcyBtaXNzaW5nIGluIFwiL1VzZXJzL2pvc2hzbWl0aC9Db2RlL2xlYXBzYWtlL2xlYXBzYWtlL2FwcHMvY2xpZW50LXdlYi9zcmMvYXBwL2ljb24udHN4XCInKVxuICB9XG4gIFxuZXhwb3J0IHsgc2l6ZSwgY29udGVudFR5cGUgfSBmcm9tIFwiL1VzZXJzL2pvc2hzbWl0aC9Db2RlL2xlYXBzYWtlL2xlYXBzYWtlL2FwcHMvY2xpZW50LXdlYi9zcmMvYXBwL2ljb24udHN4XCJcblxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gR0VUKF8sIGN0eCkge1xuICBjb25zdCBwYXJhbXMgPSBhd2FpdCBjdHgucGFyYW1zXG4gIGNvbnN0IHsgX19tZXRhZGF0YV9pZF9fLCAuLi5yZXN0IH0gPSBwYXJhbXMgfHwge31cbiAgY29uc3QgcmVzdFBhcmFtcyA9IHBhcmFtcyA/IHJlc3QgOiB1bmRlZmluZWRcbiAgY29uc3QgdGFyZ2V0SWQgPSBfX21ldGFkYXRhX2lkX19cbiAgbGV0IGlkID0gdW5kZWZpbmVkXG4gIFxuICBpZiAoZ2VuZXJhdGVJbWFnZU1ldGFkYXRhKSB7XG4gICAgY29uc3QgaW1hZ2VNZXRhZGF0YSA9IGF3YWl0IGdlbmVyYXRlSW1hZ2VNZXRhZGF0YSh7IHBhcmFtczogcmVzdFBhcmFtcyB9KVxuICAgIGlkID0gaW1hZ2VNZXRhZGF0YS5maW5kKChpdGVtKSA9PiB7XG4gICAgICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJykge1xuICAgICAgICBpZiAoaXRlbT8uaWQgPT0gbnVsbCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignaWQgcHJvcGVydHkgaXMgcmVxdWlyZWQgZm9yIGV2ZXJ5IGl0ZW0gcmV0dXJuZWQgZnJvbSBnZW5lcmF0ZUltYWdlTWV0YWRhdGEnKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gaXRlbS5pZC50b1N0cmluZygpID09PSB0YXJnZXRJZFxuICAgIH0pPy5pZFxuICAgIGlmIChpZCA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gbmV3IE5leHRSZXNwb25zZSgnTm90IEZvdW5kJywge1xuICAgICAgICBzdGF0dXM6IDQwNCxcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGhhbmRsZXIoeyBwYXJhbXM6IHJlc3RQYXJhbXMsIGlkIH0pXG59XG4iXSwibmFtZXMiOltdLCJpZ25vcmVMaXN0IjpbXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js?filePath=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp%2Ficon.tsx&isDynamicRouteExtension=1!?__next_metadata_route__\n");

/***/ }),

/***/ "(rsc)/./src/app/icon.tsx":
/*!**************************!*\
  !*** ./src/app/icon.tsx ***!
  \**************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   contentType: () => (/* binding */ contentType),\n/* harmony export */   \"default\": () => (/* binding */ Icon),\n/* harmony export */   size: () => (/* binding */ size)\n/* harmony export */ });\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react/jsx-dev-runtime */ \"(rsc)/./node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js\");\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_og__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/og */ \"(rsc)/./node_modules/next/dist/api/og.js\");\n\n\n// Image metadata\nconst size = {\n    width: 32,\n    height: 32\n};\nconst contentType = 'image/png';\n// Image generation\nfunction Icon() {\n    return new next_og__WEBPACK_IMPORTED_MODULE_1__.ImageResponse(// ImageResponse JSX element\n    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"div\", {\n        style: {\n            alignItems: 'center',\n            display: 'flex',\n            fontSize: 24,\n            height: '100%',\n            justifyContent: 'center',\n            width: '100%'\n        },\n        children: \"\\uD83D\\uDC38\"\n    }, void 0, false, {\n        fileName: \"/Users/joshsmith/Code/leapsake/leapsake/apps/client-web/src/app/icon.tsx\",\n        lineNumber: 15,\n        columnNumber: 4\n    }, this), // ImageResponse options\n    {\n        // For convenience, we can re-use the exported icons size metadata\n        // config to also set the ImageResponse's width and height.\n        ...size\n    });\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9zcmMvYXBwL2ljb24udHN4IiwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7QUFBdUM7QUFFdkMsaUJBQWlCO0FBQ1YsTUFBTUMsT0FBTztJQUNuQkMsT0FBTztJQUNQQyxRQUFRO0FBQ1QsRUFBQztBQUNNLE1BQU1DLGNBQWMsWUFBVztBQUV0QyxtQkFBbUI7QUFDSixTQUFTQztJQUN2QixPQUFPLElBQUlMLGtEQUFhQSxDQUV0Qiw0QkFBNEI7a0JBQzVCLDhEQUFDTTtRQUNBQyxPQUFPO1lBQ05DLFlBQVk7WUFDWkMsU0FBUztZQUNUQyxVQUFVO1lBQ1ZQLFFBQVE7WUFDUlEsZ0JBQWdCO1lBQ2hCVCxPQUFPO1FBQ1I7a0JBQ0E7Ozs7O2NBSUYsd0JBQXdCO0lBQ3hCO1FBQ0Msa0VBQWtFO1FBQ2xFLDJEQUEyRDtRQUMzRCxHQUFHRCxJQUFJO0lBQ1I7QUFFRiIsInNvdXJjZXMiOlsiL1VzZXJzL2pvc2hzbWl0aC9Db2RlL2xlYXBzYWtlL2xlYXBzYWtlL2FwcHMvY2xpZW50LXdlYi9zcmMvYXBwL2ljb24udHN4Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEltYWdlUmVzcG9uc2UgfSBmcm9tICduZXh0L29nJ1xuXG4vLyBJbWFnZSBtZXRhZGF0YVxuZXhwb3J0IGNvbnN0IHNpemUgPSB7XG5cdHdpZHRoOiAzMixcblx0aGVpZ2h0OiAzMixcbn1cbmV4cG9ydCBjb25zdCBjb250ZW50VHlwZSA9ICdpbWFnZS9wbmcnXG5cbi8vIEltYWdlIGdlbmVyYXRpb25cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEljb24oKSB7XG5cdHJldHVybiBuZXcgSW1hZ2VSZXNwb25zZShcblx0XHQoXG5cdFx0XHQvLyBJbWFnZVJlc3BvbnNlIEpTWCBlbGVtZW50XG5cdFx0XHQ8ZGl2XG5cdFx0XHRcdHN0eWxlPXt7XG5cdFx0XHRcdFx0YWxpZ25JdGVtczogJ2NlbnRlcicsXG5cdFx0XHRcdFx0ZGlzcGxheTogJ2ZsZXgnLFxuXHRcdFx0XHRcdGZvbnRTaXplOiAyNCxcblx0XHRcdFx0XHRoZWlnaHQ6ICcxMDAlJyxcblx0XHRcdFx0XHRqdXN0aWZ5Q29udGVudDogJ2NlbnRlcicsXG5cdFx0XHRcdFx0d2lkdGg6ICcxMDAlJyxcblx0XHRcdFx0fX1cblx0XHRcdD5cblx0XHRcdFx08J+QuFxuXHRcdFx0PC9kaXY+XG5cdFx0KSxcblx0XHQvLyBJbWFnZVJlc3BvbnNlIG9wdGlvbnNcblx0XHR7XG5cdFx0XHQvLyBGb3IgY29udmVuaWVuY2UsIHdlIGNhbiByZS11c2UgdGhlIGV4cG9ydGVkIGljb25zIHNpemUgbWV0YWRhdGFcblx0XHRcdC8vIGNvbmZpZyB0byBhbHNvIHNldCB0aGUgSW1hZ2VSZXNwb25zZSdzIHdpZHRoIGFuZCBoZWlnaHQuXG5cdFx0XHQuLi5zaXplLFxuXHRcdH1cblx0KVxufVxuIl0sIm5hbWVzIjpbIkltYWdlUmVzcG9uc2UiLCJzaXplIiwid2lkdGgiLCJoZWlnaHQiLCJjb250ZW50VHlwZSIsIkljb24iLCJkaXYiLCJzdHlsZSIsImFsaWduSXRlbXMiLCJkaXNwbGF5IiwiZm9udFNpemUiLCJqdXN0aWZ5Q29udGVudCJdLCJpZ25vcmVMaXN0IjpbXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/./src/app/icon.tsx\n");

/***/ }),

/***/ "(ssr)/./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true!":
/*!******************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true! ***!
  \******************************************************************************************************/
/***/ (() => {



/***/ }),

/***/ "../app-render/after-task-async-storage.external":
/*!***********************************************************************************!*\
  !*** external "next/dist/server/app-render/after-task-async-storage.external.js" ***!
  \***********************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/server/app-render/after-task-async-storage.external.js");

/***/ }),

/***/ "../app-render/work-async-storage.external":
/*!*****************************************************************************!*\
  !*** external "next/dist/server/app-render/work-async-storage.external.js" ***!
  \*****************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/server/app-render/work-async-storage.external.js");

/***/ }),

/***/ "./work-unit-async-storage.external":
/*!**********************************************************************************!*\
  !*** external "next/dist/server/app-render/work-unit-async-storage.external.js" ***!
  \**********************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/server/app-render/work-unit-async-storage.external.js");

/***/ }),

/***/ "next/dist/compiled/@vercel/og/index.node.js":
/*!**************************************************************!*\
  !*** external "next/dist/compiled/@vercel/og/index.node.js" ***!
  \**************************************************************/
/***/ ((module) => {

"use strict";
module.exports = import("next/dist/compiled/@vercel/og/index.node.js");;

/***/ }),

/***/ "next/dist/compiled/next-server/app-page.runtime.dev.js":
/*!*************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-page.runtime.dev.js" ***!
  \*************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/compiled/next-server/app-page.runtime.dev.js");

/***/ }),

/***/ "next/dist/compiled/next-server/app-route.runtime.dev.js":
/*!**************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-route.runtime.dev.js" ***!
  \**************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/compiled/next-server/app-route.runtime.dev.js");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/next"], () => (__webpack_exec__("(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Ficon%2Froute&page=%2Ficon%2Froute&appPaths=&pagePath=private-next-app-dir%2Ficon.tsx&appDir=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web%2Fsrc%2Fapp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=%2FUsers%2Fjoshsmith%2FCode%2Fleapsake%2Fleapsake%2Fapps%2Fclient-web&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!")));
module.exports = __webpack_exports__;

})();