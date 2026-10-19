const $ = (id) => document.getElementById(id);
const audio = () => $("audio-el");

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return decodeURIComponent(parts.pop().split(";").shift());
  return "";
}

// ---------- Library ----------
let allTracks = []; // cached, so search filtering doesn't need a refetch
let isLibraryOwner = false;
let ownerToken = localStorage.getItem("lt_owner_token") || "";

async function ensureOwnerAccess() {
  try {
    const res = await fetch("/api/owner-token", {
      credentials: "same-origin",
    });

    if (res.ok) {
      const { ownerToken: serverToken } = await res.json();
      ownerToken = serverToken;
      localStorage.setItem("lt_owner_token", ownerToken);
      document.cookie = `lt_owner=${encodeURIComponent(ownerToken)}; path=/; SameSite=Lax`;
      isLibraryOwner = true;
      return true;
    }

    const claimRes = await fetch("/api/claim-owner", {
      method: "POST",
      credentials: "same-origin",
    });

    if (!claimRes.ok) {
      isLibraryOwner = false;
      return false;
    }

    const { ownerToken: serverToken } = await claimRes.json();
    ownerToken = serverToken;
    localStorage.setItem("lt_owner_token", ownerToken);
    document.cookie = `lt_owner=${encodeURIComponent(ownerToken)}; path=/; SameSite=Lax`;
    isLibraryOwner = true;
    return true;
  } catch (e) {
    console.error("Failed to initialise library permissions", e);
    isLibraryOwner = false;
    return false;
  }
}

async function initLibraryAccess() {
  try {
    const ownerCookie = getCookie("lt_owner");
    if (ownerCookie) {
      ownerToken = ownerCookie;
    }

    const hasOwnerAccess = await ensureOwnerAccess();
    if (!hasOwnerAccess) {
      ownerToken = "";
      localStorage.removeItem("lt_owner_token");
      document.cookie = "lt_owner=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
      isLibraryOwner = false;
    }

    await refreshPlaylists();
    renderTrackList(allTracks);
    renderPlaylistSelect();
    renderActivePlaylistTracks();
  } catch (e) {
    console.error("Failed to initialise library permissions", e);
    isLibraryOwner = false;
  }
}

async function refreshTrackList() {
  const res = await fetch("/api/tracks");
  const { tracks } = await res.json();
  allTracks = tracks;
  renderTrackList(allTracks);
}

