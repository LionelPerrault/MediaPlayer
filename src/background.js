"use strict";
import { app, protocol, BrowserWindow, shell, dialog } from "electron";
import { createProtocol } from "vue-cli-plugin-electron-builder/lib";
import installExtension, { VUEJS_DEVTOOLS } from "electron-devtools-installer";
import { startNeteaseMusicApi } from "./electron/services";
import { initIpcMain } from "./electron/ipcMain.js";
import { createMenu } from "./electron/menu";
import { createTouchBar } from "./electron/touchBar";
import { createDockMenu } from "./electron/dockMenu";
import { autoUpdater } from "electron-updater";
import express from "express";
import expressProxy from "express-http-proxy";
import Store from "electron-store";

class Background {
  constructor() {
    this.window = null;
    this.store = new Store({
      windowWidth: {
        width: { type: "number", default: 1440 },
        height: { type: "number", default: 840 },
      },
    });
    this.neteaseMusicAPI = null;
    this.expressApp = null;
    this.willQuitApp = process.platform === "darwin" ? false : true;

    this.init();
  }

  init() {
    console.log("initializing");

    // Make sure the app is singleton.
    if (!app.requestSingleInstanceLock()) return app.quit();

    // start netease music api
    this.neteaseMusicAPI = startNeteaseMusicApi();

    // create Express app
    this.createExpressApp();

    // init ipcMain
    initIpcMain(this.window);

    // Scheme must be registered before the app is ready
    protocol.registerSchemesAsPrivileged([
      { scheme: "app", privileges: { secure: true, standard: true } },
    ]);

    // handle app events
    this.handleAppEvents();
  }

  async initDevtools() {
    // Install Vue Devtools extension
    try {
      await installExtension(VUEJS_DEVTOOLS);
    } catch (e) {
      console.error("Vue Devtools failed to install:", e.toString());
    }

    // Exit cleanly on request from parent process in development mode.
    if (process.platform === "win32") {
      process.on("message", (data) => {
        if (data === "graceful-exit") {
          app.quit();
        }
      });
    } else {
      process.on("SIGTERM", () => {
        app.quit();
      });
    }
  }

  createExpressApp() {
    console.log("creating express app");

    const expressApp = express();
    expressApp.use("/", express.static(__dirname + "/"));
    expressApp.use("/api", expressProxy("http://127.0.0.1:10754"));
    this.expressApp = expressApp.listen(27232);
  }

  createWindow() {
    console.log("creating app window");

    this.window = new BrowserWindow({
      width: this.store.get("window.width") | 1440,
      height: this.store.get("window.height") | 840,
      minWidth: 768,
      minHeight: 608,
      titleBarStyle: "hiddenInset",
      webPreferences: {
        webSecurity: false,
        nodeIntegration: true,
      },
    });

    // hide menu bar on Microsoft Windows and Linux
    this.window.setMenuBarVisibility(false);

    if (process.env.WEBPACK_DEV_SERVER_URL) {
      // Load the url of the dev server if in development mode
      this.window.loadURL(process.env.WEBPACK_DEV_SERVER_URL);
      if (!process.env.IS_TEST) this.window.webContents.openDevTools();
    } else {
      createProtocol("app");
      this.window.loadURL("http://localhost:27232");
    }
  }

  checkForUpdates() {
    autoUpdater.checkForUpdatesAndNotify();

    const showNewVersionMessage = (info) => {
      dialog
        .showMessageBox({
          title: "发现新版本 v" + info.version,
          message: "发现新版本 v" + info.version,
          detail: "是否前往 Github 下载新版本安装包？",
          buttons: ["下载", "取消"],
          type: "question",
          noLink: true,
        })
        .then((result) => {
          if (result.response === 0) {
            shell.openExternal(
              "https://github.com/qier222/YesPlayMusic/releases"
            );
          }
        });
    };

    if (process.platform === "darwin") {
      autoUpdater.on("update-available", (info) => {
        showNewVersionMessage(info);
      });
    }
  }

  handleWindowEvents() {
    this.window.once("ready-to-show", () => {
      console.log("windows ready-to-show event");
      this.window.show();
    });

    this.window.on("close", (e) => {
      console.log("windows close event");
      if (this.willQuitApp) {
        /* the user tried to quit the app */
        this.window = null;
        app.quit();
      } else {
        /* the user only tried to close the window */
        e.preventDefault();
        this.window.hide();
      }
    });

    this.window.on("resize", () => {
      let { height, width } = this.window.getBounds();
      this.store.set("window", { height, width });
    });

    this.window.webContents.on("new-window", function (e, url) {
      e.preventDefault();
      shell.openExternal(url);
    });
  }

  handleAppEvents() {
    app.on("ready", async () => {
      // This method will be called when Electron has finished
      // initialization and is ready to create browser windows.
      // Some APIs can only be used after this event occurs.
      console.log("app ready event");

      // for development
      if (process.env.NODE_ENV !== "production") {
        this.initDevtools();
      }

      // create window
      this.createWindow();
      this.handleWindowEvents();

      // check for updates
      this.checkForUpdates();

      // create menu
      createMenu(this.window);

      // create dock menu for macOS
      app.dock.setMenu(createDockMenu(this.window));

      // create touch bar
      this.window.setTouchBar(createTouchBar(this.window));
    });

    app.on("activate", () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      console.log("app activate event");
      if (this.window === null) {
        this.createWindow();
      } else {
        this.window.show();
      }
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });

    app.on("before-quit", () => {
      this.willQuitApp = true;
    });

    app.on("quit", () => {
      this.expressApp.close();
    });
  }
}

new Background();
