import { C1541_ROM_SIZE } from './core';
import { machine } from './main';

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
`;
diskPanel.insertAdjacentElement('afterend', panel);

const romInput = requireInput('drive1541-rom');
const g64Input = requireInput('g64-file');
const writeProtect = requireInput('drive-write-protect');
const exportButton = requireButton('drive-export-media');
const status = requireElement('drive1541-status');
const detail = requireElement('drive1541-detail');
const d64Input = requireInput('d64-file');

let mountedFilename = 'disk';

romInput.addEventListener('change', async () => {
  const file = romInput.files?.[0];
  if (file === undefined) return;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    machine.load1541Rom(bytes);
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
    machine.mountD64In1541(new Uint8Array(await file.arrayBuffer()), writeProtect.checked);
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
    machine.mountG64In1541(new Uint8Array(await file.arrayBuffer()), writeProtect.checked);
    mountedFilename = file.name;
    renderDriveStatus();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.remove('ready');
  }
});

writeProtect.addEventListener('change', () => {
  machine.set1541WriteProtected(writeProtect.checked);
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
  exportButton.disabled = !mechanism.mounted;
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