async function addTrackToActivePlaylist(track) {
  if (!activePlaylist) return;
  const res = await fetch(`/api/playlists/${encodeURIComponent(activePlaylist)}/tracks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-owner-token": ownerToken,
    },
    body: JSON.stringify({ trackId: track.id, roomCode: currentRoomCode }),
  });
  if (!res.ok) {
    console.error("Add track to playlist failed", await res.text());
    return;
  }
  await refreshPlaylists();
}

function queueTrackAfterCurrent(track) {
  const normalized = normalizeTrack(track);
  if (!normalized || !normalized.url) return;

  if (playbackQueue.length === 0 || currentQueueIndex < 0) {
    queueTrackForPlayback(normalized);
    return;
  }

  const insertIndex = currentQueueIndex + 1;
  const existingIndex = playbackQueue.findIndex((queued) => queued.id === normalized.id);
  if (existingIndex >= 0) {
    if (existingIndex === insertIndex) return;
    playbackQueue.splice(existingIndex, 1);
  }

  playbackQueue.splice(insertIndex, 0, normalized);
  if (existingIndex > currentQueueIndex) {
    currentQueueIndex = currentQueueIndex;
  }
  renderQueueList();
}

function renderTrackList(tracks) {
  const list = $("track-list");
  list.innerHTML = "";
  tracks.forEach((t) => {
    const li = document.createElement("li");

    const nameSpan = document.createElement("span");
    nameSpan.className = "track-name";
    nameSpan.textContent = t.name;
    nameSpan.addEventListener("click", () => playTrack(t));

    const menuWrap = document.createElement("div");
    menuWrap.className = "track-menu-wrap";

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "track-menu-trigger";
    menuButton.textContent = "⋯";
    menuButton.title = "More actions";
    menuButton.setAttribute("aria-label", `More actions for ${t.name}`);

    const menu = document.createElement("div");
    menu.className = "track-menu hidden";

    const queueNextBtn = document.createElement("button");
    queueNextBtn.type = "button";
    queueNextBtn.textContent = "Queue next";
    queueNextBtn.className = "queue-next";
    queueNextBtn.setAttribute("data-action", "queue-next");
    queueNextBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      queueTrackAfterCurrent(t);
      menu.classList.add("hidden");
    });

    const addToPlaylistBtn = document.createElement("button");
    addToPlaylistBtn.type = "button";
    addToPlaylistBtn.textContent = "Add to playlist";
    addToPlaylistBtn.className = "add-to-playlist";
    addToPlaylistBtn.setAttribute("data-action", "add to playlist");
    addToPlaylistBtn.disabled = !isLibraryOwner || !activePlaylist;
    addToPlaylistBtn.title = activePlaylist ? `Add to ${activePlaylist}` : "Choose a playlist first";
    addToPlaylistBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      menu.classList.add("hidden");
      if (!activePlaylist) return;
      await addTrackToActivePlaylist(t);
    });

    menu.appendChild(queueNextBtn);
    menu.appendChild(addToPlaylistBtn);
    menuWrap.appendChild(menuButton);
    menuWrap.appendChild(menu);

    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = menu.classList.contains("hidden");
      document.querySelectorAll(".track-menu").forEach((panel) => panel.classList.add("hidden"));
      menu.classList.toggle("hidden", !open);
    });

    document.addEventListener("click", (event) => {
      if (!menuWrap.contains(event.target)) {
        menu.classList.add("hidden");
      }
    });

    li.appendChild(nameSpan);
    li.appendChild(menuWrap);
    list.appendChild(li);
  });
  if (tracks.length === 0) {
    const li = document.createElement("li");
    li.textContent = allTracks.length === 0 ? "No tracks uploaded yet." : "No matches.";
    li.style.cursor = "default";
    list.appendChild(li);
  }
}

$("track-search-input").addEventListener("input", () => {
  const q = $("track-search-input").value.trim().toLowerCase();
  const filtered = q ? allTracks.filter((t) => t.name.toLowerCase().includes(q)) : allTracks;
  renderTrackList(filtered);
});

$("upload-btn").addEventListener("click", async () => {
  const files = $("file-input").files;
  if (!files.length) return;
  const formData = new FormData();
  for (const f of files) formData.append("tracks", f);
  $("upload-status").textContent = "Uploading...";
  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error(await res.text());
    $("upload-status").textContent = "Uploaded ✓";
    $("file-input").value = "";
    refreshTrackList();
  } catch (e) {
    console.error(e);
    $("upload-status").textContent = "Upload failed — see console.";
  }
});

// ---------- Playlists ----------
let allPlaylists = {};
let activePlaylist = null;
let currentRoomCode = null;
let myName = "";

async function refreshPlaylists() {
  const roomCode = currentRoomCode || "";
  const res = await fetch(roomCode ? `/api/playlists?roomCode=${encodeURIComponent(roomCode)}` : "/api/playlists");
  const { playlists } = await res.json();
  allPlaylists = playlists || {};
  renderPlaylistSelect();
  renderActivePlaylistTracks();
}

function renderPlaylistSelect() {
  const select = $("playlist-select");
  const previousValue = activePlaylist || "";
  select.innerHTML = '<option value="">All tracks (no playlist selected)</option>';

  Object.keys(allPlaylists).forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${name} (${(allPlaylists[name] || []).length})`;
    select.appendChild(opt);
  });

  if (previousValue && allPlaylists[previousValue]) {
    select.value = previousValue;
    activePlaylist = previousValue;
  } else {
    activePlaylist = null;
  }

  $("delete-playlist-btn").classList.toggle("hidden", !activePlaylist);
  $("create-playlist-btn").disabled = false;
  $("new-playlist-input").disabled = false;
}

