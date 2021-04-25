import { getTrackDetail, scrobble, getMP3 } from "@/api/track";
import shuffle from "lodash/shuffle";
import { Howler, Howl } from "howler";
import { cacheTrackSource, getTrackSource } from "@/utils/db";
import { getAlbum } from "@/api/album";
import { getPlaylistDetail } from "@/api/playlist";
import { getArtist } from "@/api/artist";
import { personalFM, fmTrash } from "@/api/others";
import store from "@/store";
import { isAccountLoggedIn } from "@/utils/auth";
import { trackUpdateNowPlaying, trackScrobble } from "@/api/lastfm";

const electron =
  process.env.IS_ELECTRON === true ? window.require("electron") : null;
const ipcRenderer =
  process.env.IS_ELECTRON === true ? electron.ipcRenderer : null;

export default class {
  constructor() {
    this._enabled = false;
    this._repeatMode = "off"; // off | on | one
    this._shuffle = false; // true | false
    this._volume = 1; // 0 to 1
    this._volumeBeforeMuted = 1; // 用于保存静音前的音量
    this._list = [];
    this._current = 0; // current track index
    this._shuffledList = [];
    this._shuffledCurrent = 0;
    this._playlistSource = { type: "album", id: 123 };
    this._currentTrack = { id: 86827685 };
    this._playNextList = []; // 当这个list不为空时，会优先播放这个list的歌
    this._playing = false;
    this._isPersonalFM = false;
    this._personalFMTrack = { id: 0 };
    this._personalFMNextTrack = { id: 0 };

    this._howler = null;
    Object.defineProperty(this, "_howler", {
      enumerable: false,
    });

    this._init();
  }

  get repeatMode() {
    return this._repeatMode;
  }
  set repeatMode(mode) {
    if (!["off", "on", "one"].includes(mode)) {
      console.warn("repeatMode: invalid args, must be 'on' | 'off' | 'one'");
      return;
    }
    this._repeatMode = mode;
  }
  get shuffle() {
    return this._shuffle;
  }
  set shuffle(shuffle) {
    if (shuffle !== true && shuffle !== false) {
      console.warn("shuffle: invalid args, must be Boolean");
      return;
    }
    this._shuffle = shuffle;
    if (shuffle) {
      this._shuffleTheList();
    }
  }
  get volume() {
    return this._volume;
  }
  set volume(volume) {
    this._volume = volume;
    Howler.volume(volume);
  }
  get list() {
    return this.shuffle ? this._shuffledList : this._list;
  }
  set list(list) {
    this._list = list;
  }
  get current() {
    return this.shuffle ? this._shuffledCurrent : this._current;
  }
  set current(current) {
    if (this.shuffle) {
      this._shuffledCurrent = current;
    } else {
      this._current = current;
    }
  }
  get enabled() {
    return this._enabled;
  }
  get playing() {
    return this._playing;
  }
  get currentTrack() {
    return this._currentTrack;
  }
  get playlistSource() {
    return this._playlistSource;
  }
  get playNextList() {
    return this._playNextList;
  }
  get isPersonalFM() {
    return this._isPersonalFM;
  }
  get personalFMTrack() {
    return this._personalFMTrack;
  }

