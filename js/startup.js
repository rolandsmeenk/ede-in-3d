import('./main.js?v=20261127-volume-clouds')
  .then(({ initApp }) => initApp())
  .catch((error) => {
    console.error('[startup]', error);
    document.getElementById('loading-status').textContent = 'Ede couldn’t load. Try again.';
    document.getElementById('loading-overlay').classList.add('has-error');
    const retry = document.getElementById('loading-retry');
    retry.hidden = false;
    retry.addEventListener('click', () => window.location.reload(), { once: true });
  });
