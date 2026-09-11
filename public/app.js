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

    renderTrackList(allTracks);
    renderPlaylistSelect();
    renderActivePlaylistTracks();
    if (!isLibraryOwner) {
      $("delete-playlist-btn")?.classList.add("hidden");
      $("create-playlist-btn").disabled = true;
      $("new-playlist-input").disabled = true;
    }
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

function renderTrackList(tracks) {
  const list = $("track-list");
  list.innerHTML = "";
  tracks.forEach((t) => {
    const li = document.createElement("li");

    const nameSpan = document.createElement("span");
    nameSpan.className = "track-name";
    nameSpan.textContent = t.name;
    nameSpan.addEventListener("click", () => playTrack(t));

    li.appendChild(nameSpan);
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

async function refreshPlaylists() {
  const res = await fetch("/api/playlists");
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

  $("delete-playlist-btn").classList.toggle("hidden", !(isLibraryOwner && activePlaylist));
  $("create-playlist-btn").disabled = !isLibraryOwner;
  $("new-playlist-input").disabled = !isLibraryOwner;
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
  $("delete-playlist-btn").classList.toggle("hidden", !(isLibraryOwner && activePlaylist));
  renderActivePlaylistTracks();
});

$("create-playlist-btn").addEventListener("click", async () => {
  if (!isLibraryOwner) {
    const hasOwnerAccess = await ensureOwnerAccess();
    if (!hasOwnerAccess) return;
  }

  const name = $("new-playlist-input").value.trim();
  if (!name) return;
  const res = await fetch("/api/playlists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-owner-token": ownerToken,
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    console.error("Playlist create failed", await res.text());
    return;
  }
  $("new-playlist-input").value = "";
  activePlaylist = name;
  await refreshPlaylists();
  $("playlist-select").value = name;
});

$("delete-playlist-btn").addEventListener("click", async () => {
  if (!activePlaylist || !isLibraryOwner) return;
  if (!confirm(`Delete the playlist "${activePlaylist}"? This won't delete the songs themselves.`)) return;
  const res = await fetch(`/api/playlists/${encodeURIComponent(activePlaylist)}`, {
    method: "DELETE",
    headers: { "x-owner-token": ownerToken },
  });
  if (!res.ok) {
    console.error("Playlist delete failed", await res.text());
    return;
  }
  activePlaylist = null;
  await refreshPlaylists();
});

// ---------- Room / sync ----------
let socket = null;
let isHost = false;
let currentTrack = null; // {id, name, url}
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
  if (typed) {
    localStorage.setItem("lt_display_name", typed);
    return typed;
  }
  return localStorage.getItem("lt_display_name") || "Friend-" + Math.floor(Math.random() * 1000);
}

$("join-room-btn").addEventListener("click", () => {
  let code = $("room-code-input").value.trim().toUpperCase();
  if (!code) {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
    $("room-code-input").value = code;
  }
  $("room-share-hint").textContent =
    `Share this room code with your friend: ${code} (or send them the link: ${window.location.origin}/?room=${code})`;
  connectSocket(code);
  showPanel("library-panel");
  showPanel("player-panel");
  showPanel("chat-panel");
  refreshTrackList();
});

function connectSocket(roomCode) {
  socket = io();
  const name = getDisplayName();

  socket.on("connect", () => {
    calibrateClock().then(() => {
      socket.emit("join-room", { roomCode, name });
    });
  });

  socket.on("joined", ({ isHost: hostFlag, lastState }) => {
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

  socket.on("peer-joined", ({ name }) => logChat("system", `${name} joined the room`));
  socket.on("peer-left", ({ name }) => logChat("system", `${name} left the room`));
  socket.on("chat", ({ name, text }) => logChat(name, text));

  socket.on("room-count", ({ count }) => {
    $("room-count-text").textContent = count;
    $("room-status-badge").classList.remove("hidden");
  });

  // ---------- Voice call signaling ----------
  socket.on("voice-offer", async ({ sdp, from }) => {
    if (pc && isCalling) {
      // We're already mid-call — treat this as a renegotiation (e.g. ICE restart)
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("voice-answer", { sdp: answer });
      } catch (e) {
        console.error("Voice renegotiation failed:", e);
      }
      return;
    }
    pendingOffer = sdp;
    setCallStatus(`incoming call from ${from || "your friend"}...`, "calling");
    showCallControls("incoming");
  });

  socket.on("voice-answer", async ({ sdp }) => {
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (e) {
      console.error("Failed to set remote answer:", e);
    }
  });

  socket.on("voice-ice-candidate", ({ candidate }) => {
    if (!candidate) return;
    if (pc && pc.remoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    } else {
      pendingCandidates.push(candidate);
    }
  });

  socket.on("voice-end", () => {
    pendingOffer = null;
    endCall();
  });

  // Recalibrate periodically — clocks can slowly drift apart over a long
  // listening session, and this keeps the shared "now" accurate.
  setInterval(calibrateClock, 30000);
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
  currentTrack = track;
  if (!isHost) {
    isHost = true;
    socket.emit("claim-host");
    updateHostBadge();
  }
  const state = buildScheduledState(true, 0);
  broadcastScheduled(state); // send first, so the follower gets max lead time
  schedulePlayback(state); // then apply to ourselves — both fire at the same shared instant
}

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

$("skip-back-btn").addEventListener("click", () => {
  if (!isHost || !currentTrack) return;
  const el = audio();
  const newPos = Math.max(0, el.currentTime - 10) * 1000;
  const state = buildScheduledState(!el.paused, newPos);
  broadcastScheduled(state);
  schedulePlayback(state);
});

$("skip-forward-btn").addEventListener("click", () => {
  if (!isHost || !currentTrack) return;
  const el = audio();
  const maxSeconds = el.duration || Infinity;
  const newPos = Math.min(maxSeconds, el.currentTime + 10) * 1000;
  const state = buildScheduledState(!el.paused, newPos);
  broadcastScheduled(state);
  schedulePlayback(state);
});

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

// ---------- Voice call ----------
let pc = null;
let localStream = null;
let isCalling = false;
let isMuted = false;
let pendingOffer = null;
let pendingCandidates = [];
let iceRestartAttempts = 0;
const MAX_ICE_RESTARTS = 4;
// Public STUN servers — only used to discover each computer's public
// address for the initial handshake. No audio ever passes through these;
// once connected, audio flows directly between the two browsers.
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function setCallStatus(text, state) {
  const node = $("call-status");
  node.textContent = `Voice call: ${text}`;
  node.className = state ? `hint ${state}` : "hint";
}

function showCallControls(state) {
  // state: 'idle' | 'calling' | 'incoming' | 'active'
  const trigger = $("voice-call-trigger");
  const popup = $("voice-call-popup");
  const isPopupState = ["calling", "incoming", "active"].includes(state);

  if (trigger) trigger.classList.toggle("hidden", state !== "idle");
  if (popup) popup.classList.toggle("hidden", !isPopupState);

  $("call-controls").classList.toggle("hidden", state !== "idle");
  $("calling-controls").classList.toggle("hidden", state !== "calling");
  $("incoming-call-banner").classList.toggle("hidden", state !== "incoming");
  $("active-call-controls").classList.toggle("hidden", state !== "active");

  if (state === "idle") {
    setCallStatus("idle");
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (e) => {
    if (e.candidate && socket) socket.emit("voice-ice-candidate", { candidate: e.candidate });
  };

  pc.ontrack = (e) => {
    const remoteAudio = $("remote-audio");
    remoteAudio.srcObject = e.streams[0];
    remoteAudio.play().catch(() => {});
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected") {
      iceRestartAttempts = 0;
      setCallStatus("connected 🎙", "connected");
      showCallControls("active");
      document.title = "🔴 Listen Together";
    } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      attemptReconnect();
    } else if (pc.connectionState === "closed") {
      resetCallUI();
    }
  };
}

// If the connection drops (tab throttling while minimized, brief network
// blip, etc.) try re-establishing it a few times via an ICE restart before
// giving up and ending the call cleanly.
async function attemptReconnect() {
  if (!pc || iceRestartAttempts >= MAX_ICE_RESTARTS) {
    setCallStatus("connection lost", "lost");
    endCall();
    return;
  }
  iceRestartAttempts++;
  setCallStatus(`reconnecting... (${iceRestartAttempts}/${MAX_ICE_RESTARTS})`, "calling");
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    socket.emit("voice-offer", { sdp: offer });
  } catch (e) {
    console.error("Reconnect attempt failed:", e);
  }
}