function renderActivePlaylistTracks() {
  const list = $("playlist-track-list");
  list.innerHTML = "";

  if (!activePlaylist) {
    const li = document.createElement("li");
    li.textContent = "Select or create a playlist above to see its tracks.";
    li.style.cursor = "default";
    list.appendChild(li);
    return;
  }

  const ids = allPlaylists[activePlaylist] || [];
  if (!ids.length) {
    const li = document.createElement("li");
    li.textContent = "No tracks in this playlist yet — use + in the library on the left.";
    li.style.cursor = "default";
    list.appendChild(li);
    return;
  }

  allTracks.forEach((track) => {
    if (!ids.includes(track.id)) return;
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.className = "track-name";
    nameSpan.textContent = track.name;
    nameSpan.addEventListener("click", () => playTrack(track));

    li.appendChild(nameSpan);
    list.appendChild(li);
  });
}

$("playlist-select").addEventListener("change", () => {
  activePlaylist = $("playlist-select").value || null;
  $("delete-playlist-btn").classList.toggle("hidden", !activePlaylist);
  renderTrackList(allTracks);
  renderActivePlaylistTracks();
});

$("create-playlist-btn").addEventListener("click", async () => {
  const name = $("new-playlist-input").value.trim();
  if (!name) return;
  const res = await fetch("/api/playlists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-owner-token": ownerToken,
    },
    body: JSON.stringify({ name, roomCode: currentRoomCode }),
  });
  if (!res.ok) {
    console.error("Playlist create failed", await res.text());
    return;
  }
  $("new-playlist-input").value = "";
  activePlaylist = name;
  await refreshPlaylists();
  $("playlist-select").value = name;
  renderTrackList(allTracks);
});

$("delete-playlist-btn").addEventListener("click", async () => {
  if (!activePlaylist) return;
  if (!confirm(`Delete the playlist "${activePlaylist}"? This won't delete the songs themselves.`)) return;
  const res = await fetch(`/api/playlists/${encodeURIComponent(activePlaylist)}?roomCode=${encodeURIComponent(currentRoomCode || "")}`, {
    method: "DELETE",
    headers: { "x-owner-token": ownerToken },
  });
  if (!res.ok) {
    console.error("Playlist delete failed", await res.text());
    return;
  }
  activePlaylist = null;
  await refreshPlaylists();
  renderTrackList(allTracks);
});

// ---------- Room / sync ----------
let socket = null;
let isHost = false;
let currentTrack = null; // {id, name, url}
let playbackQueue = [];
let currentQueueIndex = -1;
let suppressDrift = false; // briefly ignore drift-correction while a scheduled action is pending
let lastReportedDiffMs = 0;

// clockOffsetMs: our best estimate of (serverClock - ourLocalClock).
// Once calibrated, getServerNow() gives both computers a shared sense of "now",
// even though their system clocks are never perfectly in sync.
let clockOffsetMs = 0;
function getServerNow() {
  return Date.now() + clockOffsetMs;
}

// How far in the future we schedule a play/pause/track-change to actually
// fire. Needs to comfortably cover socket round-trip time + audio decode
// startup on both ends. If a message arrives late, we just fire immediately
// instead of waiting (see schedulePlayback below).
const LEAD_MS = 600;
const TRACKED_SYNC_INTERVAL_MS = 150;
const FOLLOWER_SYNC_INTERVAL_MS = 800;
const FOLLOWER_SYNC_THRESHOLD_MS = 800;
const HOST_HEARTBEAT_INTERVAL_MS = 250;
// Only correct the follower when the drift is large enough to be audible.
const DRIFT_THRESHOLD_SEC = 0.7;
let followerSyncState = null;
let followerLoopToken = 0;

function showPanel(id) {
  $(id).classList.remove("hidden");
}

function updateHostBadge() {
  $("host-badge").textContent = isHost ? "You have control" : "Following";
}