  _init() {
    Howler.autoUnlock = false;
    Howler.usingWebAudio = true;
    this._loadSelfFromLocalStorage();
    if (this._enabled) {
      this._replaceCurrentTrack(this._currentTrack.id, false).then(() => {
        this._howler.seek(localStorage.getItem("playerCurrentTrackTime") ?? 0);
        setInterval(
          () =>
            localStorage.setItem("playerCurrentTrackTime", this._howler.seek()),
          1000
        );
      }); // update audio source and init howler
      this._initMediaSession();
    }
    Howler.volume(this.volume);
    if (this._personalFMTrack.id === 0 || this._personalFMNextTrack.id === 0) {
      // init fm
      personalFM().then((result) => {
        this._personalFMTrack = result.data[0];
        this._personalFMNextTrack = result.data[1];
        return this._personalFMTrack;
      });
    }
  }
  _getNextTrack() {
    // 返回 [trackID, index]
    if (this._playNextList.length > 0) {
      let trackID = this._playNextList.shift();
      return [trackID, this.current];
    }
    if (this.list.length === this.current + 1 && this.repeatMode === "on") {
      // 当歌曲是列表最后一首 && 循环模式开启
      return [this.list[0], 0];
    }
    return [this.list[this.current + 1], this.current + 1];
  }
  _getPrevTrack() {
    if (this.current === 0 && this.repeatMode === "on") {
      // 当歌曲是列表第一首 && 循环模式开启
      return [this.list[this.list.length - 1], this.list.length - 1];
    }
    return [this.list[this.current - 1], this.current - 1];
  }
  async _shuffleTheList(firstTrackID = this._currentTrack.id) {
    let list = this._list.filter((tid) => tid !== firstTrackID);
    if (firstTrackID === "first") list = this._list;
    this._shuffledList = shuffle(list);
    if (firstTrackID !== "first") this._shuffledList.unshift(firstTrackID);
  }
  async _scrobble(track, time, completed = false) {
    console.debug(
      `[debug][Player.js] scrobble track 👉 ${track.name} by ${track.ar[0].name} 👉 time:${time} completed: ${completed}`
    );
    const trackDuration = ~~(track.dt / 1000);
    time = completed ? trackDuration : ~~time;
    scrobble({
      id: track.id,
      sourceid: this.playlistSource.id,
      time,
    });
    if (
      store.state.lastfm.key !== undefined &&
      (time >= trackDuration / 2 || time >= 240)
    ) {
      const timestamp = ~~(new Date().getTime() / 1000) - time;
      trackScrobble({
        artist: track.ar[0].name,
        track: track.name,
        timestamp,
        album: track.al.name,
        trackNumber: track.no,
        duration: trackDuration,
      });
    }
  }
  _playAudioSource(source, autoplay = true) {
    Howler.unload();
    this._howler = new Howl({
      src: [source],
      html5: true,
      format: ["mp3", "flac"],
    });
    if (autoplay) {
      this.play();
      document.title = `${this._currentTrack.name} · ${this._currentTrack.ar[0].name} - YesPlayMusic`;
    }
    this.setOutputDevice();
    this._howler.once("end", () => {
      this._nextTrackCallback();
    });
  }
  _getAudioSourceFromCache(id) {
    return getTrackSource(id).then((t) => {
      if (!t) return null;
      const source = URL.createObjectURL(new Blob([t.source]));
      return source;
    });
  }
  _getAudioSourceFromNetease(track) {
    if (isAccountLoggedIn()) {
      return getMP3(track.id).then((result) => {
        if (!result.data[0]) return null;
        if (!result.data[0].url) return null;
        if (result.data[0].freeTrialInfo !== null) return null; // 跳过只能试听的歌曲
        const source = result.data[0].url.replace(/^http:/, "https:");
        if (store.state.settings.automaticallyCacheSongs) {
          cacheTrackSource(track, source, result.data[0].br);
        }
        return source;
      });
    } else {
      return new Promise((resolve) => {
        resolve(`https://music.163.com/song/media/outer/url?id=${track.id}`);
      });
    }
  }
  _getAudioSourceFromUnblockMusic(track) {
    if (process.env.IS_ELECTRON !== true) return null;
    const source = ipcRenderer.sendSync("unblock-music", track);
    if (store.state.settings.automaticallyCacheSongs && source?.url) {
      // TODO: 将unblockMusic字样换成真正的来源（比如酷我咪咕等）
      cacheTrackSource(track, source.url, 128000, "unblockMusic");
    }
    return source?.url;
  }
  _getAudioSource(track) {
    return this._getAudioSourceFromCache(String(track.id))
      .then((source) => {
        return source ?? this._getAudioSourceFromNetease(track);
      })
      .then((source) => {
        return source ?? this._getAudioSourceFromUnblockMusic(track);
      });
  }
  _replaceCurrentTrack(
    id,
    autoplay = true,
    ifUnplayableThen = "playNextTrack"
  ) {
    if (autoplay && this._currentTrack.name) {
      this._scrobble(this.currentTrack, this._howler?.seek());
    }
    return getTrackDetail(id).then((data) => {
      let track = data.songs[0];
      this._currentTrack = track;
      this._updateMediaSessionMetaData(track);
      return this._getAudioSource(track).then((source) => {
        if (source) {
          this._playAudioSource(source, autoplay);
          this._cacheNextTrack();
          return source;
        } else {
          store.dispatch("showToast", `无法播放 ${track.name}`);
          ifUnplayableThen === "playNextTrack"
            ? this.playNextTrack()
            : this.playPrevTrack();
        }
      });
    });
  }
  _cacheNextTrack() {
    let nextTrackID = this._isPersonalFM
      ? this._personalFMNextTrack.id
      : this._getNextTrack()[0];
    if (!nextTrackID) return;
    getTrackDetail(nextTrackID).then((data) => {
      let track = data.songs[0];
      this._getAudioSource(track);
    });
  }
  _loadSelfFromLocalStorage() {
    const player = JSON.parse(localStorage.getItem("player"));
    if (!player) return;
    for (const [key, value] of Object.entries(player)) {
      this[key] = value;
    }
  }
  _initMediaSession() {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => {
        this.play();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        this.playPrevTrack();
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        this.playNextTrack();
      });
      navigator.mediaSession.setActionHandler("stop", () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler("seekto", (event) => {
        this.seek(event.seekTime);
        this._updateMediaSessionPositionState();
      });
      navigator.mediaSession.setActionHandler("seekbackward", (event) => {
        this.seek(this.seek() - (event.seekOffset || 10));
        this._updateMediaSessionPositionState();
      });
      navigator.mediaSession.setActionHandler("seekforward", (event) => {
        this.seek(this.seek() + (event.seekOffset || 10));
        this._updateMediaSessionPositionState();
      });
    }
  }
  _updateMediaSessionMetaData(track) {
    if ("mediaSession" in navigator === false) {
      return;
    }
    let artists = track.ar.map((a) => a.name);
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: track.name,
      artist: artists.join(","),
      album: track.al.name,
      artwork: [
        {
          src: track.al.picUrl + "?param=512y512",
          type: "image/jpg",
          sizes: "512x512",
        },
      ],
    });
  }
  _updateMediaSessionPositionState() {
    if ("mediaSession" in navigator === false) {
      return;
    }
    if ("setPositionState" in navigator.mediaSession) {
      navigator.mediaSession.setPositionState({
        duration: ~~(this.currentTrack.dt / 1000),
        playbackRate: 1.0,
        position: this.seek(),
      });
    }
  }
  _nextTrackCallback() {
    this._scrobble(this._currentTrack, 0, true);
    if (!this.isPersonalFM && this.repeatMode === "one") {
      this._replaceCurrentTrack(this._currentTrack.id);
    } else {
      this.playNextTrack();
    }
  }
  _loadPersonalFMNextTrack() {
    return personalFM().then((result) => {
      this._personalFMNextTrack = result.data[0];
      return this._personalFMNextTrack;
    });
  }
  _playDiscordPresence(track, seekTime = 0) {
    if (
      process.env.IS_ELECTRON !== true ||
      store.state.settings.enableDiscordRichPresence === false
    ) {
      return null;
    }
    let copyTrack = { ...track };
    copyTrack.dt -= seekTime * 1000;
    ipcRenderer.send("playDiscordPresence", copyTrack);
  }
  _pauseDiscordPresence(track) {
    if (
      process.env.IS_ELECTRON !== true ||
      store.state.settings.enableDiscordRichPresence === false
    ) {
      return null;
    }
    ipcRenderer.send("pauseDiscordPresence", track);
  }

  currentTrackID() {
    const { list, current } = this._getListAndCurrent();
    return list[current];
  }
  appendTrack(trackID) {
    this.list.append(trackID);
  }
  playNextTrack(isFM = false) {
    if (this._isPersonalFM || isFM) {
      this._isPersonalFM = true;
      this._personalFMTrack = this._personalFMNextTrack;
      this._replaceCurrentTrack(this._personalFMTrack.id);
      this._loadPersonalFMNextTrack();
      return true;
    }
    // TODO: 切换歌曲时增加加载中的状态
    const [trackID, index] = this._getNextTrack();
    if (trackID === undefined) {
      this._howler.stop();
      this._playing = false;
      return false;
    }
    this.current = index;
    this._replaceCurrentTrack(trackID);
    return true;
  }
  playPrevTrack() {
    const [trackID, index] = this._getPrevTrack();
    if (trackID === undefined) return false;
    this.current = index;
    this._replaceCurrentTrack(trackID, true, "playPrevTrack");
    return true;
  }
  saveSelfToLocalStorage() {
    let player = {};
    for (let [key, value] of Object.entries(this)) {
      if (key === "_playing") continue;
      player[key] = value;
    }

    localStorage.setItem("player", JSON.stringify(player));
  }

  pause() {
    this._howler.pause();
    this._playing = false;
    document.title = "YesPlayMusic";
    this._pauseDiscordPresence(this._currentTrack);
  }
  play() {
    if (this._howler.playing()) return;
    this._howler.play();
    this._playing = true;
    document.title = `${this._currentTrack.name} · ${this._currentTrack.ar[0].name} - YesPlayMusic`;
    this._playDiscordPresence(this._currentTrack, this.seek());
    if (store.state.lastfm.key !== undefined) {
      trackUpdateNowPlaying({
        artist: this.currentTrack.ar[0].name,
        track: this.currentTrack.name,
        album: this.currentTrack.al.name,
        trackNumber: this.currentTrack.no,
        duration: ~~(this.currentTrack.dt / 1000),
      });
    }
  }
  playOrPause() {
    if (this._howler.playing()) {
      this.pause();
    } else {
      this.play();
    }
  }
  seek(time = null) {
    if (time !== null) {
      this._howler.seek(time);
      if (this._playing)
        this._playDiscordPresence(this._currentTrack, this.seek());
    }
    return this._howler === null ? 0 : this._howler.seek();
  }
  mute() {
    if (this.volume === 0) {
      this.volume = this._volumeBeforeMuted;
    } else {
      this._volumeBeforeMuted = this.volume;
      this.volume = 0;
    }
  }
  setOutputDevice() {
    if (this._howler._sounds.length <= 0 || !this._howler._sounds[0]._node) {
      return;
    }
    this._howler._sounds[0]._node.setSinkId(store.state.settings.outputDevice);
  }

  replacePlaylist(
    trackIDs,
    playlistSourceID,
    playlistSourceType,
    autoPlayTrackID = "first"
  ) {
    this._isPersonalFM = false;
    if (!this._enabled) this._enabled = true;
    this.list = trackIDs;
    this.current = 0;
    this._playlistSource = {
      type: playlistSourceType,
      id: playlistSourceID,
    };
    if (this.shuffle) this._shuffleTheList(autoPlayTrackID);
    if (autoPlayTrackID === "first") {
      this._replaceCurrentTrack(this.list[0]);
    } else {
      this.current = trackIDs.indexOf(autoPlayTrackID);
      this._replaceCurrentTrack(autoPlayTrackID);
    }
  }
  playAlbumByID(id, trackID = "first") {
    getAlbum(id).then((data) => {
      let trackIDs = data.songs.map((t) => t.id);
      this.replacePlaylist(trackIDs, id, "album", trackID);
    });
  }
  playPlaylistByID(id, trackID = "first", noCache = false) {
    console.debug(
      `[debug][Player.js] playPlaylistByID 👉 id:${id} trackID:${trackID} noCache:${noCache}`
    );
    getPlaylistDetail(id, noCache).then((data) => {
      let trackIDs = data.playlist.trackIds.map((t) => t.id);
      this.replacePlaylist(trackIDs, id, "playlist", trackID);
    });
  }
  playArtistByID(id, trackID = "first") {
    getArtist(id).then((data) => {
      let trackIDs = data.hotSongs.map((t) => t.id);
      this.replacePlaylist(trackIDs, id, "artist", trackID);
    });
  }
  playTrackOnListByID(id, listName = "default") {
    if (listName === "default") {
      this._current = this._list.findIndex((t) => t === id);
    }
    this._replaceCurrentTrack(id);
  }
  addTrackToPlayNext(trackID, playNow = false) {
    this._playNextList.push(trackID);
    if (playNow) this.playNextTrack();
  }
  playPersonalFM() {
    this._isPersonalFM = true;
    if (!this._enabled) this._enabled = true;
    if (this._currentTrack.id !== this._personalFMTrack.id) {
      this._replaceCurrentTrack(this._personalFMTrack.id).then(() =>
        this.playOrPause()
      );
    } else {
      this.playOrPause();
    }
  }
  moveToFMTrash() {
    this._isPersonalFM = true;
    this.playNextTrack();
    fmTrash(this._personalFMTrack.id);
  }

  sendSelfToIpcMain() {
    if (process.env.IS_ELECTRON !== true) return false;
    ipcRenderer.send("player", {
      playing: this.playing,
      likedCurrentTrack: store.state.liked.songs.includes(this.currentTrack.id),
    });
  }
}
