"use strict";

// A compact, researcher-prepared GeoJSON lookup. Coordinates are used only
// inside classify() and never included in its result.
(function attachPlaceContext(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EMAForgePlaceContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const allowedIndicators = new Set(['walkability', 'pollution', 'urbanicity', 'deprivation']);
  const allowedBands = new Set(['very_low', 'low', 'moderate', 'high', 'very_high', 'urban', 'rural', 'suburban']);

  function validRing(ring) {
    return Array.isArray(ring) && ring.length >= 4 && ring.length <= 25000 && ring.every(point =>
      Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
      Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
  }
  function validPolygon(polygon) {
    return Array.isArray(polygon) && polygon.length >= 1 && polygon.length <= 100 && polygon.every(validRing);
  }
  function validGeometry(geometry) {
    return geometry?.type === 'Polygon' ? validPolygon(geometry.coordinates) :
      geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length >= 1 && geometry.coordinates.length <= 100 && geometry.coordinates.every(validPolygon);
  }
  function validate(dataset) {
    if (!dataset || dataset.type !== 'FeatureCollection' || !Array.isArray(dataset.features) ||
        !dataset.features.length || dataset.features.length > 3000) return 'Upload a GeoJSON FeatureCollection with 1–3,000 study-area polygons.';
    if (new TextEncoder().encode(JSON.stringify(dataset)).byteLength > 2 * 1024 * 1024) return 'Study-area lookup exceeds the 2 MB limit.';
    const info = dataset.metadata;
    if (!info || !['name', 'version', 'source_url', 'method'].every(key =>
      typeof info[key] === 'string' && info[key].trim().length > 0 && info[key].length <= 300) ||
      !/^https:\/\//.test(info.source_url)) return 'Provide metadata: name, version, HTTPS source_url, and method explaining the categories.';
    for (const feature of dataset.features) {
      if (feature?.type !== 'Feature' || !validGeometry(feature.geometry)) return 'Each feature needs a valid Polygon or MultiPolygon geometry.';
      const indicators = feature.properties?.indicators;
      if (!indicators || !Object.keys(indicators).length || Object.keys(indicators).length > 4 ||
          Object.entries(indicators).some(([key, band]) => !allowedIndicators.has(key) || !allowedBands.has(band) ||
            (key === 'urbanicity' ? !['urban', 'suburban', 'rural'].includes(band) : ['urban', 'suburban', 'rural'].includes(band)))) {
        return 'Each polygon needs indicators with walkability, pollution, deprivation, or urbanicity categories. Use low/moderate/high bands or urban/suburban/rural.';
      }
    }
    return null;
  }
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function inPolygon(x, y, rings) {
    return inRing(x, y, rings[0]) && !rings.slice(1).some(ring => inRing(x, y, ring));
  }
  function contains(geometry, x, y) {
    return geometry.type === 'Polygon' ? inPolygon(x, y, geometry.coordinates) :
      geometry.coordinates.some(polygon => inPolygon(x, y, polygon));
  }
  function classify(dataset, latitude, longitude, accuracy) {
    const metadata = { dataset: dataset.metadata.name, version: dataset.metadata.version };
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy) || accuracy < 0) {
      return { status: 'unavailable', ...metadata };
    }
    // Sample the reported uncertainty circle; refuse to classify if a sample
    // falls outside the polygon or in a polygon with different indicators.
    const latDelta = accuracy / 111320;
    const lonDelta = accuracy / (111320 * Math.max(0.01, Math.cos(latitude * Math.PI / 180)));
    const samples = [[longitude, latitude], [longitude - lonDelta, latitude], [longitude + lonDelta, latitude],
      [longitude, latitude - latDelta], [longitude, latitude + latDelta],
      [longitude - lonDelta * .707, latitude - latDelta * .707],
      [longitude + lonDelta * .707, latitude - latDelta * .707],
      [longitude - lonDelta * .707, latitude + latDelta * .707],
      [longitude + lonDelta * .707, latitude + latDelta * .707]];
    const matched = samples.map(([x, y]) => dataset.features.find(feature => contains(feature.geometry, x, y)));
    if (!matched[0]) return { status: 'outside_study_area', ...metadata };
    const indicators = matched[0].properties.indicators;
    if (matched.some(feature => !feature || JSON.stringify(feature.properties.indicators) !== JSON.stringify(indicators))) {
      return { status: 'uncertain_boundary', ...metadata };
    }
    return { status: 'classified', indicators: { ...indicators }, ...metadata };
  }
  function epaWalkability(score) {
    if (!Number.isFinite(score) || score < 1 || score > 20) return null;
    return { status: 'classified', indicators: { walkability: score <= 5.75 ? 'very_low' :
      score <= 10.5 ? 'low' : score <= 15.25 ? 'high' : 'very_high' },
      dataset: 'EPA National Walkability Index', version: '2021' };
  }
  return { validate, classify, epaWalkability };
});
