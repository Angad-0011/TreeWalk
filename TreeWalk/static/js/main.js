const mapCenter = [30.7333, 76.7794];
const defaultZoom = 14;

const map = L.map('map', {
  zoomControl: true,
  preferCanvas: true,
}).setView(mapCenter, defaultZoom);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

const treeLayer = L.layerGroup().addTo(map);
const panoramaLayer = L.layerGroup().addTo(map);

const treeCountEl = document.getElementById('tree-count');
const panoramaCountEl = document.getElementById('panorama-count');
const treeListEl = document.getElementById('tree-list');
const treeForm = document.getElementById('tree-form');
const latInput = document.getElementById('lat');
const lonInput = document.getElementById('lon');
const speciesInput = document.getElementById('species');
const notesInput = document.getElementById('notes');
const treeRowTemplate = document.getElementById('tree-row-template');
const panoramaSelect = document.getElementById('panorama-select');
const panoramaMeta = document.getElementById('panorama-meta');
const panoramaViewerEl = document.getElementById('panorama-viewer');
const usePanoramaLocationBtn = document.getElementById('use-panorama-location');
const openStreetViewLink = document.getElementById('open-street-view');

let viewer = null;
let panoramas = [];
let panoramaMarkers = new Map();
let selectedPanoramaId = null;

usePanoramaLocationBtn.disabled = true;

