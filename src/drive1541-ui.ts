import { C1541_ROM_SIZE } from './core';
import { machine, sessionReady } from './main';
import { browserSessionStore } from './session/BrowserSession';

const diskPanel = document.querySelector<HTMLElement>('.disk-panel');
if (diskPanel === null) throw new Error('Missing D64 disk panel for 1541 controls.');

const panel = document.createElement('article');
panel.className = 'panel drive1541-panel';
panel.innerHTML = `
  <div class="panel-heading">
    <div>
      <h2>1541 True Drive</h2>
      <p>Supply your own 16 KiB 1541 DOS ROM. D64 images are writable sector media; G64 preserves raw GCR tracks and half-tracks for non-standard disk formats.</p>
    </div>
    <div id="drive1541-status" class="status-pill">1541 ROM required</div>
  </div>
  <div class="disk-controls">
    <label>
      1541 DOS ROM
      <input id="drive1541-rom" type="file" accept=".rom,.bin,application/octet-stream" />
    </label>
    <label>
      Raw G64 disk
      <input id="g64-file" type="file" accept=".g64,application/octet-stream" />
    </label>
    <label>
      <input id="drive-write-protect" type="checkbox" />
      Write protect
    </label>
    <button id="drive-export-media" type="button">Export Mounted Disk</button>
    <span id="drive1541-detail">Drive 8 · no ROM · no disk</span>
  </div>
  <p id="drive1541-context" class="control-context" aria-live="polite"></p>
`;
diskPanel.insertAdjacentElement('afterend', panel);

const romInput = requireInput('drive1541-rom');
const g64Input = requireInput('g64-file');
const writeProtect = requireInput('drive-write-protect');
const exportButton = requireButton('drive-export-media');
const status = requireElement('drive1541-status');
const detail = requireElement('drive1541-detail');
const context = requireElement('drive1541-context');
const d64Input = requireInput('d64-file');

let mountedFilename = 'disk';

romInput.addEventListener('change', async () => {
  const file = romInput.files?.[0];
  if (file === undefined) return;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    machine.load1541Rom(bytes);
    await browserSessionStore.putAsset('rom-1541', { name: file.name, bytes, mediaType: 'rom' });
    status.textContent = `${file.name} · ${bytes.length} bytes`;
    status.classList.add('ready');
    status.title = bytes.length === C1541_ROM_SIZE ? '1541 DOS ROM ready' : '';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.remove('ready');
  }
  renderDriveStatus();
});

// The host-assisted D64 browser remains the single D64 selector. The same file
// is also mounted into the firmware-driven drive, where writes are now retained.
d64Input.addEventListener('change', async () => {
  const file = d64Input.files?.[0];
  if (file === undefined) {
    machine.eject1541Disk();
    mountedFilename = 'disk';
    renderDriveStatus();
    return;
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    machine.mountD64In1541(bytes, writeProtect.checked);
    await browserSessionStore.putAsset('disk-1541', {
      name: file.name, bytes, mediaType: 'd64', writeProtected: writeProtect.checked
    });
    mountedFilename = file.name;
    g64Input.value = '';
  } catch {
    machine.eject1541Disk();
  }
  renderDriveStatus();
});

g64Input.addEventListener('change', async () => {
  const file = g64Input.files?.[0];
  if (file === undefined) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    machine.mountG64In1541(bytes, writeProtect.checked);
    await browserSessionStore.putAsset('disk-1541', {
      name: file.name, bytes, mediaType: 'g64', writeProtected: writeProtect.checked
    });
    mountedFilename = file.name;
    renderDriveStatus();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.remove('ready');
  }
});

writeProtect.addEventListener('change', () => {
  machine.set1541WriteProtected(writeProtect.checked);
  void persistMountedDisk();
  renderDriveStatus();
});

exportButton.addEventListener('click', () => {
  const exported = machine.export1541Media();
  if (exported === null) return;
  const suffix = `.${exported.kind}`;
  const base = mountedFilename.toLowerCase().endsWith(suffix)
    ? mountedFilename.slice(0, -suffix.length)
    : mountedFilename;
  downloadBytes(exported.bytes, `${base}-modified${suffix}`);
  void browserSessionStore.putAsset('disk-1541', {
    name: mountedFilename, bytes: exported.bytes, mediaType: exported.kind, writeProtected: writeProtect.checked
  });
});

async function persistMountedDisk(): Promise<void> {
  const exported = machine.export1541Media();
  if (exported === null) return;
  await browserSessionStore.putAsset('disk-1541', {
    name: mountedFilename,
    bytes: exported.bytes,
    mediaType: exported.kind,
    writeProtected: writeProtect.checked
  });
}

void sessionReady.then((session) => {
  const driveRom = session.assets['rom-1541'];
  if (driveRom !== undefined) {
    status.textContent = `${driveRom.name} · ${driveRom.bytes.length} bytes · restored`;
    status.classList.add('ready');
  }
  const disk = session.assets['disk-1541'];
  if (disk !== undefined) {
    mountedFilename = disk.name;
    writeProtect.checked = disk.writeProtected ?? false;
  }
  renderDriveStatus();
});

function renderDriveStatus(): void {
  const drive = machine.drive1541;
  const mechanism = drive.mechanism;
  detail.textContent = [
    'Drive 8',
    drive.romLoaded ? 'ROM ready' : 'no ROM',
    mechanism.mounted
      ? `${mechanism.mediaKind?.toUpperCase()} track ${formatTrack(mechanism.currentTrackPosition)}`
      : 'no disk',
    mechanism.writeProtected ? 'write protected' : 'writable',
    mechanism.dirty ? 'modified' : 'clean',
    mechanism.motorOn ? 'motor on' : 'motor off',
    mechanism.activityLedOn ? 'LED on' : 'LED off'
  ].join(' · ');
  const exportReason = mechanism.mounted ? null : 'Mount a D64 or G64 disk first.';
  exportButton.disabled = exportReason !== null;
  exportButton.title = exportReason === null
    ? 'Export the currently mounted D64/G64, including retained writes.'
    : `Unavailable: ${exportReason}`;
  writeProtect.disabled = !mechanism.mounted;
  writeProtect.title = mechanism.mounted
    ? 'Toggle the drive mechanism write-protect sensor for the mounted disk.'
    : 'Mount a disk before changing drive write protection.';

  const message = !drive.romLoaded
    ? mechanism.mounted
      ? 'Disk is mounted, but device-8 LOAD/SAVE requires a 16 KiB 1541 DOS ROM. Host-assisted D64 loading remains available without it.'
      : 'Load a 16 KiB 1541 DOS ROM for true device-8 operation, then mount a D64 or G64.'
    : !mechanism.mounted
      ? '1541 DOS ROM ready. Mount a D64/G64 before using device 8 or exporting media.'
      : 'True drive ready: the 1541 ROM and disk are mounted. Export Mounted Disk preserves retained writes.';
  context.textContent = message;
  context.classList.toggle('blocked', !drive.romLoaded || !mechanism.mounted);
}

function formatTrack(track: number): string {
  return Number.isInteger(track) ? String(track) : track.toFixed(1);
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function requireElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Missing #${id}.`);
  return value;
}

function requireInput(id: string): HTMLInputElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLInputElement)) throw new Error(`Missing input #${id}.`);
  return value;
}

function requireButton(id: string): HTMLButtonElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLButtonElement)) throw new Error(`Missing button #${id}.`);
  return value;
}

function animationTick(): void {
  renderDriveStatus();
  requestAnimationFrame(animationTick);
}

renderDriveStatus();
requestAnimationFrame(animationTick);
