/*
 * Main client-side logic for TreeWalk
 *
 * This script initializes the map, loads existing tree labels
 * from the backend, and allows users to add new labels by
 * clicking on the map or entering coordinates manually. When
 * users click the map, the latitude and longitude fields in
 * the form are automatically populated. Upon submission, the
 * new label is posted to the backend and the UI is refreshed.
 */

// Initialize the Leaflet map
const map = L.map('map').setView([30.7333, 76.7794], 14); // Center on Chandigarh by default

// Add OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Global storage for markers so we can clear them when reloading
let markers = [];

/**
 * Fetch tree data from the backend and refresh the UI.
 */
async function loadTrees() {
  try {
    const response = await fetch('/api/trees');
    const trees = await response.json();
    // Clear existing markers
    markers.forEach(marker => marker.remove());
    markers = [];
    // Build HTML table
    let html = '<table><thead><tr><th>ID</th><th>Latitude</th><th>Longitude</th><th>Species</th><th>Notes</th><th>Street View</th></tr></thead><tbody>';
    trees.forEach(tree => {
      const lat = parseFloat(tree.lat);
      const lon = parseFloat(tree.lon);
      // Create marker
      const marker = L.marker([lat, lon]);
      marker.addTo(map);
      marker.bindPopup(`<strong>${tree.species || 'Tree'}</strong><br>Lat: ${lat.toFixed(5)}, Lon: ${lon.toFixed(5)}<br>${tree.notes || ''}<br><a class="street-link" target="_blank" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}">Street View</a>`);
      markers.push(marker);
      // Append to table
      html += '<tr>' +
        `<td>${tree.id}</td>` +
        `<td>${lat.toFixed(5)}</td>` +
        `<td>${lon.toFixed(5)}</td>` +
        `<td>${tree.species || ''}</td>` +
        `<td>${tree.notes || ''}</td>` +
        `<td><a class="street-link" target="_blank" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}">View</a></td>` +
        '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('tree-list').innerHTML = html;
  } catch (err) {
    console.error('Failed to load tree data', err);
    document.getElementById('tree-list').innerHTML = '<p>Error loading data.</p>';
  }
}

// Load trees on initial page load
loadTrees();

// Populate lat/lon inputs when clicking on the map
map.on('click', function (e) {
  const { lat, lng } = e.latlng;
  document.getElementById('lat').value = lat.toFixed(6);
  document.getElementById('lon').value = lng.toFixed(6);
});

// Handle form submission to add a new tree
document.getElementById('tree-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const lat = parseFloat(document.getElementById('lat').value);
  const lon = parseFloat(document.getElementById('lon').value);
  const species = document.getElementById('species').value.trim();
  const notes = document.getElementById('notes').value.trim();
  if (isNaN(lat) || isNaN(lon)) {
    alert('Please enter valid latitude and longitude values.');
    return;
  }
  const payload = { lat, lon, species, notes };
  try {
    const response = await fetch('/api/trees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      // Clear form fields (except lat/lon so user can add multiple near points)
      document.getElementById('species').value = '';
      document.getElementById('notes').value = '';
      // Reload tree list
      loadTrees();
    } else {
      const error = await response.json();
      alert('Error saving tree: ' + (error.error || response.statusText));
    }
  } catch (err) {
    console.error('Failed to save tree', err);
    alert('Failed to save tree. See console for details.');
  }
});