function updateSyncStatus(diffMs) {
  const node = $("sync-status");
  if (!node) return;
  lastReportedDiffMs = diffMs;

  if (diffMs <= 120) {
    node.textContent = "Sync: good";
    node.className = "sync-status good";
  } else if (diffMs <= 400) {
    node.textContent = `Sync: slight drift (${Math.round(diffMs)}ms)`;
    node.className = "sync-status warn";
  } else {
    node.textContent = `Sync: correcting (${Math.round(diffMs)}ms)`;
    node.className = "sync-status bad";
  }
}

function getDisplayName() {
  const typed = $("display-name-input").value.trim();
  if (!typed) {
    alert("Please enter your name before joining a room.");
    return "";
  }
  localStorage.setItem("lt_display_name", typed);
  return typed;
}

function updateRoomBadge(count, names = []) {
  $("room-count-text").textContent = String(count || 0);
  const visibleNames = (names || []).filter(Boolean);
  const list = $("room-names-inline");
  list.innerHTML = "";

  if (!visibleNames.length) {
    const item = document.createElement("li");
    item.textContent = "No one else here";
    list.appendChild(item);
  } else {
    visibleNames.forEach((name) => {
      const item = document.createElement("li");
      item.textContent = name;
      list.appendChild(item);
    });
  }

  $("room-status-badge").classList.remove("hidden");
}

function toggleRoomBadgeMenu(forceOpen) {
  const menu = $("room-badge-menu");
  const button = $("room-badge-button");
  if (!menu || !button) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !shouldOpen);
  button.setAttribute("aria-expanded", String(shouldOpen));
}

$("room-badge-button").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleRoomBadgeMenu();
});

document.addEventListener("click", (event) => {
  const badge = $("room-status-badge");
  const target = event.target;
  if (badge && !badge.contains(target)) {
    toggleRoomBadgeMenu(false);
  }
});

$("join-room-btn").addEventListener("click", async () => {
  if (socket) return;
  const name = getDisplayName();
  if (!name) return;

  let code = $("room-code-input").value.trim().toUpperCase();
  if (!code) {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
    $("room-code-input").value = code;
  }
  currentRoomCode = code;
  $("room-share-hint").textContent =
    `Share this room code with your friend: ${code} (or send them the link: ${window.location.origin}/?room=${code})`;
  localStorage.setItem("lt_last_room", code);
  connectSocket(code);
});

function connectSocket(roomCode) {
  socket = io();
  const name = getDisplayName();
  myName = name;

  socket.on("connect", () => {
    calibrateClock().then(() => {
      socket.emit("join-room", { roomCode, name });
    });
  });

  socket.on("joined", ({ isHost: hostFlag, lastState }) => {
    ["library-panel", "player-panel", "chat-panel"].forEach(showPanel);
    refreshTrackList();
    refreshPlaylists();
    isHost = hostFlag;
    updateHostBadge();
    if (lastState && !isHost) schedulePlayback(lastState);
  });

  socket.on("host-changed", () => {
    isHost = false;
    updateHostBadge();
  });

  socket.on("playback-update", (state) => {
    if (!isHost) {
      followerSyncState = normalizePlaybackState(state) || followerSyncState;
      schedulePlayback(state);
    }
  });

  socket.on("drift-sync", (state) => {
    if (!isHost) {
      followerSyncState = normalizePlaybackState(state) || followerSyncState;
      applyDriftCorrection(state);
    }
  });

  socket.on("peer-joined", ({ name }) => { logChat("system", `${name} joined the room`); showToast(`👋 ${name} joined`, "good"); });
  socket.on("peer-left", ({ name }) => { logChat("system", `${name} left the room`); showToast(`🚪 ${name} left`, "warn"); });
  socket.on("chat", ({ name, text }) => {
    logChat(name, text);
    if (name !== myName && !chatInView()) showToast(`💬 ${name}: ${String(text).slice(0, 60)}`, "chat", () => $("chat-panel").scrollIntoView({ behavior: "smooth", block: "center" }));
  });
  socket.on("join-error", ({ message }) => {
    showToast(message || "Unable to join this room.", "bad");
    $("room-share-hint").textContent = message || "Unable to join this room.";
    socket.disconnect();
    socket = null;
    currentRoomCode = null;
  });

  socket.on("room-count", ({ count, names = [] }) => {
    updateRoomBadge(count, names);
  });

  // Recalibrate periodically — clocks can slowly drift apart over a long
  // listening session, and this keeps the shared "now" accurate.
  setInterval(() => { if (socket) calibrateClock(); }, 30000);
}

