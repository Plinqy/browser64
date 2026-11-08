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
      <p>Supply your own 16 KiB 1541 DOS ROM. The selected D64 is also mounted into the firmware-driven 1 MHz drive; host-assisted buttons above remain a separate convenience path.</p>
    </div>
    <div id="drive1541-status" class="status-pill">1541 ROM required</div>
  </div>
  <div class="disk-controls">
    <label>
      1541 DOS ROM
      <input id="drive1541-rom" type="file" accept=".rom,.bin,application/octet-stream" />
    </label>
    <span id="drive1541-detail">Drive 8 · no ROM · no disk</span>
  </div>
`;
diskPanel.insertAdjacentElement('afterend', panel);

const romInputCandidate = document.getElementById('drive1541-rom');
const statusCandidate = document.getElementById('drive1541-status');
const detailCandidate = document.getElementById('drive1541-detail');
const d64InputCandidate = document.getElementById('d64-file');
if (!(romInputCandidate instanceof HTMLInputElement) || statusCandidate === null || detailCandidate === null || !(d64InputCandidate instanceof HTMLInputElement)) {
  throw new Error('1541 UI controls failed to initialize.');
}
const romInput = romInputCandidate;
const status = statusCandidate;
const detail = detailCandidate;
const d64Input = d64InputCandidate;

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

// The v0.10 D64 picker remains the single disk selector. Mount the same image
// into the true drive in parallel with the explicitly host-assisted browser path.
d64Input.addEventListener('change', async () => {
  const file = d64Input.files?.[0];
  if (file === undefined) {
    machine.eject1541Disk();
    renderDriveStatus();
    return;
  }

  try {
    machine.mountD64In1541(new Uint8Array(await file.arrayBuffer()));
  } catch {
    machine.eject1541Disk();
  }
  renderDriveStatus();
});

function renderDriveStatus(): void {
  const drive = machine.drive1541;
  detail.textContent = [
    'Drive 8',
    drive.romLoaded ? 'ROM ready' : 'no ROM',
    drive.mechanism.mounted ? `track ${drive.mechanism.currentTrack}` : 'no disk',
    drive.mechanism.motorOn ? 'motor on' : 'motor off',
    drive.mechanism.activityLedOn ? 'LED on' : 'LED off'
  ].join(' · ');
}

function animationTick(): void {
  renderDriveStatus();
  requestAnimationFrame(animationTick);
}

renderDriveStatus();
requestAnimationFrame(animationTick);
