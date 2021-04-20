import { playlistCategories } from "@/utils/staticData";

console.log("[debug][initLocalStorage.js]");
const enabledPlaylistCategories = playlistCategories
  .filter((c) => c.enable)
  .map((c) => c.name);

let localStorage = {
  player: {},
  settings: {
    lang: null,
    appearance: "auto",
    musicQuality: 320000,
    lyricFontSize: 28,
    outputDevice: "default",
    showPlaylistsByAppleMusic: true,
    showUnavailableSongInGreyStyle: true,
    automaticallyCacheSongs: false,
    cacheLimit: false,
    nyancatStyle: false,
    showLyricsTranslation: true,
    showLyricsDynamicBackground: false,
    minimizeToTray: false,
    enableDiscordRichPresence: false,
    enableGlobalShortcut: true,
    showLibraryDefault: false,
    enabledPlaylistCategories,
  },
  data: {
    user: {},
    likedSongPlaylistID: 0,
    lastRefreshCookieDate: 0,
    loginMode: null,
  },
};

if (process.env.IS_ELECTRON === true) {
  localStorage.settings.automaticallyCacheSongs = true;
  localStorage.settings.showUnavailableSongInGreyStyle = false;
}

export default localStorage;