// ---------- Clock calibration ----------
// Classic NTP-style approach: ping the server a few times, measure round-trip
// time for each, and trust the sample with the smallest round-trip (least
// network jitter) most. offset = serverTime - (sendTime + roundTrip/2).
function calibrateClock() {
  return new Promise((resolve) => {
    let best = null;
    let count = 0;
    const totalSamples = 6;

    function onReply({ clientTime, serverTime }) {
      const now = Date.now();
      const rtt = now - clientTime;
      const offset = serverTime - (clientTime + rtt / 2);
      if (!best || rtt < best.rtt) best = { rtt, offset };
      count++;
      if (count < totalSamples) {
        setTimeout(ping, 120);
      } else {
        socket.off("time-sync-reply", onReply);
        clockOffsetMs = best.offset;
        resolve();
      }
    }

    function ping() {
      socket.emit("time-sync", Date.now());
    }

    socket.on("time-sync-reply", onReply);
    ping();
  });
}

// ---------- Shared playback timing (host + follower use the same server clock) ----------
function normalizePlaybackState(state, fallbackTrack = currentTrack) {
  if (!state) return null;

  const trackId = state.trackId || state.id || fallbackTrack?.id;
  const track = {
    id: trackId,
    trackId: trackId,
    name: state.name || fallbackTrack?.name || "Unknown track",
    url: state.url || fallbackTrack?.url,
  };

  if (!track.id || !track.url) return null;

  return {
    ...track,
    isPlaying: !!state.isPlaying,
    positionMs: Number.isFinite(state.positionMs) ? state.positionMs : Number.isFinite(state.positionAtScheduleMs) ? state.positionAtScheduleMs : 0,
    serverTime: Number.isFinite(state.serverTime) ? state.serverTime : Date.now(),
    scheduledServerTime: Number.isFinite(state.scheduledServerTime) ? state.scheduledServerTime : state.serverTime,
  };
}

function buildScheduledState(isPlaying, positionMs) {
  return {
    trackId: currentTrack.id,
    name: currentTrack.name,
    url: currentTrack.url,
    isPlaying,
    positionMs,
    serverTime: getServerNow(),
    scheduledServerTime: getServerNow() + LEAD_MS,
  };
}

function normalizeTrack(track) {
  if (!track) return null;
  return {
    id: track.id || track.trackId || track.name,
    name: track.name || "Unknown track",
    url: track.url || "",
  };
}

function renderQueueList() {
  const list = $("queue-list");
  if (!list) return;

  list.innerHTML = "";

  if (!playbackQueue.length) {
    const li = document.createElement("li");
    li.className = "queue-empty";
    li.textContent = "No songs queued yet.";
    list.appendChild(li);
    return;
  }

  playbackQueue.forEach((track, index) => {
    const li = document.createElement("li");
    if (index === currentQueueIndex) li.classList.add("queue-current");
    li.textContent = `${index === currentQueueIndex ? "Now: " : ""}${track.name}`;
    list.appendChild(li);
  });
}

function toggleQueuePanel(forceOpen) {
  const panel = $("queue-panel");
  if (!panel) return;
  const nextState = typeof forceOpen === "boolean" ? forceOpen : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !nextState);
}

function queueTrackForPlayback(track) {
  const normalized = normalizeTrack(track);
  if (!normalized || !normalized.url) return;

  const existingIndex = playbackQueue.findIndex((queued) => queued.id === normalized.id);
  if (existingIndex >= 0) {
    currentQueueIndex = existingIndex;
    renderQueueList();
    return;
  }

  playbackQueue.push(normalized);
  currentQueueIndex = playbackQueue.length - 1;
  renderQueueList();
}