async function startCall() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert("Couldn't access your microphone — check your browser's site permissions.");
    return;
  }
  isCalling = true;
  createPeerConnection();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("voice-offer", { sdp: offer });
  setCallStatus("calling...", "calling");
  showCallControls("calling");
}

async function acceptCall() {
  if (!pendingOffer) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert("Couldn't access your microphone — check your browser's site permissions.");
    pendingOffer = null;
    resetCallUI();
    return;
  }
  isCalling = true;
  createPeerConnection();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
  pendingCandidates.forEach((c) => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
  pendingCandidates = [];
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("voice-answer", { sdp: answer });
  pendingOffer = null;
  setCallStatus("connecting...", "calling");
  showCallControls("active");
}

function endCall() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  const remoteAudio = $("remote-audio");
  if (remoteAudio.srcObject) remoteAudio.srcObject = null;
  isCalling = false;
  resetCallUI();
}

function resetCallUI() {
  setCallStatus("idle");
  showCallControls("idle");
  document.title = "Listen Together";
  $("mute-btn").textContent = "🔇 Mute";
  isMuted = false;
  iceRestartAttempts = 0;
}

$("voice-call-trigger").addEventListener("click", () => {
  if (pendingOffer) {
    acceptCall();
    return;
  }
  if (!pc && !isCalling) startCall();
});

$("voice-call-close-btn").addEventListener("click", () => {
  if (pendingOffer) {
    pendingOffer = null;
    resetCallUI();
    return;
  }
  if (pc || isCalling) {
    if (socket) socket.emit("voice-end");
    endCall();
  }
});

$("start-call-btn").addEventListener("click", startCall);
$("accept-call-btn").addEventListener("click", acceptCall);

$("cancel-call-btn").addEventListener("click", () => {
  if (socket) socket.emit("voice-end");
  endCall();
});

$("decline-call-btn").addEventListener("click", () => {
  pendingOffer = null;
  if (socket) socket.emit("voice-end");
  resetCallUI();
});

$("mute-btn").addEventListener("click", () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  $("mute-btn").textContent = isMuted ? "🔊 Unmute" : "🔇 Mute";
});

$("end-call-btn").addEventListener("click", () => {
  if (socket) socket.emit("voice-end");
  endCall();
});

// ---------- Chat ----------
function logChat(name, text) {
  const li = document.createElement("li");
  li.innerHTML = `<b>${name}:</b> ${text}`;
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

// ---------- Boot ----------
(function init() {
  const savedName = localStorage.getItem("lt_display_name");
  if (savedName) $("display-name-input").value = savedName;

  const params = new URLSearchParams(window.location.search);
  const roomFromLink = params.get("room");
  if (roomFromLink) $("room-code-input").value = roomFromLink;

  initLibraryAccess();
})();
