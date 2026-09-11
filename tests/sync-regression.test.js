const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

if (!source.includes('state.trackId || state.id')) {
  throw new Error('Playback state still does not normalize both trackId and id.');
}

if (!source.includes('currentTrack = { id: normalized.id')) {
  throw new Error('The app still writes invalid track ids into currentTrack.');
}

if (!source.includes('positionMs')) {
  throw new Error('Missing normalized positionMs field in sync payload.');
}

if (!source.includes('localStorage.getItem("lt_owner_token")') || !source.includes('/api/owner-token')) {
  throw new Error('Owner token recovery for playlist creation is missing.');
}

if (!source.includes('await refreshPlaylists();')) {
  throw new Error('Playlist list is not being refreshed when the app loads or a room is joined.');
}

if (source.includes('remove-btn') || source.includes('✕')) {
  throw new Error('Per-track delete buttons are still rendered in the UI.');
}

const serverPath = path.join(__dirname, '..', 'server.js');
const serverSource = fs.readFileSync(serverPath, 'utf8');

if (!serverSource.includes('Track deletion is only allowed from the server root upload folder.')) {
  throw new Error('Track deletion is still enabled through the API.');
}

console.log('sync regression check passed');