function getCurrentPlaylistTrackIds() {
  if (!activePlaylist || !allPlaylists[activePlaylist]) return [];
  return allPlaylists[activePlaylist].map((id) => id).filter(Boolean);
}

function getPlaylistNextTrack(currentId) {
  const playlistIds = getCurrentPlaylistTrackIds();
  if (!playlistIds.length) return null;

  const currentIndex = playlistIds.indexOf(currentId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % playlistIds.length : 0;
  const nextId = playlistIds[nextIndex];
  return allTracks.find((track) => track.id === nextId) || null;
}

function getNextQueuedTrack() {
  if (playbackQueue.length === 0 || currentQueueIndex < 0) return null;
  const nextIndex = currentQueueIndex + 1;
  if (nextIndex >= playbackQueue.length) return null;
  return playbackQueue[nextIndex];
}

function getPlaylistFallbackTrack() {
  if (!currentTrack) return null;
  return getPlaylistNextTrack(currentTrack.id) || allTracks.find((track) => track.id !== currentTrack.id) || null;
}

function broadcastScheduled(state) {
  if (!socket || !isHost) return;
  socket.emit("playback-update", state);
}

function syncPlaybackState(state) {
  const normalized = normalizePlaybackState(state);
  if (!normalized) return;

  suppressDrift = true;
  currentTrack = { id: normalized.id, name: normalized.name, url: normalized.url };
  $("now-playing-title").textContent = normalized.name;

  const el = audio();
  const shouldLoadTrack = !el.src || !el.src.endsWith(normalized.url);
  if (shouldLoadTrack) {
    el.src = normalized.url;
    el.load();
  }

  const serverNow = Date.now() + clockOffsetMs;
  const elapsedMs = Math.max(0, serverNow - normalized.serverTime);
  const targetPositionMs = normalized.positionMs + (normalized.isPlaying ? elapsedMs : 0);
  const currentPositionMs = el.currentTime * 1000;

  const diffMs = Math.abs(currentPositionMs - targetPositionMs);
  if (diffMs > 250) {
    el.currentTime = Math.max(0, targetPositionMs / 1000);
  }

  updateSyncStatus(diffMs);

  if (normalized.isPlaying && el.paused) {
    el.play().catch(() => {});
  } else if (!normalized.isPlaying && !el.paused) {
    el.pause();
  }

  suppressDrift = false;
}

function schedulePlayback(state) {
  syncPlaybackState(state);
}

function startFollowerSyncLoop() {
  if (isHost || !followerSyncState) return;

  const el = audio();
  const normalized = normalizePlaybackState(followerSyncState);
  if (!normalized || !el || !currentTrack) return;

  if (el.src && !el.src.endsWith(normalized.url)) {
    el.src = normalized.url;
    el.load();
  }

  const serverNow = Date.now() + clockOffsetMs;
  const elapsedMs = normalized.isPlaying ? Math.max(0, serverNow - normalized.serverTime) : 0;
  const targetMs = normalized.positionMs + elapsedMs;
  const diffMs = Math.abs((el.currentTime * 1000) - targetMs);

  if (diffMs > FOLLOWER_SYNC_THRESHOLD_MS && !Number.isNaN(el.duration)) {
    el.currentTime = Math.max(0, targetMs / 1000);
  }

  updateSyncStatus(diffMs);

  if (normalized.isPlaying && el.paused) {
    el.play().catch(() => {});
  } else if (!normalized.isPlaying && !el.paused) {
    el.pause();
  }
}

// ---------- Lightweight drift correction (small, frequent, no scheduling needed) ----------
function applyDriftCorrection(state) {
  if (suppressDrift || !currentTrack) return;
  const normalized = normalizePlaybackState(state);
  if (!normalized) return;

  const el = audio();
  if (!el.src.endsWith(normalized.url)) return;

  const serverNow = Date.now() + clockOffsetMs;
  const elapsedMs = normalized.isPlaying ? serverNow - normalized.serverTime : 0;
  const targetSeconds = Math.max(0, (normalized.positionMs + elapsedMs) / 1000);
  const diffSec = Math.abs(el.currentTime - targetSeconds);

  if (diffSec > DRIFT_THRESHOLD_SEC && !Number.isNaN(el.duration)) {
    el.currentTime = targetSeconds;
  }
  if (normalized.isPlaying && el.paused) el.play().catch(() => {});
  if (!normalized.isPlaying && !el.paused) el.pause();
}

// ---------- User actions (host side) ----------
async function playTrack(track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return;

  queueTrackForPlayback(normalized);
  currentTrack = normalized;
  if (!isHost) {
    isHost = true;
    socket.emit("claim-host");
    updateHostBadge();
  }
  const state = buildScheduledState(true, 0);
  broadcastScheduled(state); // send first, so the follower gets max lead time
  schedulePlayback(state); // then apply to ourselves — both fire at the same shared instant
  renderQueueList();
}

$("queue-toggle-btn").addEventListener("click", () => {
  toggleQueuePanel();
});

$("play-btn").addEventListener("click", () => {
  if (!currentTrack) return;
  const state = buildScheduledState(true, audio().currentTime * 1000);
  broadcastScheduled(state);
  schedulePlayback(state);
});

$("pause-btn").addEventListener("click", () => {
  if (!currentTrack) return;
  const state = buildScheduledState(false, audio().currentTime * 1000);
  broadcastScheduled(state);
  schedulePlayback(state);
});

function trackOrder() {
  const ids = getCurrentPlaylistTrackIds();
  const list = ids.map((id) => allTracks.find((t) => t.id === id)).filter(Boolean);
  return list.length ? list : allTracks;
}

function stepTrack(dir) {
  if (!currentTrack) return;
  if (dir > 0) {
    const queued = getNextQueuedTrack();
    if (queued) return playTrack(queued);
  } else {
    if (audio().currentTime > 3) return playTrack(currentTrack);
    if (currentQueueIndex > 0) return playTrack(playbackQueue[currentQueueIndex - 1]);
  }
  const list = trackOrder();
  if (!list.length) return;
  const i = list.findIndex((t) => t.id === currentTrack.id);
  playTrack(list[(i + dir + list.length) % list.length]);
}

$("skip-back-btn").addEventListener("click", () => stepTrack(-1));
$("skip-forward-btn").addEventListener("click", () => stepTrack(1));

$("claim-host-btn").addEventListener("click", () => {
  isHost = true;
  socket.emit("claim-host");
  updateHostBadge();
});

$("seek-slider").addEventListener("input", () => {
  if (!isHost || !currentTrack) return;
  const pct = $("seek-slider").value / 100;
  const el = audio();
  if (!el.duration) return;
  const state = buildScheduledState(!el.paused, pct * el.duration * 1000);
  broadcastScheduled(state);
  schedulePlayback(state);
});

audio().addEventListener("timeupdate", () => {
  const el = audio();
  if (el.duration) $("seek-slider").value = (el.currentTime / el.duration) * 100;
  if (isHost && socket && currentTrack) {
    const state = {
      trackId: currentTrack.id,
      name: currentTrack.name,
      url: currentTrack.url,
      positionMs: el.currentTime * 1000,
      isPlaying: !el.paused,
      serverTime: getServerNow(),
    };
    socket.emit("drift-sync", state);
  }
});

audio().addEventListener("ended", () => {
  if (!isHost || !socket) return;

  let nextTrack = getNextQueuedTrack();
  if (!nextTrack) {
    nextTrack = getPlaylistFallbackTrack();
  }

  if (!nextTrack) {
    return;
  }

  if (playbackQueue.length && currentQueueIndex >= 0) {
    currentQueueIndex += 1;
    if (currentQueueIndex >= playbackQueue.length) {
      currentQueueIndex = playbackQueue.length - 1;
    }
  }

  const nextNormalized = normalizeTrack(nextTrack);
  if (!nextNormalized) return;

  currentTrack = nextNormalized;
  if (playbackQueue.length && !playbackQueue.some((item) => item.id === nextNormalized.id)) {
    playbackQueue.push(nextNormalized);
    currentQueueIndex = playbackQueue.length - 1;
    renderQueueList();
  }

  const state = buildScheduledState(true, 0);
  broadcastScheduled(state);
  schedulePlayback(state);
  renderQueueList();
});

// Host periodically pings the room with its exact position on the shared
// clock, so followers can silently nudge back into alignment if they've
// drifted a bit — no scheduling needed for these small corrections.
setInterval(() => {
  if (!isHost || !socket || !currentTrack) return;
  const el = audio();
  const state = {
    trackId: currentTrack.id,
    name: currentTrack.name,
    url: currentTrack.url,
    positionMs: el.currentTime * 1000,
    isPlaying: !el.paused,
    serverTime: getServerNow(),
  };
  socket.emit("drift-sync", state);
}, HOST_HEARTBEAT_INTERVAL_MS);

// ---------- Chat ----------
function chatInView() {
  const r = $("chat-panel").getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}

function showToast(message, kind = "good", onClick) {
  const box = $("toast-container");
  const t = document.createElement("div");
  t.className = `toast toast-${kind}`;
  t.textContent = message;
  if (onClick) t.addEventListener("click", onClick);
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  requestAnimationFrame(() => t.classList.add("toast-visible"));
  setTimeout(() => { t.classList.remove("toast-visible"); setTimeout(() => t.remove(), 300); }, 4000);
}

function logChat(name, text) {
  const li = document.createElement("li");
  const b = document.createElement("b");
  b.textContent = `${name}: `;
  li.appendChild(b);
  li.appendChild(document.createTextNode(text));
  $("chat-log").appendChild(li);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
}

$("chat-send-btn").addEventListener("click", sendChat);
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});
function sendChat() {
  const text = $("chat-input").value.trim();
  if (!text || !socket) return;
  socket.emit("chat", text);
  $("chat-input").value = "";
}