const photoSphere = window.PhotoSphereViewer;
let PSVUtils = null;
let PSVViewer = null;
if (photoSphere) {
  PSVUtils = photoSphere.utils;
  PSVViewer = photoSphere.Viewer;
} else {
  console.warn('Photo Sphere Viewer failed to load; panoramas will render as static images.');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function buildGradientPanorama(stops) {
  if (!Array.isArray(stops) || stops.length === 0) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  stops.forEach((stop) => {
    const offset = clamp(Number.parseFloat(stop.offset), 0, 1);
    const color = typeof stop.color === 'string' ? stop.color : '#0f172a';
    gradient.addColorStop(Number.isNaN(offset) ? 0 : offset, color);
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const horizon = Math.round(canvas.height * 0.35);
  const groundGradient = ctx.createLinearGradient(0, horizon, 0, canvas.height);
  groundGradient.addColorStop(0, '#14532d');
  groundGradient.addColorStop(1, '#86efac');
  ctx.fillStyle = groundGradient;
  ctx.fillRect(0, horizon, canvas.width, canvas.height - horizon);

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#f8fafc';
  for (let i = 0; i < 6; i += 1) {
    const radius = 120 + i * 55;
    ctx.beginPath();
    ctx.arc(canvas.width * 0.65, 180, radius, Math.PI, Math.PI * 1.05);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  return canvas.toDataURL('image/png');
}

function normalizePanorama(panorama) {
  if (!panorama || typeof panorama !== 'object') {
    return null;
  }
  const imageUrl =
    typeof panorama.imageUrl === 'string' && panorama.imageUrl.trim()
      ? panorama.imageUrl
      : buildGradientPanorama(panorama.gradientStops);
  if (!imageUrl) {
    return null;
  }
  return {
    ...panorama,
    imageUrl,
  };
}

function formatNumber(num) {
  const value = Number.parseFloat(num);
  return Number.isNaN(value) ? '–' : value.toFixed(5);
}

function formatTimestamp(value) {
  if (!value) {
    return '–';
  }
  const raw = `${value}`.trim();
  const timestamp = Number.parseInt(raw, 10) * (raw.length === 13 ? 1 : 1000);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function streetViewUrl(lat, lon) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}

function mapsUrl(lat, lon) {
  return `https://maps.google.com/?q=${lat},${lon}`;
}

function setSelectedPanorama(id) {
  selectedPanoramaId = id;
  if (!id) {
    panoramaSelect.value = '';
    panoramaMeta.innerHTML = '<p>No panorama selected.</p>';
    openStreetViewLink.setAttribute('href', '#');
    usePanoramaLocationBtn.disabled = true;
    if (viewer && typeof viewer.destroy === 'function') {
      viewer.destroy();
      viewer = null;
    }
    panoramaViewerEl.innerHTML = '<p class="empty-state">Select a panorama to preview it here.</p>';
    panoramaViewerEl.style.backgroundImage = '';
    return;
  }
  const panorama = panoramas.find((p) => p.id === id);
  if (!panorama) {
    return;
  }
  const panoramaLat = Number.parseFloat(panorama.lat);
  const panoramaLon = Number.parseFloat(panorama.lon);
  panoramaSelect.value = panorama.id;
  const description = panorama.description ? `<span>${panorama.description}</span>` : '';
  const notes = panorama.notes ? `<span class="panorama-note">${panorama.notes}</span>` : '';
  panoramaMeta.innerHTML = `
    <strong>${panorama.name}</strong><br />
    ${description}${notes ? '<br />' + notes : ''}
  `;
  if (!Number.isNaN(panoramaLat) && !Number.isNaN(panoramaLon)) {
    openStreetViewLink.setAttribute('href', streetViewUrl(panoramaLat, panoramaLon));
    usePanoramaLocationBtn.disabled = false;
  } else {
    openStreetViewLink.setAttribute('href', '#');
    usePanoramaLocationBtn.disabled = true;
  }

  if (!panorama.imageUrl) {
    if (viewer && typeof viewer.destroy === 'function') {
      viewer.destroy();
      viewer = null;
    }
    panoramaViewerEl.innerHTML = '<p class="empty-state">This panorama is missing imagery.</p>';
    panoramaViewerEl.style.backgroundImage = '';
    highlightPanoramaMarker(panorama.id);
    if (!Number.isNaN(panoramaLat) && !Number.isNaN(panoramaLon)) {
      map.flyTo([panoramaLat, panoramaLon], 18, { duration: 0.6 });
    }
    return;
  }

  if (PSVViewer) {
    if (!viewer) {
      panoramaViewerEl.innerHTML = '';
      viewer = new PSVViewer({
        container: panoramaViewerEl,
        panorama: panorama.imageUrl,
        touchmoveTwoFingers: true,
        mousewheelCtrlKey: true,
        defaultYaw: panorama.heading && PSVUtils ? PSVUtils.degToRad(panorama.heading) : undefined,
      });
    } else {
      viewer.setPanorama(panorama.imageUrl, {
        longitude: panorama.heading && PSVUtils ? PSVUtils.degToRad(panorama.heading) : undefined,
      });
    }
  } else {
    panoramaViewerEl.innerHTML = '';
    panoramaViewerEl.style.backgroundSize = 'cover';
    panoramaViewerEl.style.backgroundPosition = 'center';
    panoramaViewerEl.style.backgroundImage = `url(${panorama.imageUrl})`;
  }

  highlightPanoramaMarker(panorama.id);
  if (!Number.isNaN(panoramaLat) && !Number.isNaN(panoramaLon)) {
    map.flyTo([panoramaLat, panoramaLon], 18, { duration: 0.6 });
  }
}

function highlightPanoramaMarker(id) {
  panoramaMarkers.forEach((marker, markerId) => {
    const isActive = markerId === id;
    marker.setStyle({
      color: isActive ? '#1d4ed8' : '#7c3aed',
      fillColor: isActive ? '#3b82f6' : '#c084fc',
      radius: isActive ? 9 : 7,
      weight: isActive ? 3 : 1.5,
      opacity: 1,
      fillOpacity: isActive ? 0.8 : 0.55,
    });
    if (isActive) {
      marker.bringToFront();
    }
  });
}

async function loadPanoramas() {
  try {
    const response = await fetch('/data/panoramas.json');
    const data = await response.json();
    panoramas = Array.isArray(data)
      ? data
          .map((panorama) => normalizePanorama(panorama))
          .filter((panorama) => panorama && panorama.imageUrl)
      : [];
    panoramaCountEl.textContent = panoramas.length;
    populatePanoramaSelect();
    drawPanoramaMarkers();
    if (panoramas.length > 0) {
      setSelectedPanorama(panoramas[0].id);
    } else {
      panoramaMeta.innerHTML = '<p>Upload panoramas to begin annotating trees.</p>';
      usePanoramaLocationBtn.disabled = true;
      openStreetViewLink.setAttribute('href', '#');
    }
  } catch (error) {
    console.error('Failed to load panoramas', error);
    panoramaCountEl.textContent = '0';
    panoramaMeta.innerHTML = '<p class="error">Unable to load panoramas.</p>';
    usePanoramaLocationBtn.disabled = true;
  }
}

function populatePanoramaSelect() {
  panoramaSelect.innerHTML = '';
  panoramaSelect.disabled = panoramas.length === 0;
  panoramas.forEach((panorama) => {
    const option = document.createElement('option');
    option.value = panorama.id;
    option.textContent = `${panorama.name}`;
    panoramaSelect.append(option);
  });
}

function drawPanoramaMarkers() {
  panoramaLayer.clearLayers();
  panoramaMarkers = new Map();
  panoramas.forEach((panorama) => {
    const lat = Number.parseFloat(panorama.lat);
    const lon = Number.parseFloat(panorama.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return;
    }
    const marker = L.circleMarker([lat, lon], {
      radius: 7,
      color: '#7c3aed',
      fillColor: '#c084fc',
      fillOpacity: 0.6,
      weight: 1.5,
    });
    marker.bindTooltip(panorama.name);
    marker.on('click', () => setSelectedPanorama(panorama.id));
    marker.addTo(panoramaLayer);
    panoramaMarkers.set(panorama.id, marker);
  });
}

async function loadTrees() {
  try {
    const response = await fetch('/api/trees');
    if (!response.ok) {
      throw new Error(`Failed to fetch trees: ${response.status}`);
    }
    const trees = await response.json();
    treeCountEl.textContent = trees.length;
    renderTreeList(trees);
    drawTreeMarkers(trees);
  } catch (error) {
    console.error('Failed to load trees', error);
    treeListEl.innerHTML = '<p class="error">Unable to load tree data.</p>';
  }
}

function renderTreeList(trees) {
  treeListEl.innerHTML = '';
  if (!trees.length) {
    treeListEl.innerHTML = '<p>No trees catalogued yet. Add your first tree!</p>';
    return;
  }
  const sorted = [...trees].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  sorted.forEach((tree) => {
    const clone = treeRowTemplate.content.cloneNode(true);
    const title = clone.querySelector('.tree-title');
    const idLabel = clone.querySelector('.tree-id');
    const latEl = clone.querySelector('.tree-lat');
    const lonEl = clone.querySelector('.tree-lon');
    const speciesEl = clone.querySelector('.tree-species');
    const speciesRow = clone.querySelector('.tree-species-row');
    const notesEl = clone.querySelector('.tree-notes');
    const notesRow = clone.querySelector('.tree-notes-row');
    const timeEl = clone.querySelector('.tree-time');
    const mapLink = clone.querySelector('.tree-map-link');
    const streetViewLink = clone.querySelector('.tree-street-view');

    const species = tree.species?.trim();
    const notes = tree.notes?.trim();
    title.textContent = species || 'Tree';
    idLabel.textContent = `ID ${tree.id}`;
    latEl.textContent = formatNumber(tree.lat);
    lonEl.textContent = formatNumber(tree.lon);
    if (species) {
      speciesEl.textContent = species;
    } else {
      speciesRow.style.display = 'none';
    }
    if (notes) {
      notesEl.textContent = notes;
    } else {
      notesRow.style.display = 'none';
    }
    timeEl.textContent = formatTimestamp(tree.timestamp);
    mapLink.setAttribute('href', mapsUrl(tree.lat, tree.lon));
    streetViewLink.setAttribute('href', streetViewUrl(tree.lat, tree.lon));
    treeListEl.appendChild(clone);
  });
}

function drawTreeMarkers(trees) {
  treeLayer.clearLayers();
  const bounds = [];
  trees.forEach((tree) => {
    const lat = Number(tree.lat);
    const lon = Number(tree.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return;
    }
    const marker = L.circleMarker([lat, lon], {
      radius: 6,
      color: '#14532d',
      fillColor: '#16a34a',
      fillOpacity: 0.7,
      weight: 1.5,
    });
    marker.bindPopup(
      `<strong>${tree.species || 'Tree'}</strong><br/>Lat: ${formatNumber(lat)}<br/>Lon: ${formatNumber(lon)}<br/>${
        tree.notes || ''
      }`
    );
    marker.addTo(treeLayer);
    bounds.push([lat, lon]);
  });
  if (bounds.length) {
    const leafletBounds = L.latLngBounds(bounds);
    map.fitBounds(leafletBounds.pad(0.1));
  }
}

map.on('click', (event) => {
  const { lat, lng } = event.latlng;
  latInput.value = lat.toFixed(6);
  lonInput.value = lng.toFixed(6);
});

panoramaSelect.addEventListener('change', (event) => {
  const selectedId = event.target.value;
  if (selectedId) {
    setSelectedPanorama(selectedId);
  }
});

usePanoramaLocationBtn.addEventListener('click', () => {
  if (!selectedPanoramaId) {
    return;
  }
  const panorama = panoramas.find((p) => p.id === selectedPanoramaId);
  if (!panorama) {
    return;
  }
  const lat = Number.parseFloat(panorama.lat);
  const lon = Number.parseFloat(panorama.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return;
  }
  latInput.value = lat.toFixed(6);
  lonInput.value = lon.toFixed(6);
  latInput.focus();
});

treeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const lat = Number.parseFloat(latInput.value);
  const lon = Number.parseFloat(lonInput.value);
  const species = speciesInput.value.trim();
  const notes = notesInput.value.trim();

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    alert('Please enter valid latitude and longitude values.');
    return;
  }

  const payload = { lat, lon, species, notes };

  try {
    const response = await fetch('/api/trees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || 'Unknown error');
    }
    speciesInput.value = '';
    notesInput.value = '';
    await loadTrees();
  } catch (error) {
    console.error('Failed to save tree', error);
    alert(`Failed to save tree: ${error.message}`);
  }
});

loadPanoramas();
loadTrees();
