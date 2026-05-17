const nameInput = document.getElementById('name-input');
const roomInput = document.getElementById('room-id-input');
const stored = localStorage.getItem('rnpksync-name');
if (stored) nameInput.value = stored;
const lastRoom = localStorage.getItem('rnpksync-last-room');
if (lastRoom) roomInput.value = lastRoom;

function saveName() {
  const n = nameInput.value.trim().slice(0, 20);
  if (n) localStorage.setItem('rnpksync-name', n);
  else localStorage.removeItem('rnpksync-name');
}

function createRoom() {
  saveName();
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/create-room';
  document.body.appendChild(form);
  form.submit();
}

function joinRoom() {
  saveName();
  const id = roomInput.value.trim();
  if (!id) {
    alert('Enter a room ID.');
    return;
  }
  localStorage.setItem('rnpksync-last-room', id);
  window.location.href = '/room/' + encodeURIComponent(id);
}

roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
