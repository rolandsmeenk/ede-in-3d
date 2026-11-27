function startPostcards(gallery) {
  const hoekelum = ['hoekelum-snowfall', 'Snow falling over Kasteel Hoekelum’s snow-covered grounds and frozen moat', 'Wintergroeten uit Bennekom!'];
  const scenes = [
    ['oude-kerk-sunbeams', 'Low sunlight over Oude Kerk and the rooftops of Ede', 'Groeten uit Ede!'],
    ['ede-wageningen-storm', 'Storm light over Ede-Wageningen station', 'Een groet onderweg!'],
    ['ede-overview-rainbow', 'A rainbow above Ede and the Oude Kerk tower', 'Kleurrijke groeten uit Ede!'],
    ['middelpunt-stone', 'The Middelpunt van Nederland inscription on a boulder in the wooded clearing in Lunteren', 'Groeten uit Lunteren!'],
    hoekelum,
    ['huis-kernhem-mist', 'The tree-lined approach to Huis Kernhem in morning mist', 'Groetjes uit Kernhem!'],
  ];
  const stackSize = 4;
  let placed = 0;
  let timer;
  let active = true;

  function loadNextCard() {
    const scene = scenes.shift();
    if (scene !== hoekelum) scenes.push(scene);
    const [file, description, greeting] = scene;
    const image = new Image(960, 540);
    image.alt = description;
    if (!placed) image.fetchPriority = 'high';
    image.src = './assets/loading-postcards/' + file + '.webp';
    return image.decode().then(() => {
      const card = document.createElement('figure');
      const caption = document.createElement('figcaption');
      card.className = 'loader-postcard';
      caption.lang = 'nl';
      caption.textContent = greeting;
      card.append(image, caption);
      return card;
    }, () => null);
  }

  async function placeCard(pendingCard) {
    const card = await pendingCard;
    if (!active) return;
    if (card) {
      card.dataset.position = placed % stackSize;
      gallery.append(card);
      if (gallery.childElementCount > stackSize) gallery.firstElementChild.remove();
      placed++;
    }
    const nextCard = loadNextCard();
    timer = setTimeout(() => void placeCard(nextCard), 3000);
  }

  const firstCard = loadNextCard();
  timer = setTimeout(() => void placeCard(firstCard), 1100);
  return () => {
    active = false;
    clearTimeout(timer);
  };
}

const gallery = document.getElementById('loading-postcards');
const stopPostcards = gallery ? startPostcards(gallery) : undefined;

import('./main.js?v=20261127-loading-postcard')
  .then(({ initApp }) => initApp())
  .catch((error) => {
    console.error('[startup]', error);
    document.getElementById('loading-status').textContent = 'Ede couldn’t load. Try again.';
    document.getElementById('loading-overlay').classList.add('has-error');
    const retry = document.getElementById('loading-retry');
    retry.hidden = false;
    retry.addEventListener('click', () => window.location.reload(), { once: true });
  })
  .finally(stopPostcards);