// ---------- Spinning disc: turns while playing, drag it like a DJ to scrub ----------
(function initDisc() {
  const disc = $("cd-disc");
  if (!disc) return;
  const SEC_PER_TURN = 8;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let angle = 0, last = performance.now(), dragging = false, lastPA = 0, pos = 0;
  const pa = (e) => {
    const r = disc.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  };
  (function frame(t) {
    const el = audio();
    if (!dragging && !calm && el && !el.paused && !el.ended) angle = (angle + (t - last) * 0.12) % 360;
    last = t;
    disc.style.transform = `rotate(${angle}deg)`;
    requestAnimationFrame(frame);
  })(last);
  disc.addEventListener("pointerdown", (e) => {
    if (!currentTrack || !audio().duration) return;
    if (!isHost) { isHost = true; socket.emit("claim-host"); updateHostBadge(); }
    dragging = true; disc.setPointerCapture(e.pointerId);
    lastPA = pa(e); pos = audio().currentTime;
  });
  disc.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    let d = pa(e) - lastPA;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    lastPA = pa(e); angle += d;
    pos = Math.min(audio().duration, Math.max(0, pos + (d / 360) * SEC_PER_TURN));
    audio().currentTime = pos;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const state = buildScheduledState(!audio().paused, pos * 1000);
    broadcastScheduled(state);
    schedulePlayback(state);
  };
  disc.addEventListener("pointerup", end);
  disc.addEventListener("pointercancel", end);
})();

// ---------- Boot ----------
(function init() {
  const savedName = localStorage.getItem("lt_display_name");
  if (savedName) $("display-name-input").value = savedName;

  const params = new URLSearchParams(window.location.search);
  const roomFromLink = params.get("room");
  if (roomFromLink) $("room-code-input").value = roomFromLink;
  else if (localStorage.getItem("lt_last_room")) $("room-code-input").value = localStorage.getItem("lt_last_room");

  initLibraryAccess();
})();
