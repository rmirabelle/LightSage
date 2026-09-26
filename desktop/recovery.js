const button = document.getElementById('restore');
button.onclick = async () => {
  button.disabled = true;
  quitButton.disabled = true;
  document.getElementById('recovery-error').textContent = '';
  try { await window.lightSageDesktop.restore(); }
  catch (error) { document.getElementById('recovery-error').textContent = error.message; }
  finally { button.disabled = false; quitButton.disabled = false; }
};

const quitButton = document.getElementById('quit');
quitButton.onclick = async () => {
  quitButton.disabled = true;
  button.disabled = true;
  try { await window.lightSageDesktop.quit(); }
  catch (error) { document.getElementById('recovery-error').textContent = error.message; }
  finally { quitButton.disabled = false; button.disabled = false; }
};
