const data = window.lightSageMessage;
document.title = data.title;
document.getElementById('title').textContent = data.title;
document.getElementById('message').textContent = data.message;
document.getElementById('detail').textContent = data.detail;
const buttons = data.buttons.map((label, index) => {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = label;
  if (data.buttons.length > 1 && index === data.cancelId) button.className = 'secondary';
  button.onclick = () => data.respond(index);
  document.getElementById('actions').append(button);
  return button;
});
buttons[data.defaultId]?.focus();
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); data.respond(data.cancelId); }
});
