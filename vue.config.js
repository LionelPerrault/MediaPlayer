const path = require("path");
function resolve(dir) {
  return path.join(__dirname, dir);
}

module.exports = {
  devServer: {
    disableHostCheck: true,
    port: process.env.DEV_SERVER_PORT || 8080,
  },
  pwa: {
    name: "YesPlayMusic",
    iconPaths: {
      favicon32: "img/icons/favicon-32x32.png",
    },
    themeColor: "#ffffff00",
    manifestOptions: {
      background_color: "#335eea",
    },
    // workboxOptions: {
    //   swSrc: "dev/sw.js",
    // },
  },
  pages: {
    index: {
      entry: "src/main.js",
      template: "public/index.html",
      filename: "index.html",
      title: "YesPlayMusic",
      chunks: ["main", "chunk-vendors", "chunk-common", "index"],
    },
  },
  chainWebpack(config) {
    config.module.rules.delete("svg");
    config.module.rule("svg").exclude.add(resolve("src/assets/icons")).end();
    config.module
      .rule("icons")
      .test(/\.svg$/)
      .include.add(resolve("src/assets/icons"))
      .end()
      .use("svg-sprite-loader")
      .loader("svg-sprite-loader")
      .options({
        symbolId: "icon-[name]",
      })
      .end();
  },
  // 添加插件的配置
  pluginOptions: {
    // electron-builder的配置文件
    electronBuilder: {
      externals: ["@nondanee/unblockneteasemusic", "@njzy/unblockneteasemusic"],
      builderOptions: {
        productName: "YesPlayMusic",
        copyright: "Copyright © YesPlayMusic",
        // compression: "maximum", // 机器好的可以打开，配置压缩，开启后会让 .AppImage 格式的客户端启动缓慢
        asar: true,
        publish: [
          {
            provider: "github",
            owner: "qier222",
            repo: "YesPlayMusic",
            vPrefixedTagName: true,
            releaseType: "draft",
          },
        ],
        directories: {
          output: "dist_electron",
        },
        mac: {
          target: [
            {
              target: "dmg",
              arch: ["arm64", "x64"],
            },
            {
              target: "zip",
              arch: ["arm64", "x64"],
              // arch: ["universal"]
            },
          ],
          artifactName: "${productName}-${arch}.${ext}",
          category: "public.app-category.music",
          darkModeSupport: true,
        },
        win: {
          target: ["nsis", "portable"],
          publisherName: "YesPlayMusic",
          icon: "build/icons/icon.ico",
          publish: ["github"],
        },
        linux: {
          target: ["AppImage", "tar.gz", "deb", "rpm", "snap", "pacman"],
          category: "Music",
          icon: "./build/icon.icns",
        },
        dmg: {
          icon: "build/icons/icon.icns",
        },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          perMachine: true,
        },
      },
      // 主线程的配置文件
      chainWebpackMainProcess: (config) => {
        config.plugin("define").tap((args) => {
          args[0]["IS_ELECTRON"] = true;
          return args;
        });
      },
      // 渲染线程的配置文件
      chainWebpackRendererProcess: (config) => {
        // 渲染线程的一些其他配置
        // Chain webpack config for electron renderer process only
        // The following example will set IS_ELECTRON to true in your app
        config.plugin("define").tap((args) => {
          args[0]["IS_ELECTRON"] = true;
          return args;
        });
      },
      // 主入口文件
      // mainProcessFile: 'src/main.js',
      mainProcessWatch: ["../netease_api/routes.js"],
      // mainProcessArgs: []
    },
  },
};
